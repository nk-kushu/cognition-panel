import type { IExecutionContext } from "kushibot";
import type { RunContext } from "../../context/RunContext";
import type { ICodingStep } from "../../workflow/CodingStep";
import type { QuestionPlanner } from "./QuestionPlanner";

const INSTRUCTIONS = `Decide what must be understood before changing code for the goal.
Return {"questions":[{"question":"one specific question","why":"why the change depends on it"}]}, at most 8.
Ask about this project's code, not general knowledge. Do not plan the change itself.`;

/** Step 1. */
export class PlanInvestigationStep implements ICodingStep {
  readonly id = "plan-investigation";
  readonly branch = "code-change" as const;

  constructor(
    private readonly run: RunContext,
    private readonly planner: QuestionPlanner,
  ) {}

  async execute(context: IExecutionContext): Promise<string> {
    const existing = this.run.state.data.questions.length;
    if (existing > 0) return `${existing} questions are already planned.`;
    return `Planned ${await this.planner.plan(INSTRUCTIONS, 1, context)} questions.`;
  }
}
