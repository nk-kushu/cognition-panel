import type { IExecutionContext } from "kushibot";
import { StepStopped } from "../../assignments/StepStopped";
import { WaitRequest } from "../../assignments/WaitRequest";
import { decisionText, type RunContext } from "../../context/RunContext";
import type { RequestMode } from "../../engineering/types";
import type { ICodingStep } from "../../workflow/CodingStep";
import type { ReturnAllowance } from "../../workflow/policies/ReturnAllowance";

const CLARIFICATION = "Should I explain this, or change the code?";
const CHOICES: readonly Readonly<{ label: string; mode: RequestMode }>[] = [
  { label: "Explain it", mode: "answer-only" },
  { label: "Change the code", mode: "code-change" },
];

/** Step 0: honors an explicit choice, otherwise lets JEV classify the request. */
export class ChooseModeStep implements ICodingStep {
  readonly id = "mode";
  readonly branch = "any" as const;

  constructor(
    private readonly run: RunContext,
    private readonly allowance: () => ReturnAllowance,
  ) {}

  async execute(context: IExecutionContext): Promise<string> {
    const { state, pinned } = this.run;
    if (state.data.mode) return `Mode: ${state.data.mode}.`;
    if (pinned.explicitMode) return this.select(pinned.explicitMode, "the user's choice");
    const waited = state.data.wait;
    const answer = waited ? state.answerFor(waited.id) : null;
    if (waited && answer) {
      const chosen = CHOICES.find((choice) => choice.label === answer.choice);
      await state.update((data) => {
        data.wait = null;
        data.clarifications.push({
          question: CLARIFICATION,
          answer: [answer.choice, answer.text].filter(Boolean).join(": "),
        });
      });
      if (chosen) return this.select(chosen.mode, "the user's answer");
    }
    const outcome = await this.run.decide(
      {
        purpose: "choose-request-mode",
        question:
          'Does the user want an explanation (answer-only), a code change (code-change), or is the intent unclear (needs-clarification)? A question mark alone does not mean answer-only: "Can you fix login?" requests a change.',
        options: ["answer-only", "code-change", "needs-clarification"],
        evidence: [
          { ref: "request", text: decisionText(pinned.message) },
          ...pinned.conversation.slice(-4).map((turn, index) => ({
            ref: `conversation:${index}`,
            text: decisionText(`${turn.role}: ${turn.text}`),
          })),
          ...state.data.clarifications.map((item, index) => ({
            ref: `clarification:${index}`,
            text: decisionText(`${item.question} ${item.answer}`),
          })),
        ],
      },
      context,
    );
    if (outcome.status === "unavailable" || outcome.status === "invalid-output")
      throw new StepStopped({
        code: "no-progress",
        message:
          "JEV could not classify this request, so the mode was not guessed. Check KUSHEX_JEV_API_KEY, or choose Explain or Change in the composer.",
      });
    const choice = outcome.status === "answered" ? outcome.answer.choice : "needs-clarification";
    if (choice === "answer-only" || choice === "code-change") return this.select(choice, "JEV");
    return this.clarify();
  }

  private async clarify(): Promise<never> {
    const { state, runtime } = this.run;
    const denied = this.allowance().denied(await runtime.stores.workflow.read(), "clarification");
    if (denied)
      throw new StepStopped({
        code: "limit-reached",
        message: `${denied} The intent is still unclear.`,
      });
    throw new WaitRequest(
      `clarify-${state.data.clarifications.length}`,
      "clarification",
      {
        question: CLARIFICATION,
        findings: "",
        recommendation: "",
        choices: CHOICES.map(({ label }) => ({ label, packages: [] })),
      },
      CLARIFICATION,
    );
  }

  private async select(mode: RequestMode, source: string): Promise<string> {
    await this.run.state.update((data) => {
      data.mode = mode;
    });
    return `Mode: ${mode}, from ${source}.`;
  }
}
