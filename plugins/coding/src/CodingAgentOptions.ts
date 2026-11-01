import type {
  AgentRunRuntime,
  IArtifactWriter,
  ICliExecutor,
  IDecisionUnit,
  IModelGateway,
  IScopedDebugRecorderFactory,
  ModelProfile,
} from "kushibot";
import type {
  CodingSettings,
  GuardDefinition,
  RequestMode,
  SkillDefinition,
} from "./engineering/types";
import type { RunDirectory } from "./infrastructure/run/RunDirectory";

export type ModelRole =
  | "default"
  | "investigationPlanning"
  | "implementation"
  | "guardReview"
  | "skillScheduler"
  | "answer";

/** Selects a model connection for one role; the run pins the result. */
export interface IModelBindings {
  /** `modelId` is a skill's or guard's own choice; empty uses the role's model. */
  bind(
    role: ModelRole,
    modelId?: string,
  ): Readonly<{ gateway: IModelGateway; profile: ModelProfile }>;
}

/** Everything fixed when a run starts. Saved with the run, so edits never reach it. */
export type PinnedRun = Readonly<{
  schemaVersion: 1;
  message: string;
  files: readonly string[];
  explicitMode: RequestMode | null;
  sourceWorkspace: string;
  projectId: string;
  settings: CodingSettings;
  skills: readonly SkillDefinition[];
  guards: readonly GuardDefinition[];
  memory: readonly Readonly<{ id: string; statement: string }>[];
  conversation: readonly Readonly<{ role: "user" | "agent"; text: string }>[];
  excludedDirectories: readonly string[];
}>;

export type CodingAgentOptions = Readonly<{
  run: RunDirectory;
  pinned: PinnedRun;
  artifacts: IArtifactWriter;
  models: IModelBindings;
  /** JEV in production; any DecisionUnit in tests. */
  decisions: (context: DecisionRuntime) => IDecisionUnit;
  cli: ICliExecutor;
  debug?: IScopedDebugRecorderFactory;
  /** Model call timeout; slower models need more than the library default. */
  modelTimeoutMs?: number;
  maxTurns?: number;
}>;

export type DecisionRuntime = AgentRunRuntime;
