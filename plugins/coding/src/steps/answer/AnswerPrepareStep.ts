import type { IExecutionContext } from "kushibot";

import type { RunContext } from "../../context/RunContext";

import type { ICodingStep } from "../../workflow/CodingStep";

import type { QuestionPlanner } from "../investigation/QuestionPlanner";

const PREPARE = `Work out what must be checked in this project's code to answer the user.
The conversation and project preferences may already answer it, but claims about the current
code must be checked against the code. Return {"questions":[{"question":"...","why":"..."}]},
at most 4; return no questions only when the answer needs no facts about the code.`;

/** Fast path: read-only by construction, with its own bounded rounds in this one step. */
export class AnswerPrepareStep implements ICodingStep {
  readonly id = "answer-prepare";
  readonly branch = "answer-only" as const;

  constructor(
    private readonly run: RunContext,
    private readonly planner: QuestionPlanner,
  ) {}

  async execute(context: IExecutionContext): Promise<string> {
    const planned = await this.planner.plan(PREPARE, 0, context);
    return planned ? `${planned} questions to check.` : "No investigation is needed.";
  }
}
