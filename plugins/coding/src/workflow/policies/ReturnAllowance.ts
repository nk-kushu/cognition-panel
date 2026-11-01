import type { WorkflowRunSnapshot } from "kushibot";
import type { CodingLimits } from "../../engineering/types";

export type ReturnCategory = "clarification" | "investigation" | "plan" | "skeleton" | "code-fix";

/**
 * Counts returns from the engine's own transition records. They are saved with the run, so
 * changing steps, restarting a worker or resuming a review cannot reset an allowance.
 */
export class ReturnAllowance {
  constructor(
    private readonly limits: CodingLimits,
    /** Transition ID → the category it consumes; waits for a human consume none. */
    private readonly categories: ReadonlyMap<string, ReturnCategory>,
  ) {}

  /** Null when another return is allowed, otherwise which limit it would exceed. */
  denied(run: WorkflowRunSnapshot, category: ReturnCategory): string | null {
    const used = run.transitions.flatMap((record) => {
      const found = record.transitionId ? this.categories.get(record.transitionId) : undefined;
      return found ? [found] : [];
    });
    const limit = {
      clarification: this.limits.clarifications,
      investigation: this.limits.investigationReturns,
      plan: this.limits.planRevisions,
      skeleton: this.limits.skeletonRevisions,
      "code-fix": this.limits.codeFixReturns,
    }[category];
    if (used.filter((item) => item === category).length >= limit)
      return `The ${category} return limit (${limit}) is reached.`;
    if (used.length >= this.limits.totalReturns)
      return `The limit of ${this.limits.totalReturns} returns per run is reached.`;
    return null;
  }
}
