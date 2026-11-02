import type { GuardCheckInput, GuardFinding } from "kushibot";

export type GuardFeedback = Map<string, string>;

export const findings = (
  input: GuardCheckInput,
  verdict: GuardFinding["verdict"],
  code: string,
  evidenceRef: string,
): readonly GuardFinding[] =>
  input.ruleIds.map((ruleId) => ({ ruleId, verdict, code, evidenceRefs: [evidenceRef] }));
