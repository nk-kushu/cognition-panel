import type { ReturnRoute } from "../workflow/WorkflowGraph";

/** Ask workflow code to send the run back; the transition policy decides if it may. */
export class ReturnRequest extends Error {
  constructor(
    readonly route: ReturnRoute,
    readonly reason: string,
  ) {
    super(reason);
  }
}
