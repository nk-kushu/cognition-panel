/** Browser-safe definitions shared by the agent and its settings UI. */
export type SkillSelection = "automatic" | "required" | "off";
export type SkillPhase = "planning" | "test-writing" | "skeleton" | "implementation" | "answer";
/** Run results a skill can require; it cannot start until they exist. */
export type SkillInput = "findings" | "plan" | "tests" | "skeleton" | "approval";
/** Where a guard checks the work: the skeleton before review, or the finished change. */
export type GuardPhase = "skeleton" | "guards";

/** One saved version of a skill. `expectedResult` empty means short guidance, not a session. */
export type SkillDefinition = Readonly<{
  id: string;
  versionId: string;
  name: string;
  purpose: string;
  instructions: string;
  phases: readonly SkillPhase[];
  dependencies: readonly string[];
  requiredInputs?: readonly SkillInput[];
  expectedResult: string;
  selection: SkillSelection;
  /** Empty or absent uses the run's default model. */
  model?: string;
}>;

export type GuardCommand = Readonly<{
  /** Executable with `args`, or `script` for /bin/sh; exactly one of the two forms. */
  command: string;
  args: readonly string[];
  script: string;
  workingDirectory: string;
  timeoutMs: number;
  successExitCodes: readonly number[];
}>;

/** One saved version of a guard. Its command runs in the isolated environment, never the host. */
export type GuardDefinition = Readonly<{
  id: string;
  versionId: string;
  name: string;
  purpose: string;
  type: "deterministic" | "llm" | "combined";
  phases: readonly GuardPhase[];
  selection: SkillSelection;
  /** Blocking findings stop completion; advisory ones are reported only. */
  blocking: boolean;
  reviewInstructions: string;
  /** Empty inherits the run's guard model. */
  model: string;
  check: GuardCommand | null;
}>;

export type TestSuite = Readonly<{
  id: string;
  type: string;
  name: string;
  command: string;
  args: readonly string[];
  workingDirectory: string;
  timeoutMs: number;
  enabled: boolean;
}>;

export type CodingLimits = Readonly<{
  clarifications: number;
  investigationReturns: number;
  planRevisions: number;
  skeletonRevisions: number;
  codeFixReturns: number;
  totalReturns: number;
  answerRounds: number;
  runMinutes: number;
  modelCalls: number;
  inputTokens: number;
}>;

export type CodingModels = Readonly<{
  /** Empty fields inherit `default`; an empty `default` uses the server's model. */
  default: string;
  investigationPlanning: string;
  implementation: string;
  guardReview: string;
  skillScheduler: string;
  answer: string;
}>;

export type CodingSettings = Readonly<{
  limits: CodingLimits;
  models: CodingModels;
  testWritingPrompt: string;
  /** Test types the agent writes and runs; each maps to registered suites. */
  testTypes: readonly string[];
  testSuites: readonly TestSuite[];
}>;

export const defaultCodingSettings: CodingSettings = {
  limits: {
    clarifications: 2,
    investigationReturns: 3,
    planRevisions: 2,
    skeletonRevisions: 3,
    codeFixReturns: 3,
    totalReturns: 8,
    answerRounds: 3,
    runMinutes: 60,
    modelCalls: 300,
    inputTokens: 6_000_000,
  },
  models: {
    default: "",
    investigationPlanning: "",
    implementation: "",
    guardReview: "",
    skillScheduler: "",
    answer: "",
  },
  testWritingPrompt:
    "Cover success, invalid input, and boundary cases. Use the project's existing test style.",
  testTypes: [],
  testSuites: [],
};

/** Selected test types no enabled suite can run; a run cannot verify these. */
export const uncoveredTestTypes = (settings: CodingSettings): readonly string[] =>
  settings.testTypes.filter(
    (type) => !settings.testSuites.some((suite) => suite.enabled && suite.type === type),
  );

export type RequestMode = "answer-only" | "code-change";
