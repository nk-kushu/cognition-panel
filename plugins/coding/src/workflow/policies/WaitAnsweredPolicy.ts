import type { WorkflowTransitionDecision, WorkflowTransitionInput } from "kushibot";

import type { Transition } from "./RoutePolicies";

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
