import type { IExecutionContext } from "kushibot";
import { ReturnRequest } from "../../assignments/ReturnRequest";
import { StepStopped } from "../../assignments/StepStopped";
import { WaitRequest } from "../../assignments/WaitRequest";
import type { RunContext } from "../../context/RunContext";
import { DeclarationCheck } from "../../infrastructure/workspace/DeclarationCheck";
import type { ICodingStep } from "../../workflow/CodingStep";

const MAX_CHANGE_CHARS = 60_000;

/** Step 6: no model. Approval binds to the exact skeleton version the human saw. */
export class HumanReviewStep implements ICodingStep {
  readonly id = "human-review";
  readonly branch = "code-change" as const;
  private readonly declarations = new DeclarationCheck();

  constructor(private readonly run: RunContext) {}

  async execute(_context: IExecutionContext): Promise<string> {
    const { state } = this.run;
    const { plan, skeleton, approval } = state.data;
    if (!plan || !skeleton) throw new Error("Review needs a plan and a skeleton.");
    if (approval?.digest === skeleton.digest && approval.planDigest === plan.digest)
      return "This exact skeleton is already approved.";
    const wait = state.data.wait;
    const answer = wait?.kind === "skeleton-review" ? state.answerFor(wait.id) : null;
    if (!wait || !answer) throw await this.ask();
    await state.update((data) => {
      data.wait = null;
    });
    if (answer.choice === "request-changes" || answer.choice === "change-plan") {
      const feedback = answer.text || "The reviewer requested changes.";
      await state.update((data) => {
        if (answer.choice === "change-plan") data.planFeedback.push(feedback);
        else data.skeletonFeedback.push(feedback);
      });
      throw new ReturnRequest(answer.choice === "change-plan" ? "plan" : "skeleton", feedback);
    }
    if (answer.choice !== "approve" || answer.digest !== skeleton.digest)
      throw new StepStopped({
        code: "no-progress",
        message: "The approval does not match the skeleton version under review.",
      });
    await state.update((data) => {
      data.approval = { digest: skeleton.digest, planDigest: plan.digest };
    });
    return "Skeleton approved.";
  }

  private async ask(): Promise<WaitRequest> {
    const { state, copy, pinned } = this.run;
    const { plan, skeleton } = state.data;
    const { changedPaths } = await this.run.status();
    const changes = await Promise.all(
      changedPaths.map(async (file) => ({
        path: file,
        before: (await copy.readOriginal(file))?.slice(0, MAX_CHANGE_CHARS) ?? null,
        after: (await copy.read(file))?.slice(0, MAX_CHANGE_CHARS) ?? null,
      })),
    );
    const declared = await Promise.all(
      plan!.value.components.map(async (component) => {
        const content = await copy.read(component.file);
        return {
          file: component.file,
          signatures: [...component.signatures],
          symbols:
            content !== null && this.declarations.supports(component.file)
              ? this.declarations.symbols(component.file, content)
              : [],
        };
      }),
    );
    return new WaitRequest(
      `review-${skeleton!.digest.slice(-40)}`,
      "skeleton-review",
      {
        goal: pinned.message,
        plan: plan!.value.summary,
        digest: skeleton!.digest,
        files: changedPaths,
        declared,
        tests: plan!.value.tests.map((test) => ({ ...test, files: [...test.files] })),
        changes,
        notLanguageChecked: skeleton!.unchecked,
      },
      "The skeleton is ready for your review.",
    );
  }
}
