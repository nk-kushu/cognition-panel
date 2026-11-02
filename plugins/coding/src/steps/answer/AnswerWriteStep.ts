import Joi from "joi";

import type { IExecutionContext } from "kushibot";

import type { AssignmentRunner } from "../../assignments/AssignmentRunner";

import { ReturnRequest } from "../../assignments/ReturnRequest";
import { StepStopped } from "../../assignments/StepStopped";

import type { RunContext } from "../../context/RunContext";

import type { SkillPhaseRunner } from "../../engineering/SkillPhaseRunner";

import type { ICodingStep } from "../../workflow/CodingStep";

import { guidanceFor } from "../instructions";

const WRITE = `Answer the user simply. Start with the direct answer, in short sentences and familiar words.
For a question about a function use exactly:
- **What it does:** one simple sentence.
- **Where it is used:** the definition and actual callers, as file paths.
- **Real-life example:** one realistic action in numbered steps, from the user's action to the result.
Base every step on the findings. Mark invented names and sample values as illustrative. If no caller was found, say so instead of inventing a call chain.
Link source files. State clearly anything unresolved. If a code fix looks needed, explain it and wait: never offer it as done.
Return {"answer":"markdown"}.`;

export class AnswerWriteStep implements ICodingStep {
  readonly id = "answer-write";
  readonly branch = "answer-only" as const;

  constructor(
    private readonly run: RunContext,
    private readonly assignments: AssignmentRunner,
    private readonly skills: SkillPhaseRunner,
  ) {}

  async execute(context: IExecutionContext): Promise<string> {
    const { state } = this.run;
    // A simple question found nothing to check, so it bypasses skill scheduling.
    if (state.data.findings.length > 0)
      await this.skills.execute("answer", context).catch((error: unknown) => {
        // This branch has no return path: a skill may wait for the user, not reopen the run.
        if (error instanceof ReturnRequest)
          throw new StepStopped({ code: "no-progress", message: error.reason });
        throw error;
      });
    const sources = [
      ...new Set(state.data.findings.flatMap((item) => item.sources.map((source) => source.path))),
    ];
    const { answer } = await this.assignments
      .execute<{ answer: string }>(
        {
          id: "answer-write:answer",
          label: "Writing the answer.",
          instructions: [WRITE, guidanceFor(this.skills.guidance("answer"))]
            .filter(Boolean)
            .join("\n\n"),
          input: {
            findings: this.run.findings(),
            unresolved: state.data.questions
              .filter((item) => item.status === "unresolved")
              .map((item) => item.question),
            conversation: this.run.pinned.conversation.map((turn) => ({ ...turn })),
          },
          access: sources.length ? { kind: "files", paths: sources } : null,
          model: "answer",
          result: Joi.object({ answer: Joi.string().min(1).max(12_000).required() }),
        },
        context,
      )
      .catch((error: unknown) => {
        // A fast-path session may not ask to widen itself; report the gap instead.
        if (error instanceof StepStopped) throw error;
        throw new StepStopped({
          code: "no-progress",
          message: `The answer could not be completed: ${error instanceof Error ? error.message : "unknown"}`,
        });
      });
    await state.update((data) => {
      data.answer = answer;
    });
    return "Answer written.";
  }
}
