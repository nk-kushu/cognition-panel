import type { WorkflowGraph, WorkflowNode } from "./types";

type Registration = Readonly<{ id: string; version: string }>;

/** Structural subset of Kushibot's serializable WorkflowDefinition; no runtime dependency. */
export type WorkflowDefinitionJson = Readonly<{
  id: string;
  version: string;
  maxTotalAttempts: number;
  steps: readonly Readonly<{
    id: string;
    dependencies: readonly string[];
    executor: Registration;
    inputPolicy: Registration;
    acceptancePolicy: Registration;
    maxAttempts: number;
  }>[];
  transitions: readonly Readonly<{
    id: string;
    fromStepId: string;
    toStepId: string;
    policy: Registration;
    maxTraversals: number;
  }>[];
}>;

/** Dependencies advance execution; Kushibot transitions revisit an ancestor or the same step. */
export function fromWorkflowDefinition(
  definition: WorkflowDefinitionJson,
  metadata: Readonly<Record<string, Partial<Omit<WorkflowNode, "id">>>> = {},
): WorkflowGraph {
  const ref = (value: Registration) => `${value.id}@${value.version}`;
  return {
    id: definition.id,
    title: definition.id,
    version: definition.version,
    maxTotalAttempts: definition.maxTotalAttempts,
    nodes: definition.steps.map((step) => ({
      id: step.id,
      title: step.id,
      executor: ref(step.executor),
      policies: [ref(step.inputPolicy), ref(step.acceptancePolicy)],
      maxAttempts: step.maxAttempts,
      ...metadata[step.id],
    })),
    edges: [
      ...definition.steps.flatMap((step) =>
        step.dependencies.map((dependency, index) => ({
          id: `dependency:${step.id}:${index}`,
          fromStepId: dependency,
          toStepId: step.id,
          kind: "forward" as const,
        })),
      ),
      ...definition.transitions.map((transition) => ({
        id: `transition:${transition.id}`,
        fromStepId: transition.fromStepId,
        toStepId: transition.toStepId,
        kind:
          transition.fromStepId === transition.toStepId ? ("retry" as const) : ("return" as const),
        label: transition.id,
        policy: ref(transition.policy),
        maxTraversals: transition.maxTraversals,
      })),
    ],
  };
}
