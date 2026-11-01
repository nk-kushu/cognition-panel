import type { IExecutionContext } from "kushibot";
import type { AssignmentRunner } from "../../assignments/AssignmentRunner";
import { ReturnRequest } from "../../assignments/StepSignals";
import type { RunContext } from "../../context/RunContext";
import type { SkillPhaseRunner } from "../../engineering/SkillPhaseRunner";
import { DeclarationCheck } from "../../infrastructure/workspace/DeclarationCheck";
import { EditScope } from "../../infrastructure/workspace/EditScope";
import type { ICodingStep } from "../../workflow/CodingStep";
import type { GuardPass } from "../guards/GuardPass";
import { guidanceFor, summarySchema } from "../instructions";

/** Step 5: declarations only, one component per session, then a check of the combined result. */
export class CreateSkeletonStep implements ICodingStep {
  readonly id = "skeleton";
  readonly branch = "code-change" as const;
  private readonly declarations = new DeclarationCheck();

  constructor(
    private readonly run: RunContext,
    private readonly assignments: AssignmentRunner,
    private readonly skills: SkillPhaseRunner,
    private readonly guards: GuardPass,
  ) {}

  async execute(context: IExecutionContext): Promise<string> {
    const { state } = this.run;
    const { plan, skeleton, skeletonFeedback, skeletonRevision, authorizedPackages } = state.data;
    if (!plan) throw new Error("A skeleton needs an accepted plan.");
    if (skeleton?.planDigest === plan.digest && skeletonFeedback.length === 0)
      return "The skeleton already matches the plan.";
    await this.skills.execute("skeleton", context);
    for (const component of plan.value.components) {
      const id = `skeleton:${plan.digest}:${skeletonRevision}:${component.id}`;
      if (this.assignments.isDone(id)) continue;
      await this.assignments.execute<{ summary: string }>(
        {
          id,
          label: `Creating skeleton: ${component.file}`,
          instructions: [
            "Create the proposed structure for one component: files, classes and method signatures.",
            'Bodies of new functions and methods must be exactly: throw new Error("Not implemented"). Keep existing code unchanged.',
            guidanceFor(this.skills.guidance("skeleton")),
            'Return {"summary":"what was declared"}.',
          ]
            .filter(Boolean)
            .join("\n\n"),
          input: {
            component: { ...component, signatures: [...component.signatures] },
            planSummary: plan.value.summary,
            reviewFeedback: skeletonFeedback,
          },
          access: {
            kind: "edit",
            scope: new EditScope({
              paths: [component.file],
              content: { kind: "declarations" },
              authorizedPackages,
            }),
          },
          model: "implementation",
          result: summarySchema,
        },
        context,
      );
    }
    const issues = await this.combinedIssues();
    if (issues.length === 0) {
      const guarded = await this.guards.execute("skeleton", context);
      if (guarded.status === "findings") issues.push(guarded.details.slice(0, 2000));
    }
    if (issues.length) {
      await state.update((data) => {
        data.skeletonFeedback.push(...issues);
        data.skeletonRevision++;
      });
      throw new ReturnRequest("skeleton", issues.join("; ").slice(0, 900));
    }
    const digest = await this.run.copy.revision();
    await state.update((data) => {
      data.skeleton = {
        planDigest: plan.digest,
        digest,
        unchecked: plan.value.components
          .map((component) => component.file)
          .filter((file) => !this.declarations.supports(file)),
      };
      data.skeletonFeedback = [];
      data.skeletonRevision++;
    });
    return `Skeleton covers ${plan.value.components.length} components.`;
  }

  /** Only before implementation: afterwards, later plans may build on implemented code. */
  private async combinedIssues(): Promise<string[]> {
    const { state, copy } = this.run;
    const issues: string[] = [];
    const implemented = Object.keys(state.data.assignments).some((id) =>
      id.startsWith("implement:"),
    );
    for (const { file } of state.data.plan!.value.components) {
      const content = await copy.read(file);
      if (content === null) {
        issues.push(`${file} was not created.`);
        continue;
      }
      if (implemented || !this.declarations.supports(file)) continue;
      issues.push(
        ...this.declarations
          .skeletonIssues(file, await copy.readOriginal(file), content)
          .map((issue) => `${issue.file}: ${issue.message}`),
      );
    }
    return issues;
  }
}
