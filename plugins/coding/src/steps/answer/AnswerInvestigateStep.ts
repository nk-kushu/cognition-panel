import type { IExecutionContext } from "kushibot";

import type { RunContext } from "../../context/RunContext";

import type { ICodingStep } from "../../workflow/CodingStep";

import type { Investigator } from "../investigation/Investigator";

export class AnswerInvestigateStep implements ICodingStep {
  readonly id = "answer-investigate";
  readonly branch = "answer-only" as const;

  constructor(
    private readonly run: RunContext,
    private readonly investigator: Investigator,
  ) {}

  async execute(context: IExecutionContext): Promise<string> {
    const { state, pinned } = this.run;
    for (let round = 0; round < pinned.settings.limits.answerRounds; round++) {
      if (!state.data.questions.some((item) => item.status === "open")) break;
      // Repeating a search that found nothing new cannot help.
      if (!(await this.investigator.round(context))) break;
    }
    const open = state.data.questions.filter((item) => item.status === "open");
    if (open.length)
      await state.update((data) => {
        data.questions = data.questions.map((item) =>
          item.status === "open" ? { ...item, status: "unresolved" } : item,
        );
      });
    return `${state.data.findings.length} findings; ${open.length} questions unresolved.`;
  }
}
