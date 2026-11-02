import type { IExecutionContext } from "kushibot";
import { ReturnRequest } from "../../assignments/ReturnRequest";
import { StepStopped } from "../../assignments/StepStopped";
import { decisionText, digestOf, type RunContext } from "../../context/RunContext";

/** Sends a guard or test failure to whichever step can actually resolve it. */
export class FailureRouter {
  constructor(private readonly run: RunContext) {}

  async route(source: string, report: string, context: IExecutionContext): Promise<never> {
    const { state } = this.run;
    const signature = digestOf([source, report.slice(0, 4000)]);
    if (state.data.repairSignatures.includes(signature))
      throw new StepStopped({
        code: "no-progress",
        message: `The same ${source} failure remains after a repair: ${report.slice(0, 500)}`,
      });
    const outcome = await this.run.decide(
      {
        purpose: "classify-failure",
        question: "What does this failure show?",
        options: ["code-defect", "missing-evidence", "design-problem"],
        evidence: [
          { ref: "plan", text: decisionText(state.data.plan?.value.summary ?? "") },
          { ref: "failure", text: decisionText(report) },
        ],
      },
      context,
    );
    const kind = outcome.status === "answered" ? outcome.answer.choice : "code-defect";
    await state.update((data) => {
      data.repairSignatures.push(signature);
      if (kind === "design-problem") data.planFeedback.push(report.slice(0, 2000));
      else if (kind === "missing-evidence")
        data.questions.push({
          id: `q${data.questions.length + 1}`,
          question: `What explains this ${source} failure? ${report.slice(0, 700)}`,
          why: "It blocks completion.",
          status: "open",
        });
      else data.repairs.push({ id: signature, report: report.slice(0, 8000) });
    });
    if (kind === "design-problem") throw new ReturnRequest("plan", report.slice(0, 900));
    if (kind === "missing-evidence") throw new ReturnRequest("investigation", report.slice(0, 900));
    throw new ReturnRequest("code-fix", report.slice(0, 900));
  }
}
