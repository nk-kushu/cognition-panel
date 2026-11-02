export type DebugEventDto = Readonly<{
  schemaVersion: 1;
  eventId: string;
  channel: "diagnostic" | "lifecycle";
  /** e.g. "operation.started", "operation.completed", "progress.reported", "policy.applied". */
  type: string;
  level: "trace" | "debug" | "info" | "warn" | "error";
  occurredAtEpochMs: number;
  producerId: string;
  scope: Readonly<{ scopeId: string; projectId: string; workspaceId?: string }>;
  identity: Readonly<{
    operationId: string;
    runId?: string;
    stepRunId?: string;
    sessionId?: string;
    parentOperationId?: string;
  }>;
  trace: Readonly<{
    traceId: string;
    spanId: string;
    parentSpanId: string | null;
    causationEventId: string | null;
  }>;
  payload: Readonly<{
    /** Ordered execution content chunk, up to 1000 characters. */
    content?: string;
    operation?: string;
    summary?: string;
    code?: string;
    count?: number;
    durationMs?: number;
    revision?: number;
    previousState?: string;
    nextState?: string;
    relatedRefs?: readonly string[];
    /** Named measurements: sizes in bytes, counts and token estimates. */
    metrics?: Readonly<Record<string, number>>;
  }>;
}>;
/** A debug event stored in PostgreSQL: its position in its kushibot stream (`run:<id>`). */
export type RecordedDebugEventDto = Readonly<{
  streamId: string;
  sequence: number;
  recordedAtEpochMs: number;
  event: DebugEventDto;
}>;

export type AgentRunStatus =
  "starting" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type DebugRun = Readonly<{
  agentName: string;
  status: AgentRunStatus | null;
  startedAt: string;
}>;
export type DebugEventsViewerProps = Readonly<{
  events: readonly RecordedDebugEventDto[];
  run?: DebugRun | null;
  recording?: boolean;
  loading?: boolean;
  live?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  onBack?: () => void;
  backLabel?: string;
  recordingHelp?: string;
}>;
