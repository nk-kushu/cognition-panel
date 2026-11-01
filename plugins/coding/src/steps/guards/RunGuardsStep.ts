import type { IExecutionContext } from "kushibot";
import type { RunContext } from "../../context/RunContext";
import type { ICodingStep } from "../../workflow/CodingStep";
import type { FailureRouter } from "./FailureRouter";
import type { GuardPass } from "./GuardPass";

/** Step 8: the finished change must pass; findings go to whichever step can resolve them. */
export class RunGuardsStep implements ICodingStep {
  readonly id = "guards";
  readonly branch = "code-change" as const;

  constructor(
    private readonly run: RunContext,
    private readonly guards: GuardPass,
    private readonly router: FailureRouter,
  ) {}

  async execute(context: IExecutionContext): Promise<string> {
    const { copy, state } = this.run;
    const revision = await copy.revision();
    if (state.data.guardsPassedRevision === revision) return "Guards passed on this revision.";
    const outcome = await this.guards.execute("guards", context);
    if (outcome.status === "findings") return this.router.route("guard", outcome.details, context);
    await state.update((data) => {
      data.guardsPassedRevision = revision;
    });
    return outcome.summary;
  }
}
