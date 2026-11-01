import type { CodingLimits, CodingModels } from "../src/engineering/types";
export const LIMITS: readonly {
  key: keyof CodingLimits;
  label: string;
  min: number;
  max: number;
}[] = [
  { key: "clarifications", label: "Mode clarifications", min: 0, max: 16 },
  { key: "investigationReturns", label: "Investigation returns", min: 0, max: 16 },
  { key: "planRevisions", label: "Plan revisions", min: 0, max: 16 },
  { key: "skeletonRevisions", label: "Skeleton revisions", min: 0, max: 16 },
  {
    key: "codeFixReturns",
    label: "Code-fix returns (guards and tests share these)",
    min: 0,
    max: 16,
  },
  { key: "totalReturns", label: "Total returns per run", min: 0, max: 32 },
  { key: "answerRounds", label: "Answer-only investigation rounds", min: 1, max: 8 },
  { key: "runMinutes", label: "Working minutes per run", min: 1, max: 230 },
  { key: "modelCalls", label: "Model calls per run", min: 1, max: 5000 },
  { key: "inputTokens", label: "Input tokens per run", min: 1000, max: 100_000_000 },
];

export const MODELS: readonly { key: keyof CodingModels; label: string }[] = [
  { key: "default", label: "Default" },
  { key: "investigationPlanning", label: "Investigation" },
  { key: "implementation", label: "Implementation" },
  { key: "guardReview", label: "Guard review" },
  { key: "skillScheduler", label: "Skill scheduler" },
  { key: "answer", label: "Answer-only" },
];
