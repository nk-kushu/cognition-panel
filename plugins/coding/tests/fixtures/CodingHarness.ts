import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import os from "node:os";

import path from "node:path";

import type { TestContext } from "node:test";

import type { DecisionRequest, JsonValue } from "kushibot";

import type { ChatHostContext } from "../../src/integrations/kushex/ChatRequest";

import { runChat } from "../../src/integrations/kushex/chat";

import { RunDirectory } from "../../src/infrastructure/run/RunDirectory";

import { RunState, type WaitAnswer } from "../../src/context/RunState";

import { SandboxedCli } from "../../src/infrastructure/sandbox/SandboxedCli";

import type { ScriptedGateway } from "./ScriptedGateway";

import { FakeDecisions } from "./FakeDecisions";
import { profile } from "./ScriptedGateway";

export type Decide = (request: DecisionRequest) => string | null;

export const defaultDecisions: Decide = (request) =>
  ({
    "choose-request-mode": "code-change",
    "select-relevant-file": "relevant",
    "plan-impact": "plan-still-holds",
    "classify-failure": "code-defect",
  })[request.purpose] ?? null;

export type ChatValue = Readonly<{
  runId: string;
  presentation: "wait" | "message" | "changes";
  message: string;
  unresolved: readonly string[];
  result: {
    summary: string;
    changedPaths: readonly string[];
    changeArtifactRefs: readonly string[];
  } | null;
  artifacts: Readonly<Record<string, JsonValue>>;
  wait?: { id: string; kind: string; stepId: string; payload: Record<string, unknown> };
}>;

/** A temporary project and run root, driven through the same `runChat` the chat uses. */
export class CodingHarness {
  /** Every model binding the run asked for, as `role:modelId`. */
  readonly bound: string[] = [];

  private constructor(
    readonly root: string,
    readonly workspace: string,
    private readonly gateway: ScriptedGateway,
    readonly decisions: FakeDecisions,
    private readonly host: ChatHostContext,
  ) {}

  static async create(
    t: TestContext,
    gateway: ScriptedGateway,
    host: Partial<ChatHostContext> = {},
    decide: Decide = defaultDecisions,
    files: Readonly<Record<string, string>> = { "src/token.ts": "export const version = 1;\n" },
  ): Promise<CodingHarness> {
    const root = await mkdtemp(path.join(os.tmpdir(), "coding-agent-test-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const workspace = path.join(root, "project");
    for (const [file, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(workspace, file)), { recursive: true });
      await writeFile(path.join(workspace, file), content);
    }
    return new CodingHarness(root, workspace, gateway, new FakeDecisions(decide), {
      projectId: "project",
      settings: null,
      skills: [],
      guards: [],
      memory: [],
      conversation: [],
      ...host,
    });
  }

  private dependencies() {
    const gateway = this.gateway;
    return {
      runsRoot: path.join(this.root, "runs"),
      artifactsDirectory: path.join(this.root, "artifacts"),
      models: () => ({
        bind: (role: string, modelId?: string) => {
          this.bound.push(`${role}:${modelId ?? ""}`);
          return { gateway, profile };
        },
      }),
      decisions: () => this.decisions,
      cli: new SandboxedCli(),
    };
  }

  private request(message: string, configuration: Record<string, unknown>) {
    return {
      message,
      configuration,
      files: [],
      workspace: this.workspace,
      signal: new AbortController().signal,
      progress: () => undefined,
      host: this.host,
    };
  }

  async send(message: string, configuration: Record<string, unknown> = {}): Promise<ChatValue> {
    return this.checked(await runChat(this.request(message, configuration), this.dependencies()));
  }

  async answer(value: ChatValue, answer: Partial<WaitAnswer>): Promise<ChatValue> {
    return this.checked(
      await runChat(
        {
          ...this.request("", {}),
          resume: {
            runId: value.runId,
            answer: {
              waitId: value.wait!.id,
              choice: "",
              text: "",
              digest: "",
              packages: [],
              ...answer,
            },
          },
        },
        this.dependencies(),
      ),
    );
  }

  private checked(value: unknown): ChatValue {
    if (this.gateway.failures.length) throw new Error(this.gateway.failures.join("\n"));
    return value as ChatValue;
  }

  approve(value: ChatValue): Promise<ChatValue> {
    return this.answer(value, { choice: "approve", digest: String(value.wait!.payload.digest) });
  }

  original(file: string): Promise<string> {
    return readFile(path.join(this.workspace, file), "utf8");
  }

  async state(runId: string): Promise<RunState> {
    const run = await RunDirectory.open(path.join(this.root, "runs"), runId);
    return RunState.open(run.statePath);
  }

  async kept(runId: string, file: string): Promise<string> {
    return readFile(path.join(this.root, "runs", runId, "workspace", "copy", file), "utf8");
  }
}
