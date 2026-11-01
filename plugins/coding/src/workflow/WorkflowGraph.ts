import type { CodingLimits, CodingModels, GuardPhase, SkillPhase } from "../engineering/types";

/** Browser-safe: the state machine is built from this map and the settings UI draws it. */

/** Which branch Step 0 must have selected for a step to do any work. */
export type StepBranch = "any" | "answer-only" | "code-change";
export type ReturnRoute = "investigation" | "plan" | "skeleton" | "code-fix";

export type WorkflowStep = Readonly<{
  id: string;
  title: string;
  summary: string;
  branch: StepBranch;
  /** Who does the work: a model session, JEV, you, or a saved command. */
  worker: "model" | "jev" | "human" | "command";
  /** The model settings this step's sessions use. */
  models: readonly (keyof CodingModels)[];
  limits: readonly (keyof CodingLimits)[];
  skillPhase?: SkillPhase;
  guardPhase?: GuardPhase;
  /** Whether the step can stop to wait for an answer. */
  pauses: boolean;
  /** Where this step may send a run back. */
  returns: readonly ReturnRoute[];
}>;

export const RETURN_ROUTES: Readonly<
  Record<ReturnRoute, Readonly<{ target: string; limit: keyof CodingLimits; summary: string }>>
> = {
  investigation: {
    target: "investigate",
    limit: "investigationReturns",
    summary: "Evidence is missing, so the run asks a new question and reads more of the code.",
  },
  plan: {
    target: "plan-implementation",
    limit: "planRevisions",
    summary: "The design is wrong, so the run revises the plan.",
  },
  skeleton: {
    target: "skeleton",
    limit: "skeletonRevisions",
    summary: "The declarations need another revision, from a failed check or your review.",
  },
  "code-fix": {
    target: "implement",
    limit: "codeFixReturns",
    summary: "A guard or test found a code defect, so the run repairs it. Both share this limit.",
  },
};

/** The chain, in execution order; a return may only target an earlier step. */
export const WORKFLOW_STEPS = [
  {
    id: "mode",
    title: "Choose mode",
    summary: "Honors an explicit choice, otherwise asks JEV. Waits for clarification if unclear.",
    branch: "any",
    worker: "jev",
    models: [],
    limits: ["clarifications"],
    pauses: true,
    returns: [],
  },
  {
    id: "answer-prepare",
    title: "Prepare questions",
    summary: "Lists what must be read to answer the request.",
    branch: "answer-only",
    worker: "model",
    models: ["investigationPlanning"],
    limits: [],
    pauses: false,
    returns: [],
  },
  {
    id: "answer-investigate",
    title: "Investigate",
    summary: "Reads the selected files read-only, one round of questions at a time.",
    branch: "answer-only",
    worker: "model",
    models: ["investigationPlanning"],
    limits: ["answerRounds"],
    pauses: false,
    returns: [],
  },
  {
    id: "answer-write",
    title: "Write answer",
    summary: "Writes the answer from the evidence and reports what stayed unresolved.",
    branch: "answer-only",
    worker: "model",
    models: ["answer", "skillScheduler"],
    limits: [],
    skillPhase: "answer",
    pauses: true,
    returns: [],
  },
  {
    id: "plan-investigation",
    title: "Plan investigation",
    summary: "One session lists the questions to answer.",
    branch: "code-change",
    worker: "model",
    models: ["investigationPlanning"],
    limits: [],
    pauses: true,
    returns: [],
  },
  {
    id: "investigate",
    title: "Investigate",
    summary: "For each question: names only, JEV selection, then reading the selected files.",
    branch: "code-change",
    worker: "model",
    models: ["investigationPlanning"],
    limits: [],
    pauses: true,
    returns: ["investigation"],
  },
  {
    id: "plan-implementation",
    title: "Plan implementation",
    summary: "Runs scheduled skills, then produces the plan.",
    branch: "code-change",
    worker: "model",
    models: ["default", "skillScheduler"],
    limits: [],
    skillPhase: "planning",
    pauses: true,
    returns: ["investigation"],
  },
  {
    id: "write-tests",
    title: "Write tests",
    summary: "One session per behavior; may touch only its test files.",
    branch: "code-change",
    worker: "model",
    models: ["implementation", "skillScheduler"],
    limits: [],
    skillPhase: "test-writing",
    pauses: true,
    returns: ["investigation", "plan"],
  },
  {
    id: "skeleton",
    title: "Skeleton",
    summary: "One session per component; declarations only. Its guards run before your review.",
    branch: "code-change",
    worker: "model",
    models: ["implementation", "skillScheduler"],
    limits: [],
    skillPhase: "skeleton",
    guardPhase: "skeleton",
    pauses: true,
    returns: ["investigation", "plan", "skeleton"],
  },
  {
    id: "human-review",
    title: "Human review",
    summary: "No model. Waits for your approval of the exact version shown.",
    branch: "code-change",
    worker: "human",
    models: [],
    limits: [],
    pauses: true,
    returns: ["investigation", "plan", "skeleton"],
  },
  {
    id: "implement",
    title: "Implement",
    summary: "One session per change; only the assigned method bodies may change.",
    branch: "code-change",
    worker: "model",
    models: ["implementation", "skillScheduler"],
    limits: [],
    skillPhase: "implementation",
    pauses: true,
    returns: ["investigation", "plan"],
  },
  {
    id: "guards",
    title: "Guards",
    summary: "Runs saved commands and model reviews through kushibot's guard framework.",
    branch: "code-change",
    worker: "command",
    models: ["guardReview"],
    limits: [],
    guardPhase: "guards",
    pauses: false,
    returns: ["investigation", "plan", "code-fix"],
  },
  {
    id: "run-tests",
    title: "Run tests",
    summary: "Runs registered suites directly.",
    branch: "code-change",
    worker: "command",
    models: [],
    limits: [],
    pauses: false,
    returns: ["investigation", "plan", "code-fix"],
  },
] as const satisfies readonly WorkflowStep[];

export type WorkflowStepId = (typeof WORKFLOW_STEPS)[number]["id"];
