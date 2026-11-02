import type { ExecutionStopReason } from "kushibot";

/** End the run without accepting the step; `unresolved` reaches the final report. */
export class StepStopped extends Error {
  constructor(
    readonly reason: ExecutionStopReason,
    readonly pendingOperationRefs: readonly string[] = [],
  ) {
    super(reason.message);
  }
}
