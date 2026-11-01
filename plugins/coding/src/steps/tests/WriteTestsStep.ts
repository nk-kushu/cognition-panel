import type { IExecutionContext } from "kushibot";
import type { AssignmentRunner } from "../../assignments/AssignmentRunner";
import { StepStopped } from "../../assignments/StepSignals";
import type { RunContext } from "../../context/RunContext";
import type { SkillPhaseRunner } from "../../engineering/SkillPhaseRunner";
import { uncoveredTestTypes } from "../../engineering/types";
import { EditScope } from "../../infrastructure/workspace/EditScope";
import type { ICodingStep } from "../../workflow/CodingStep";
import { guidanceFor, summarySchema } from "../instructions";

/** Step 4: one session per behavior group; each may touch only its test files and fixtures. */
export class WriteTestsStep implements ICodingStep {
  readonly id = "write-tests";
  readonly branch = "code-change" as const;

  constructor(
    private readonly run: RunContext,
    private readonly assignments: AssignmentRunner,
    private readonly skills: SkillPhaseRunner,
  ) {}

  async execute(context: IExecutionContext): Promise<string> {
    const { state, pinned } = this.run;
    const { plan, authorizedPackages } = state.data;
    if (!plan) throw new Error("Tests need an accepted plan.");
    // A required check that cannot run is known now; finding out at Step 9 only wastes the work.
    const uncovered = uncoveredTestTypes(pinned.settings);
    if (uncovered.length)
      throw new StepStopped({
        code: "no-progress",
        message: `Verification is blocked: no enabled suite runs ${uncovered.join(", ")} tests.`,
      });
    if (state.data.testsPlanDigest === plan.digest) return "Tests already match the plan.";
    await this.skills.execute("test-writing", context);
    for (const group of plan.value.tests) {
      const id = `write-tests:${plan.digest}:${group.id}`;
      if (this.assignments.isDone(id)) continue;
      await this.assignments.execute<{ summary: string }>(
        {
          id,
          label: `Writing tests: ${group.behavior.slice(0, 120)}`,
          instructions: [
            "Write tests for one planned behavior. The code under test may not exist yet; do not implement it.",
            pinned.settings.testWritingPrompt,
            guidanceFor(this.skills.guidance("test-writing")),
            'Return {"summary":"what the tests cover"}.',
          ]
            .filter(Boolean)
            .join("\n\n"),
          input: {
            behavior: group.behavior,
            type: group.type,
            files: [...group.files],
            planSummary: plan.value.summary,
            findings: this.run.findings(),
          },
          access: {
            kind: "edit",
            scope: new EditScope({
              paths: group.files,
              content: { kind: "any" },
              authorizedPackages,
            }),
          },
          model: "implementation",
          result: summarySchema,
        },
        context,
      );
    }
    await state.update((data) => {
      data.testsPlanDigest = plan.digest;
    });
    return `Wrote ${plan.value.tests.length} test groups.`;
  }
}
