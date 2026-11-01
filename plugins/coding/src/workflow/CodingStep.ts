import type { IExecutionContext } from "kushibot";
import type { StepBranch } from "./WorkflowGraph";

export type { StepBranch };

/** One numbered stage: a container for focused work that ends with one short summary. */
export interface ICodingStep {
  readonly id: string;
  readonly branch: StepBranch;
  /** Throws a step signal to return, wait or stop. */
  execute(context: IExecutionContext): Promise<string>;
}
