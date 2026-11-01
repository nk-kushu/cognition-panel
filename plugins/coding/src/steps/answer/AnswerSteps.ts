import Joi from "joi";
import type { IExecutionContext } from "kushibot";
import type { AssignmentRunner } from "../../assignments/AssignmentRunner";
import { ReturnRequest, StepStopped } from "../../assignments/StepSignals";
import type { RunContext } from "../../context/RunContext";
import type { SkillPhaseRunner } from "../../engineering/SkillPhaseRunner";
import type { ICodingStep } from "../../workflow/CodingStep";
import type { Investigator } from "../investigation/Investigator";
import { guidanceFor } from "../instructions";
import type { QuestionPlanner } from "../investigation/QuestionPlanner";

const PREPARE = `Work out what must be checked in this project's code to answer the user.
The conversation and project preferences may already answer it, but claims about the current
code must be checked against the code. Return {"questions":[{"question":"...","why":"..."}]},
at most 4; return no questions only when the answer needs no facts about the code.`;

const WRITE = `Answer the user simply. Start with the direct answer, in short sentences and familiar words.
For a question about a function use exactly:
- **What it does:** one simple sentence.
- **Where it is used:** the definition and actual callers, as file paths.
- **Real-life example:** one realistic action in numbered steps, from the user's action to the result.
Base every step on the findings. Mark invented names and sample values as illustrative. If no caller was found, say so instead of inventing a call chain.
Link source files. State clearly anything unresolved. If a code fix looks needed, explain it and wait: never offer it as done.
Return {"answer":"markdown"}.`;

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
