import { createHash } from "node:crypto";
import {
  WorkspaceEvidence,
  type AgentRunRuntime,
  type EditingResult,
  type DecisionOutcome,
  type DecisionRequest,
  type IArtifactWriter,
  type ICliExecutor,
  type IDecisionUnit,
  type IExecutionContext,
  type JsonValue,
} from "kushibot";
import type { IModelBindings, PinnedRun } from "../CodingAgentOptions";
import type { WorkingCopy } from "../infrastructure/workspace/WorkingCopy";
import { StepStopped } from "../assignments/StepSignals";
import type { RunArtifacts } from "./RunArtifacts";
import type { RunState } from "./RunState";

export const digestOf = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);

/** Text the DecisionUnit accepts: one line within its byte limit. */
export const decisionText = (value: string, bytes = 1000): string => {
  // eslint-disable-next-line no-control-regex
  let text = value.replace(/[\u0000-\u001f]+/g, " ").trim() || "None.";
  while (Buffer.byteLength(text) > bytes) text = text.slice(0, -1);
  return text;
};

const DECISION_ATTEMPTS = 3;

/** One run's services. Everything here is pinned or durable, so a resumed run sees the same. */
export class RunContext {
  private originals = true;
  readonly evidence: WorkspaceEvidence;

  constructor(
    readonly pinned: PinnedRun,
    readonly state: RunState,
    readonly copy: WorkingCopy,
    readonly cli: ICliExecutor,
    readonly artifacts: RunArtifacts,
    readonly runtime: AgentRunRuntime,
    readonly models: IModelBindings,
    readonly decisions: IDecisionUnit,
    writer: IArtifactWriter,
    readonly checkIds: readonly string[],
  ) {
    this.evidence = new WorkspaceEvidence(
      (file) => (this.originals ? copy.readOriginal(file) : copy.read(file)),
      checkIds.map((id) => ({ id })),
      writer,
      runtime.context.identity.runId!,
      runtime.context.signal,
    );
  }

  /** The baseline is the project as the run started, whichever process this is. */
  async initialize(): Promise<void> {
    this.originals = true;
    await this.evidence.initialize(await this.copy.reviewablePaths());
    this.originals = false;
  }

  /** The real change set against the original project. */
  async status(): Promise<EditingResult> {
    for (const file of await this.copy.reviewablePaths())
      this.evidence.track(file, await this.copy.readOriginal(file));
    return this.evidence.status();
  }

  /** The shared goal, preferences and decisions; focus does not hide what the job needs. */
  sharedContext(): JsonValue {
    const { state, pinned } = this;
    return {
      goal: pinned.message,
      attachedFiles: [...pinned.files],
      clarifications: state.data.clarifications,
      projectPreferences: pinned.memory.map((item) => item.statement),
      userDecisions: state.data.decisions.map(({ question, choice, text }) => ({
        question,
        choice,
        text,
      })),
    };
  }

  /** Findings still backed by the current files, with their sources. */
  findings(): JsonValue {
    return this.state.data.findings.map(({ question, answer, sources }) => ({
      question,
      answer,
      sources: sources.map((source) => source.path),
    }));
  }

  control(context: IExecutionContext) {
    return {
      operationId: this.runtime.ids.nextId(),
      signal: context.signal,
      deadlineEpochMs: context.deadlineEpochMs,
      timeoutMs: this.runtime.modelLimits().timeoutMs,
    };
  }

  /**
   * One bounded judgment with retries for an unavailable provider. An outcome the caller can
   * use comes back; running out of time, budget or certainty ends the step instead.
   */
  async decide(
    request: DecisionRequest,
    context: IExecutionContext,
  ): Promise<
    Extract<
      DecisionOutcome,
      { status: "answered" | "abstained" | "unavailable" | "invalid-output" }
    >
  > {
    for (let attempt = 1; ; attempt++) {
      const outcome = await this.decisions.evaluate(request, this.control(context));
      if (outcome.status === "stopped") throw new StepStopped(outcome.reason);
      if (outcome.status === "uncertain")
        throw new StepStopped(
          { code: "no-progress", message: `Decision ${request.purpose} has an unknown result.` },
          [outcome.operationId],
        );
      if (outcome.status === "answered" || outcome.status === "abstained") return outcome;
      if (attempt >= DECISION_ATTEMPTS) return outcome;
    }
  }
}
