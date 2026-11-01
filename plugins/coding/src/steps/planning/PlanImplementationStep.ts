import Joi from "joi";
import type { IExecutionContext } from "kushibot";
import type { AssignmentRunner } from "../../assignments/AssignmentRunner";
import { StepStopped, WaitRequest } from "../../assignments/StepSignals";
import { decisionText, digestOf, type RunContext } from "../../context/RunContext";
import type { ImplementationPlan } from "../../context/RunState";
import type { SkillPhaseRunner } from "../../engineering/SkillPhaseRunner";
import type { ICodingStep } from "../../workflow/CodingStep";
import { guidanceFor, pathSchema } from "../instructions";
import { PLANNING_INSTRUCTIONS } from "./instructions";

const id = Joi.string()
  .pattern(/^[A-Za-z0-9_-]{1,40}$/)
  .required();
const planSchema = Joi.object({
  summary: Joi.string().min(1).max(4000).required(),
  tests: Joi.array()
    .items(
      Joi.object({
        id,
        behavior: Joi.string().min(1).max(1000).required(),
        type: Joi.string().min(1).max(64).required(),
        files: Joi.array().items(pathSchema).min(1).max(8).required(),
      }),
    )
    .max(16)
    .required(),
  components: Joi.array()
    .items(
      Joi.object({
        id,
        description: Joi.string().min(1).max(1000).required(),
        file: pathSchema.required(),
        signatures: Joi.array().items(Joi.string().max(500)).max(32).required(),
      }),
    )
    .max(16)
    .required(),
  changes: Joi.array()
    .items(
      Joi.object({
        id,
        description: Joi.string().min(1).max(1000).required(),
        file: pathSchema.required(),
        symbols: Joi.array().items(Joi.string().max(200)).max(16).required(),
      }),
    )
    .min(1)
    .max(32)
    .required(),
  packages: Joi.array().items(Joi.string().max(214)).max(16).required(),
});

/** Step 3. A return only repeats planning when the new evidence actually changes the plan. */
export class PlanImplementationStep implements ICodingStep {
  readonly id = "plan-implementation";
  readonly branch = "code-change" as const;

  constructor(
    private readonly run: RunContext,
    private readonly assignments: AssignmentRunner,
    private readonly skills: SkillPhaseRunner,
  ) {}

  async execute(context: IExecutionContext): Promise<string> {
    const { state } = this.run;
    if (await this.reusable(context)) return "The accepted plan still holds.";
    await this.skills.execute("planning", context);
    const plan = await this.write(context);
    const missing = this.unapproved(plan);
    if (missing.length === 0) return this.accept(plan);
    const asked = `packages-${digestOf(missing)}`;
    if (!state.data.decisions.some((item) => item.id === asked))
      throw new WaitRequest(
        asked,
        "decision",
        {
          question: `The plan adds ${missing.join(", ")}. Should it?`,
          findings: plan.summary,
          recommendation: "",
          choices: [
            { label: "Allow these packages", packages: missing },
            { label: "Do not add them", packages: [] },
          ],
        },
        `Approval needed to add ${missing.join(", ")}.`,
      );
    // Declined: the plan must work without them, with the decision in its context.
    await state.update((data) => {
      data.planFeedback.push(`The user did not approve: ${missing.join(", ")}.`);
    });
    const revised = await this.write(context);
    if (this.unapproved(revised).length === 0) return this.accept(revised);
    throw new StepStopped({
      code: "no-progress",
      message: `The plan still needs packages the user did not approve: ${this.unapproved(revised).join(", ")}.`,
    });
  }

  private unapproved(plan: ImplementationPlan): readonly string[] {
    const { authorizedPackages } = this.run.state.data;
    return plan.packages.filter((name) => !authorizedPackages.includes(name));
  }

  private async reusable(context: IExecutionContext): Promise<boolean> {
    const { state } = this.run;
    const { plan, planFeedback, blocked, findings } = state.data;
    if (!plan || planFeedback.length > 0) return false;
    if (!blocked) return true;
    const outcome = await this.run.decide(
      {
        purpose: "plan-impact",
        question: "Does the new finding contradict or change the accepted plan?",
        options: ["plan-still-holds", "plan-must-change"],
        evidence: [
          { ref: "plan", text: decisionText(plan.value.summary) },
          { ref: "question", text: decisionText(blocked.question) },
          { ref: "finding", text: decisionText(findings.at(-1)?.answer ?? "None.") },
        ],
      },
      context,
    );
    // Without a clear answer, revisit the plan: the human reviews any resulting change.
    return outcome.status === "answered" && outcome.answer.choice === "plan-still-holds";
  }

  private async write(context: IExecutionContext): Promise<ImplementationPlan> {
    const { state, pinned } = this.run;
    const revision = state.data.planRevision;
    await state.update((data) => {
      data.planRevision++;
    });
    return this.assignments.execute<ImplementationPlan>(
      {
        id: `plan-implementation:plan:${revision}`,
        label: "Planning the implementation.",
        instructions: [PLANNING_INSTRUCTIONS, guidanceFor(this.skills.guidance("planning"))]
          .filter(Boolean)
          .join("\n\n"),
        input: {
          findings: this.run.findings(),
          skillResults: state.data.skillResults.map((item) => ({
            skill: item.skillId,
            summary: item.summary,
            result: item.result as never,
          })),
          testTypes: [...pinned.settings.testTypes],
          revisionFeedback: state.data.planFeedback,
          previousPlan: (state.data.plan?.value ?? null) as never,
          blockedQuestion: (state.data.blocked ?? null) as never,
        },
        access: { kind: "project" },
        model: "default",
        result: planSchema,
        validate: async (plan) => {
          const unknown = plan.tests.filter(
            (test) => !pinned.settings.testTypes.includes(test.type),
          );
          return unknown.length
            ? `Use only the requested test types: ${pinned.settings.testTypes.join(", ") || "none"}.`
            : null;
        },
      },
      context,
    );
  }

  private async accept(plan: ImplementationPlan): Promise<string> {
    const { state, artifacts } = this.run;
    await artifacts.record("Implementation plan", "What will be built for the goal.", plan);
    await state.update((data) => {
      data.plan = { digest: digestOf(plan), value: plan };
      data.planFeedback = [];
      data.blocked = null;
    });
    return `Planned ${plan.changes.length} changes.`;
  }
}
