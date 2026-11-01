import type { IPolicy, WorkflowTransitionDecision, WorkflowTransitionInput } from "kushibot";
import type { ReturnRoute } from "../../assignments/StepSignals";
import type { RunState } from "../../context/RunState";
import type { StepResult } from "../CodingStepExecutor";
import type { ReturnAllowance } from "./ReturnAllowance";

type Transition = IPolicy<WorkflowTransitionInput, WorkflowTransitionDecision>;

/**
 * Workflow code, not a model, decides whether a requested return happens. It checks the
 * allowance before every return; a denial leaves the step unaccepted, so the engine stops the
 * run and the report says what remains unresolved.
 */
export class ReturnRoutePolicy implements Transition {
  constructor(
    private readonly route: ReturnRoute,
    private readonly allowance: ReturnAllowance,
    private readonly state: RunState,
  ) {}

  async apply({ run, trigger }: WorkflowTransitionInput): Promise<WorkflowTransitionDecision> {
    if (trigger.outcome.status !== "completed") return { take: false };
    const result = trigger.outcome.result as unknown as StepResult;
    if (result.kind !== "needs-return" || result.route !== this.route) return { take: false };
    const denied =
      this.route === "investigation" && !this.state.data.investigationProgress
        ? "Searching again found no new evidence."
        : this.allowance.denied(run, this.route);
    if (denied === null) return { take: true };
    const report = `${denied} Unresolved: ${result.reason}`;
    if (!this.state.data.unresolved.includes(report))
      await this.state.update((data) => {
        data.unresolved.push(report);
      });
    return { take: false };
  }
}

/** Reopens a step after its wait is answered; a stopped attempt without a wait stays stopped. */
export class WaitAnsweredPolicy implements Transition {
  async apply({ trigger }: WorkflowTransitionInput): Promise<WorkflowTransitionDecision> {
    const { outcome } = trigger;
    return {
      take:
        outcome.status === "stopped" &&
        outcome.pendingOperationRefs.length === 1 &&
        outcome.pendingOperationRefs[0]!.startsWith("wait:"),
    };
  }
}
