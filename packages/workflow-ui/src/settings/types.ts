import type { WorkflowGraph } from "../types";

export type AgentDefinition = Readonly<{
  id: string;
  version: number;
  versionId: string;
  kind: "skill" | "guard";
  enabled: boolean;
  content: Readonly<Record<string, unknown>>;
}>;
export type ProjectMemory = Readonly<{ id: string; statement: string; createdAt: string }>;
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
export type AgentSettings = Readonly<{
  limits: Readonly<Record<string, number>>;
  models: Readonly<Record<string, string>>;
  testWritingPrompt: string;
  testTypes: readonly string[];
  testSuites: readonly TestSuite[];
}>;
export type SettingsNotice = Readonly<{ type: "success" | "error"; text: string }>;
export type AgentSettingsStore = Readonly<{
  settings: AgentSettings | null;
  notice: SettingsNotice | null;
  dirty: boolean;
  update(settings: AgentSettings): void;
  save(): Promise<void>;
}>;
export type AgentDefinitionsStore = Readonly<{
  items: readonly AgentDefinition[];
  error: string | null;
  change(work: () => Promise<unknown>): Promise<void>;
}>;

export interface AgentSettingsApi {
  settings(): Promise<{ settings: unknown; revision: number }>;
  saveSettings(
    settings: AgentSettings,
    baseRevision: number,
  ): Promise<{ settings: unknown; revision: number }>;
  definitions(): Promise<readonly AgentDefinition[]>;
  createDefinition(kind: "skill" | "guard", content: object): Promise<AgentDefinition>;
  saveDefinition(id: string, enabled: boolean, content: object): Promise<AgentDefinition>;
  deleteDefinition(id: string): Promise<void>;
  memory(): Promise<readonly ProjectMemory[]>;
  addMemory(statement: string): Promise<ProjectMemory>;
  updateMemory(id: string, statement: string): Promise<ProjectMemory>;
  deleteMemory(id: string): Promise<void>;
}

export type ConfigurableStep = Readonly<{
  id: string;
  title: string;
  summary: string;
  laneLabel?: string;
  pauses?: boolean;
  models: readonly string[];
  limits: readonly string[];
  returns: readonly string[];
  skillPhase?: string;
  guardPhase?: string;
  showTestPrompt?: boolean;
  showTests?: boolean;
  guidance?: Readonly<{ title: string; text: string }>;
}>;
export type AgentSettingsSchema = Readonly<{
  limits: readonly Readonly<{ key: string; label: string; min: number; max: number }>[];
  models: readonly Readonly<{ key: string; label: string }>[];
  defaultModelKey: string;
  overviewLimits: readonly string[];
  steps: readonly ConfigurableStep[];
  routes: Readonly<
    Record<string, Readonly<{ label: string; summary: string; limit: string; target: string }>>
  >;
  totalReturnsKey?: string;
  verificationBlockedMessage?: string;
  modes: readonly Readonly<{ value: string; label: string }>[];
  skillPhases: readonly Readonly<{ value: string; label?: string }>[];
  guardPhases: readonly Readonly<{ value: string; label?: string }>[];
  skillInputs: readonly Readonly<{ value: string; label?: string }>[];
  newDefinitions: Readonly<Record<"skill" | "guard", Readonly<Record<string, unknown>>>>;
  builtInDefinitions: Readonly<
    Record<"skill" | "guard", readonly Readonly<Record<string, unknown>>[]>
  >;
}>;

export type AgentSettingsPanelProps = Readonly<{
  schema: AgentSettingsSchema;
  graph: WorkflowGraph;
  api: AgentSettingsApi;
  store: AgentSettingsStore;
  definitions: AgentDefinitionsStore;
  disabled: boolean;
  requestMode: string;
  onRequestModeChange(mode: string): void;
  apiBaseUrl: string;
}>;
export const uncoveredTestTypes = (settings: AgentSettings): readonly string[] =>
  settings.testTypes.filter(
    (type) => !settings.testSuites.some((suite) => suite.enabled && suite.type === type),
  );
