import type { DecisionOutcome, DecisionRequest, IDecisionUnit } from "kushibot";

import type { Decide } from "./CodingHarness";

/** Answers JEV's questions from the test; null abstains. Records what was asked. */
export class FakeDecisions implements IDecisionUnit {
  readonly asked: string[] = [];
  constructor(private readonly decide: Decide) {}
  async evaluate(request: DecisionRequest): Promise<DecisionOutcome> {
    this.asked.push(request.purpose);
    const choice = this.decide(request);
    return choice === null
      ? { status: "abstained" }
      : { status: "answered", answer: { kind: "answered", choice, supportingRefs: [] } };
  }
}
