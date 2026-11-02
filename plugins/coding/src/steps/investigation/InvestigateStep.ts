import Joi from "joi";
import type { IExecutionContext } from "kushibot";
import type { AssignmentRunner } from "../../assignments/AssignmentRunner";
import { ReturnRequest } from "../../assignments/ReturnRequest";
import type { RunContext } from "../../context/RunContext";
import type { ICodingStep } from "../../workflow/CodingStep";
import type { Investigator } from "./Investigator";

const CHECK = `Check whether the findings answer the questions well enough to plan the change.
Each finding must be supported by its sources. Return {"verdict":"ready","question":""}, or
{"verdict":"needs-information","question":"the exact unanswered question"}.`;

type Check = Readonly<{ verdict: "ready" | "needs-information"; question: string }>;

/** Step 2: code checks that every question has evidence; a focused checker judges enough. */
export class InvestigateStep implements ICodingStep {
  readonly id = "investigate";
  readonly branch = "code-change" as const;

  constructor(
    private readonly run: RunContext,
    private readonly assignments: AssignmentRunner,
    private readonly investigator: Investigator,
  ) {}

  async execute(context: IExecutionContext): Promise<string> {
    const { state } = this.run;
    await this.investigator.recheckFindings();
    const open = () => state.data.questions.filter((item) => item.status === "open");
    if (open().length > 0) await this.investigator.round(context);
    if (open().length > 0)
      throw new ReturnRequest(
        "investigation",
        `Unanswered: ${open()
          .map((item) => item.question)
          .join(" | ")}`,
      );
    const check = await this.assignments.execute<Check>(
      {
        id: `investigate:check:${state.data.findings.length}`,
        label: "Checking the investigation.",
        instructions: CHECK,
        input: { questions: state.data.questions, findings: this.run.findings() },
        access: null,
        model: "investigationPlanning",
        result: Joi.object({
          verdict: Joi.string().valid("ready", "needs-information").required(),
          question: Joi.string().allow("").max(900).required(),
        }),
      },
      context,
    );
    if (check.verdict === "needs-information" && check.question.trim()) {
      await state.update((data) => {
        data.questions.push({
          id: `q${data.questions.length + 1}`,
          question: check.question,
          why: "The investigation checker found this unanswered.",
          status: "open",
        });
        data.investigationProgress = true;
      });
      throw new ReturnRequest("investigation", check.question);
    }
    return `${state.data.findings.length} findings are ready.`;
  }
}
