import type { IExecutionContext } from "kushibot";
import type { Assignment, AssignmentRunner } from "../../assignments/AssignmentRunner";
import { StepStopped } from "../../assignments/StepStopped";
import type { RunContext } from "../../context/RunContext";
import type { PlanChange } from "../../context/RunState";
import type { SkillPhaseRunner } from "../../engineering/SkillPhaseRunner";
import { EditScope } from "../../infrastructure/workspace/EditScope";
import type { ICodingStep } from "../../workflow/CodingStep";
import { guidanceFor, summarySchema } from "../instructions";
import { IMPLEMENTATION_INSTRUCTIONS, REPAIR_INSTRUCTIONS } from "./instructions";

type Summary = Readonly<{ summary: string }>;

/** Step 7: finished changes survive returns, so blocked work continues where it stopped. */
export class ImplementStep implements ICodingStep {
  readonly id = "implement";
  readonly branch = "code-change" as const;

  constructor(
    private readonly run: RunContext,
    private readonly assignments: AssignmentRunner,
    private readonly skills: SkillPhaseRunner,
  ) {}

  async execute(context: IExecutionContext): Promise<string> {
    const { state } = this.run;
    const { plan, skeleton, approval } = state.data;
    if (
      !plan ||
      !skeleton ||
      approval?.digest !== skeleton.digest ||
      approval.planDigest !== plan.digest
    )
      throw new StepStopped({
        code: "no-progress",
        message: "Implementation cannot start without approval of the current skeleton.",
      });
    await this.skills.execute("implementation", context);
    for (const change of plan.value.changes) {
      const id = `implement:${plan.digest}:${change.id}`;
      if (!this.assignments.isDone(id))
        await this.assignments.execute(this.change(id, change), context);
    }
    for (const repair of state.data.repairs) {
      await this.assignments.execute(this.repair(repair), context);
      await state.update((data) => {
        data.repairs = data.repairs.filter((item) => item.id !== repair.id);
      });
    }
    return `Implemented ${plan.value.changes.length} changes.`;
  }

  private change(id: string, change: PlanChange): Assignment<Summary> {
    const { plan, authorizedPackages } = this.run.state.data;
    return {
      id,
      label: `Implementing: ${change.description.slice(0, 120)}`,
      instructions: [
        IMPLEMENTATION_INSTRUCTIONS,
        guidanceFor(this.skills.guidance("implementation")),
      ]
        .filter(Boolean)
        .join("\n\n"),
      input: {
        change: { ...change, symbols: [...change.symbols] },
        planSummary: plan!.value.summary,
        tests: plan!.value.tests.map((test) => ({
          behavior: test.behavior,
          files: [...test.files],
        })),
        findings: this.run.findings(),
        resolvedQuestion:
          this.run.state.data.blocked?.assignmentId === id
            ? this.run.state.data.blocked.question
            : null,
      },
      access: {
        kind: "edit",
        scope: new EditScope({
          paths: [change.file],
          content: change.symbols.length
            ? { kind: "symbols", symbols: change.symbols }
            : { kind: "any" },
          authorizedPackages,
        }),
      },
      model: "implementation",
      result: summarySchema,
    };
  }

  private repair(repair: Readonly<{ id: string; report: string }>): Assignment<Summary> {
    const { plan, authorizedPackages } = this.run.state.data;
    return {
      id: `implement:repair:${repair.id}`,
      label: "Repairing a reported defect.",
      instructions: REPAIR_INSTRUCTIONS,
      input: {
        failureReport: repair.report,
        planSummary: plan!.value.summary,
        files: plan!.value.changes.map((change) => change.file),
        findings: this.run.findings(),
      },
      access: {
        kind: "edit",
        scope: new EditScope({
          paths: [...new Set(plan!.value.changes.map((change) => change.file))],
          content: { kind: "any" },
          authorizedPackages,
        }),
      },
      model: "implementation",
      result: summarySchema,
    };
  }
}
