import type { WaitKind } from "../context/RunState";

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
