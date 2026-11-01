import { readFile, rename, writeFile } from "node:fs/promises";
import type { RequestMode } from "../engineering/types";

export type SourceRef = Readonly<{ path: string; digest: string }>;

export type InvestigationQuestion = Readonly<{
  id: string;
  question: string;
  why: string;
  status: "open" | "answered" | "unresolved";
}>;

export type Finding = Readonly<{
  questionId: string;
  question: string;
  answer: string;
  sources: readonly SourceRef[];
  artifactRef: string;
}>;

export type PlanChange = Readonly<{
  id: string;
  description: string;
  file: string;
  /** Functions or methods this change implements; empty means the whole file is in scope. */
  symbols: readonly string[];
}>;

export type ImplementationPlan = Readonly<{
  summary: string;
  tests: readonly Readonly<{
    id: string;
    behavior: string;
    type: string;
    files: readonly string[];
  }>[];
  components: readonly Readonly<{
    id: string;
    description: string;
    file: string;
    signatures: readonly string[];
  }>[];
  changes: readonly PlanChange[];
  packages: readonly string[];
}>;

/** A question an assignment could not answer, with the work to continue afterwards. */
export type BlockedWork = Readonly<{
  stepId: string;
  assignmentId: string;
  question: string;
  why: string;
  checked: readonly string[];
}>;

export type WaitKind = "clarification" | "decision" | "skeleton-review";

/** What Cognition Panel shows and saves; the run is suspended until the host supplies an answer. */
export type RunWait = Readonly<{
  id: string;
  kind: WaitKind;
  stepId: string;
  payload: Readonly<Record<string, unknown>>;
}>;

export type WaitAnswer = Readonly<{
  waitId: string;
  /** clarification/decision: chosen option or empty; review: approve or request-changes. */
  choice: string;
  text: string;
  /** Echo of the reviewed digest, so an approval binds to the exact version shown. */
  digest: string;
  packages: readonly string[];
}>;

export type ScheduledSkillResult = Readonly<{
  skillId: string;
  versionId: string;
  phase: string;
  summary: string;
  result: unknown;
}>;

export type RunStateData = {
  schemaVersion: 1;
  mode: RequestMode | null;
  clarifications: { question: string; answer: string }[];
  questions: InvestigationQuestion[];
  findings: Finding[];
  /** Paths each question has already read, to detect searches that find nothing new. */
  searched: Record<string, string[]>;
  investigationProgress: boolean;
  plan: { digest: string; value: ImplementationPlan } | null;
  planFeedback: string[];
  planRevision: number;
  testsPlanDigest: string | null;
  skeleton: { planDigest: string; digest: string; unchecked: string[] } | null;
  skeletonRevision: number;
  skeletonFeedback: string[];
  approval: { digest: string; planDigest: string } | null;
  assignments: Record<string, { summary: string }>;
  skillResults: ScheduledSkillResult[];
  schedulerLog: { phase: string; choice: string; reason: string }[];
  /** The scheduler's saved choice until its result is saved, so a resume does not ask again. */
  pendingSkill: { phase: string; skillId: string } | null;
  decisions: { id: string; question: string; choice: string; text: string }[];
  informed: string[];
  authorizedPackages: string[];
  blocked: BlockedWork | null;
  /** Failure reports the next implementation pass must repair. */
  repairs: { id: string; report: string }[];
  repairSignatures: string[];
  guardsPassedRevision: string | null;
  testsPassedRevision: string | null;
  noTestsRegistered: boolean;
  wait: RunWait | null;
  answers: WaitAnswer[];
  answer: string | null;
  /** Why the run stopped, for the report; a limit denial is decided outside any step. */
  unresolved: string[];
  activeMs: number;
};

const initial = (): RunStateData => ({
  schemaVersion: 1,
  mode: null,
  clarifications: [],
  questions: [],
  findings: [],
  searched: {},
  investigationProgress: true,
  plan: null,
  planFeedback: [],
  planRevision: 0,
  testsPlanDigest: null,
  skeleton: null,
  skeletonRevision: 0,
  skeletonFeedback: [],
  approval: null,
  assignments: {},
  skillResults: [],
  schedulerLog: [],
  pendingSkill: null,
  decisions: [],
  informed: [],
  authorizedPackages: [],
  blocked: null,
  repairs: [],
  repairSignatures: [],
  guardsPassedRevision: null,
  testsPassedRevision: null,
  noTestsRegistered: false,
  wait: null,
  answers: [],
  answer: null,
  unresolved: [],
  activeMs: 0,
});

/**
 * The plugin's durable record of one run: findings, decisions, finished assignments and the
 * blocked question. Engine records hold only compact results, so a restarted step reads this
 * and continues instead of repeating edits. Every change is saved before it is relied on.
 */
export class RunState {
  private constructor(
    private readonly file: string,
    private state: RunStateData,
  ) {}

  static async open(file: string): Promise<RunState> {
    try {
      return new RunState(file, JSON.parse(await readFile(file, "utf8")) as RunStateData);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const state = new RunState(file, initial());
      await state.save();
      return state;
    }
  }

  get data(): Readonly<RunStateData> {
    return this.state;
  }

  async update(change: (state: RunStateData) => void): Promise<void> {
    change(this.state);
    await this.save();
  }

  /** The human's answer for a wait, if the host has supplied one. */
  answerFor(waitId: string): WaitAnswer | null {
    return this.state.answers.find((item) => item.waitId === waitId) ?? null;
  }

  private async save(): Promise<void> {
    await writeFile(`${this.file}.tmp`, JSON.stringify(this.state), { mode: 0o600 });
    await rename(`${this.file}.tmp`, this.file);
  }
}
