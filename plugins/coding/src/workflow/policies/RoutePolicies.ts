import type { IPolicy, WorkflowTransitionDecision, WorkflowTransitionInput } from "kushibot";

export type Transition = IPolicy<WorkflowTransitionInput, WorkflowTransitionDecision>;
