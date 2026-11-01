import Joi from "joi";
import type { IExecutionContext } from "kushibot";
import type { AssignmentRunner } from "../../assignments/AssignmentRunner";
import type { RunContext } from "../../context/RunContext";

type Planned = Readonly<{ questions: readonly Readonly<{ question: string; why: string }>[] }>;

/** One session that names what must be understood; its job ends with the accepted questions. */
export class QuestionPlanner {
  constructor(
    private readonly run: RunContext,
    private readonly assignments: AssignmentRunner,
  ) {}

  async plan(instructions: string, minimum: number, context: IExecutionContext): Promise<number> {
    const planned = await this.assignments.execute<Planned>(
      {
        id: "plan-investigation:questions",
        label: "Planning the investigation.",
        instructions,
        input: { fileNames: "Available through cli." },
        access: { kind: "names" },
        model: "investigationPlanning",
        result: Joi.object({
          questions: Joi.array()
            .items(
              Joi.object({
                question: Joi.string().min(1).max(900).required(),
                why: Joi.string().min(1).max(900).required(),
              }),
            )
            .min(minimum)
            .max(8)
            .required(),
        }),
      },
      context,
    );
    await this.run.state.update((data) => {
      data.questions = planned.questions.map((item, index) => ({
        id: `q${index + 1}`,
        ...item,
        status: "open",
      }));
    });
    return planned.questions.length;
  }
}
