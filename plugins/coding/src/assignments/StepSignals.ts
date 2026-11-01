import type { ExecutionStopReason } from "kushibot";
import type { WaitKind } from "../context/RunState";
import type { ReturnRoute } from "../workflow/WorkflowGraph";

export type { ReturnRoute };

/** Ask workflow code to send the run back; the transition policy decides if it may. */
export class ReturnRequest extends Error {
  constructor(
    readonly route: ReturnRoute,
    readonly reason: string,
  ) {
    super(reason);
  }
}

/** Suspend the run until the host supplies an answer. */
export class WaitRequest extends Error {
  constructor(
    readonly id: string,
    readonly kind: WaitKind,
    readonly payload: Readonly<Record<string, unknown>>,
    readonly summary: string,
  ) {
    super(summary);
  }
}

/** End the run without accepting the step; `unresolved` reaches the final report. */
export class StepStopped extends Error {
  constructor(
    readonly reason: ExecutionStopReason,
    readonly pendingOperationRefs: readonly string[] = [],
  ) {
    super(reason.message);
  }
}
