export type WorkflowPoint = Readonly<{ x: number; y: number }>;
export type WorkflowBox = Readonly<{ x: number; y: number; width: number; height: number }>;

/** Optional JSON layout hints preserve a host's curated graph arrangement. */
export type WorkflowPresentation = Readonly<{
  nodes: Readonly<Record<string, WorkflowBox>>;
  edges?: Readonly<Record<string, readonly WorkflowPoint[]>>;
  lanes?: Readonly<Record<string, WorkflowPoint>>;
}>;

/** Serializable display metadata; no executors, React nodes, or provider credentials. */
export type WorkflowAttachment = Readonly<{
  id: string;
  label: string;
  description?: string;
  enabled?: boolean;
}>;

export type WorkflowNode = Readonly<{
  id: string;
  title: string;
  description?: string;
  detail?: string;
  lane?: string;
  kind?: "step" | "human" | "terminal";
  executor?: string;
  models?: readonly string[];
  skills?: readonly WorkflowAttachment[];
  guards?: readonly WorkflowAttachment[];
  policies?: readonly string[];
  maxAttempts?: number;
  pauses?: boolean;
}>;

/** Endpoint names mirror Kushibot's WorkflowTransitionDefinition. */
export type WorkflowEdge = Readonly<{
  id: string;
  fromStepId: string;
  toStepId: string;
  kind?: "forward" | "return" | "retry" | "stop";
  label?: string;
  policy?: string;
  maxTraversals?: number;
  controlId?: string;
}>;

export type WorkflowSelection = Readonly<
  { kind: "graph" } | { kind: "step"; id: string } | { kind: "control"; id: string }
>;

export type WorkflowGraph = Readonly<{
  id: string;
  title: string;
  version?: string;
  description?: string;
  maxTotalAttempts?: number;
  nodes: readonly WorkflowNode[];
  edges: readonly WorkflowEdge[];
  lanes?: readonly Readonly<{ id: string; label: string }>[];
  controls?: readonly Readonly<{ id: string; label: string; value: number }>[];
  overview?: string;
  presentation?: WorkflowPresentation;
}>;
