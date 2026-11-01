import type { IScopedDebugRecorderFactory } from "kushibot";
import type { WaitAnswer } from "../../context/RunState";
import type { CodingSettings, GuardDefinition, SkillDefinition } from "../../engineering/types";

/** What the server loads from PostgreSQL for the project; the agent process has no database. */
export type ChatHostContext = Readonly<{
  projectId: string;
  settings: Partial<CodingSettings> | null;
  skills: readonly SkillDefinition[];
  guards: readonly GuardDefinition[];
  memory: readonly Readonly<{ id: string; statement: string }>[];
  conversation: readonly Readonly<{ role: "user" | "agent"; text: string }>[];
}>;

/** What the Cognition Panel chat passes to `chat`; see the plugin README.md. */
export interface ChatRequest {
  readonly message: string;
  /** In memory only; excluded from pinned settings and artifacts. */
  readonly credentials?: Readonly<Record<string, string>>;
  readonly configuration?: Readonly<Record<string, unknown>>;
  /** Workspace-relative attachments: context for the goal, not an access allowlist. */
  readonly files: readonly string[];
  /** Absolute path of the project checkout. It is copied; the agent never edits it. */
  readonly workspace: string;
  /** Aborted when the user stops the run. */
  readonly signal: AbortSignal;
  /** Reports a status message for the chat. */
  progress(message: string): void;
  readonly debug?: IScopedDebugRecorderFactory;
  /** Absent outside Cognition Panel; the run then uses default settings and no saved definitions. */
  readonly host?: ChatHostContext;
  /** Set when this message answers a waiting run. Starting a new run is not a resume. */
  readonly resume?: Readonly<{ runId: string; answer: WaitAnswer }>;
}
