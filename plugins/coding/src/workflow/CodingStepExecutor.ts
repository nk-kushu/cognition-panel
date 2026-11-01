import {
  WorkflowWait,
  type ExecutionOutcome,
  type IExecutionContext,
  type IExecutor,
  type JsonValue,
} from "kushibot";
import {
  ReturnRequest,
  StepStopped,
  WaitRequest,
  type ReturnRoute,
} from "../assignments/StepSignals";
import type { RunContext } from "../context/RunContext";
import type { ICodingStep } from "./CodingStep";

/** What the engine stores for a step. Details live in the run state, keeping snapshots small. */
export type StepResult =
  | Readonly<{ kind: "done"; summary: string; skipped: boolean }>
  | Readonly<{ kind: "needs-return"; route: ReturnRoute; reason: string }>;

/** Turns a step's signals into engine outcomes; inactive-branch steps finish without work. */
export class CodingStepExecutor implements IExecutor<JsonValue, JsonValue> {
  constructor(
    private readonly step: ICodingStep,
    private readonly run: RunContext,
  ) {}

  async execute(
    _input: JsonValue,
    context: IExecutionContext,
  ): Promise<ExecutionOutcome<JsonValue>> {
    const { state } = this.run;
    const { branch, id } = this.step;
    if (branch !== "any" && state.data.mode !== branch)
      return this.completed({
        kind: "done",
        summary: "Not on the selected branch.",
        skipped: true,
      });
    try {
      await this.applyDecision();
      const summary = (await this.step.execute(context)).slice(0, 1024);
      return this.completed({ kind: "done", summary, skipped: false });
    } catch (error) {
      if (error instanceof ReturnRequest)
        return this.completed({
          kind: "needs-return",
          route: error.route,
          reason: error.reason.slice(0, 1024),
        });
      if (error instanceof WaitRequest) {
        await state.update((data) => {
          data.wait = { id: error.id, kind: error.kind, stepId: id, payload: error.payload };
        });
        return WorkflowWait.outcome(`wait:${error.id}`, error.summary.slice(0, 512));
      }
      if (error instanceof StepStopped) {
        await state.update((data) => {
          data.unresolved.push(error.reason.message);
        });
        return {
          status: "stopped",
          reason: error.reason,
          partial: {
            summary: error.reason.message,
            evidenceRefs: [],
            artifactRefs: [],
            unresolved: [error.reason.message],
          },
          pendingOperationRefs: error.pendingOperationRefs,
        };
      }
      throw error;
    }
  }

  /** Shared by every step: a decision's answer becomes run state before work continues. */
  private async applyDecision(): Promise<void> {
    const { state } = this.run;
    const { wait } = state.data;
    const answer = wait?.kind === "decision" ? state.answerFor(wait.id) : null;
    if (!wait || !answer) return;
    await state.update((data) => {
      data.wait = null;
      data.decisions.push({
        id: wait.id,
        question: String(wait.payload.question),
        choice: answer.choice,
        text: answer.text,
      });
      data.authorizedPackages.push(...answer.packages);
    });
  }

  private completed(result: StepResult): ExecutionOutcome<JsonValue> {
    return { status: "completed", result: result as unknown as JsonValue };
  }
}
