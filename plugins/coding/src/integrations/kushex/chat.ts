import { CodingModelFactory } from "./OpenRouterModels";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  BoundedDecisionUnit,
  CodexCliTextGatewayFactory,
  DecisionRequestContract,
  JsonValueContract,
  type AgentRunRuntime,
  type IAgentRunResult,
  type ICliExecutor,
  type JsonValue,
  type ModelProfile,
} from "kushibot";
import { LocalChatArtifacts } from "./LocalChatArtifacts";
import type { ChatRequest } from "./ChatRequest";
import type {
  CodingAgentOptions,
  IModelBindings,
  ModelRole,
  PinnedRun,
} from "../../CodingAgentOptions";
import { RunState } from "../../context/RunState";
import { createCodingAgent } from "../../composition/createCodingAgent";
import {
  defaultCodingSettings,
  type CodingSettings,
  type RequestMode,
} from "../../engineering/types";
import { JevDecisionProvider } from "../../infrastructure/jev/JevDecisionProvider";
import { RunDirectory } from "../../infrastructure/run/RunDirectory";
import { SandboxedCli } from "../../infrastructure/sandbox/SandboxedCli";
import type { CodingResult } from "../../workflow/CodingRunWorkflow";

/** Stopped and failed runs keep their working copy for inspection, up to this many. */
const KEPT_RUNS = 20;
const GENERATED = "dist,build,coverage,.next,.nuxt,.output,.cache,.turbo,.vite";

class CodexModels implements IModelBindings {
  private readonly factory = new CodexCliTextGatewayFactory({
    executable: process.env.CODEX_EXECUTABLE || undefined,
    codexHome: process.env.CODEX_HOME || undefined,
  });

  constructor(private readonly settings: CodingSettings) {}

  bind(role: ModelRole, override?: string) {
    const { models } = this.settings;
    const modelId =
      override || models[role] || models.default || process.env.CODEX_MODEL || "gpt-6.1-sol";
    const profile: ModelProfile = {
      id: `coding-${role}`,
      providerId: "codex-cli",
      modelId,
      contextTokens: 400_000,
      maxOutputTokens: 16_000,
      maxRequestBytes: 1_048_576,
      maxResponseBytes: 1_048_576,
      supportsPromptCacheKey: false,
    };
    return { gateway: this.factory.create(profile), profile };
  }
}

const jevDecisions = (runtime: AgentRunRuntime) => {
  const json = new JsonValueContract();
  return new BoundedDecisionUnit(
    new JevDecisionProvider({
      apiKey: process.env.KUSHEX_JEV_API_KEY ?? "",
      model: process.env.KUSHEX_JEV_MODEL || "jev-latest",
      baseUrl: process.env.KUSHEX_JEV_BASE_URL || undefined,
      minConfidence: 0.6,
      budgetScopeId: runtime.budgetScopeId,
      ledger: runtime.stores.usage,
    }),
    new DecisionRequestContract(json),
    json,
    runtime.clock,
  );
};

const pin = (request: ChatRequest): PinnedRun => {
  const { host, configuration } = request;
  const mode = configuration?.mode;
  const saved = host?.settings ?? {};
  return {
    schemaVersion: 1,
    message: request.message,
    files: [...request.files],
    explicitMode: mode === "answer-only" || mode === "code-change" ? (mode as RequestMode) : null,
    sourceWorkspace: request.workspace,
    projectId: host?.projectId ?? "local",
    settings: {
      ...defaultCodingSettings,
      ...saved,
      limits: { ...defaultCodingSettings.limits, ...saved.limits },
      models: { ...defaultCodingSettings.models, ...saved.models },
    },
    skills: host?.skills ?? [],
    guards: host?.guards ?? [],
    memory: host?.memory ?? [],
    conversation: host?.conversation ?? [],
    excludedDirectories: (process.env.KUSHEX_EXCLUDED_DIRECTORIES ?? GENERATED)
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  };
};

/** What differs between production and tests; everything else is the same run. */
export type ChatDependencies = Readonly<{
  runsRoot: string;
  artifactsDirectory: string | undefined;
  models(
    settings: CodingSettings,
    /** Models chosen on individual skills and guards. */
    extra: readonly string[],
  ): IModelBindings | Promise<IModelBindings>;
  decisions: CodingAgentOptions["decisions"];
  cli: ICliExecutor;
}>;

export function chat(request: ChatRequest) {
  const artifactsDirectory = process.env.KUSHEX_ARTIFACTS_DIR;
  return runChat(request, {
    artifactsDirectory,
    runsRoot:
      process.env.KUSHEX_RUNS_DIR ||
      (artifactsDirectory
        ? path.join(path.dirname(artifactsDirectory), "runs")
        : path.join(os.homedir(), ".kushex", "runs")),
    models: (settings, extra) =>
      new CodingModelFactory(request.credentials?.openrouter, fetch).create(
        settings,
        new CodexModels(settings),
        extra,
      ),
    decisions: jevDecisions,
    cli: new SandboxedCli(),
  });
}

/** Turns one chat message, or one answer to a waiting run, into a run of the agent. */
export async function runChat(request: ChatRequest, dependencies: ChatDependencies) {
  const { runsRoot, artifactsDirectory } = dependencies;
  const resume = request.resume;
  const runId = resume?.runId ?? randomUUID();
  if (!resume) await RunDirectory.prune(runsRoot, KEPT_RUNS);
  const run = resume
    ? await RunDirectory.open(runsRoot, runId)
    : await RunDirectory.create(runsRoot, runId, pin(request));
  const pinned = await run.pinned();
  const state = await RunState.open(run.statePath);
  if (resume) {
    if (state.data.wait?.id !== resume.answer.waitId)
      throw new Error("This run is not waiting for that answer.");
    await state.update((data) => {
      data.answers.push(resume.answer);
    });
  }
  const models = await dependencies.models(
    pinned.settings,
    [...pinned.skills, ...pinned.guards].flatMap((item) => (item.model ? [item.model] : [])),
  );
  const local = await LocalChatArtifacts.open(pinned.sourceWorkspace, artifactsDirectory);
  const { agent, task, close } = createCodingAgent(
    runId,
    {
      run,
      pinned,
      artifacts: local.services.store,
      models,
      decisions: dependencies.decisions,
      cli: dependencies.cli,
      ...(request.debug ? { debug: request.debug } : {}),
    },
    state,
  );
  const started = Date.now();
  try {
    const timeoutMs = pinned.settings.limits.runMinutes * 60_000 - state.data.activeMs;
    if (timeoutMs <= 0) throw new Error("This run has used all of its working time.");
    const controls = {
      signal: request.signal,
      onProgress: (message: string) => request.progress(message),
      timeoutMs,
    };
    const result = await (resume
      ? agent.resume(runId, task, [`wait:${resume.answer.waitId}`], controls)
      : agent.run(task, { ...controls, runId }));
    await state.update((data) => {
      data.activeMs += Date.now() - started;
    });
    const response = respond(runId, result, state);
    if (result.result) await run.remove();
    return response;
  } finally {
    await close();
    await local.close();
  }
}

/** What the chat shows; `result` keeps the shape the proposal flow validates. */
function respond(runId: string, run: IAgentRunResult<CodingResult>, state: RunState) {
  const shared = {
    schemaVersion: 1 as const,
    runId,
    outcome: run.outcome as unknown as JsonValue,
    usage: run.usage as unknown as JsonValue,
    artifacts: run.artifacts,
  };
  const { wait, unresolved } = state.data;
  if (run.outcome.status === "pending" && wait)
    return {
      ...shared,
      presentation: "wait" as const,
      message: String(wait.payload.question ?? "The skeleton is ready for your review."),
      unresolved: [],
      result: null,
      wait: { ...wait, agentRunRef: runId },
    };
  if (run.result?.mode === "answer-only")
    return {
      ...shared,
      presentation: "message" as const,
      message: run.result.answer,
      unresolved: run.result.unresolved,
      result: null,
    };
  if (run.result?.mode === "code-change") {
    const { change, noTestsRegistered } = run.result;
    const note = noTestsRegistered ? " No test types are selected, so tests were not run." : "";
    return {
      ...shared,
      presentation: change.changedPaths.length ? ("changes" as const) : ("message" as const),
      message: `${change.summary}${note}`.slice(0, 2048),
      unresolved: change.unresolved,
      result: { ...change, summary: `${change.summary}${note}`.slice(0, 2048) },
    };
  }
  const outcome = run.snapshot.outcome;
  const reason =
    outcome?.status === "failed"
      ? outcome.error.message
      : outcome?.status === "stopped"
        ? outcome.reason.message
        : "The run did not finish and needs attention.";
  const remaining = unresolved.length ? unresolved : [reason];
  return {
    ...shared,
    presentation: "message" as const,
    message: `The task is not complete.\n\n${[...new Set(remaining)].map((item) => `- ${item}`).join("\n")}`,
    unresolved: remaining,
    result: null,
  };
}
