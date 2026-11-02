import type { IExecutionContext } from "kushibot";
import { StepStopped } from "../../assignments/StepStopped";
import type { RunContext } from "../../context/RunContext";
import type { TestSuite } from "../../engineering/types";
import type { ICodingStep } from "../../workflow/CodingStep";
import type { FailureRouter } from "../guards/FailureRouter";

/** The suites this run must pass: enabled ones of the selected test types. */
export const requiredSuites = (
  suites: readonly TestSuite[],
  types: readonly string[],
): readonly TestSuite[] => suites.filter((suite) => suite.enabled && types.includes(suite.type));

/**
 * Step 9: runs registered commands directly, with no model. Tests may write temporary output
 * in the stage; that grants no change to source. An environment that cannot run them is
 * reported as blocked verification rather than treated as a reason to rewrite code.
 */
export class RunTestsStep implements ICodingStep {
  readonly id = "run-tests";
  readonly branch = "code-change" as const;

  constructor(
    private readonly run: RunContext,
    private readonly router: FailureRouter,
  ) {}

  async execute(context: IExecutionContext): Promise<string> {
    const { pinned, state, copy, evidence, artifacts } = this.run;
    const revision = await copy.revision();
    const suites = requiredSuites(pinned.settings.testSuites, pinned.settings.testTypes);
    if (suites.length === 0) {
      await state.update((data) => {
        data.noTestsRegistered = true;
        data.testsPassedRevision = revision;
      });
      return "No test types are selected, so no tests were executed.";
    }
    await this.run.status();
    for (const suite of suites) {
      await context.reporter.progress(`Running tests: ${suite.name}.`);
      await copy.syncStage();
      const before = await evidence.revision();
      const result = await this.run.cli.run(
        {
          command: [suite.command, ...suite.args],
          mounts: copy.directoryMounts(true, true),
          workingDirectory: `/workspace/${suite.workingDirectory}`
            .replace(/\/+$/, "")
            .replace(/\/\.$/, ""),
          timeoutMs: suite.timeoutMs,
          maxOutputBytes: 8_192,
        },
        context,
      );
      const { changes } = await copy.stagedChanges();
      const rewritten = changes.filter((change) => change.before !== null);
      await copy.syncStage();
      await artifacts.record(
        `Test run: ${suite.name}`,
        `Real result of the ${suite.name} suite on the changed code.`,
        {
          suite: suite.id,
          revision,
          exitCode: result.exitCode,
          output: result.log.slice(0, 200_000),
        },
        revision,
      );
      const passed = result.exitCode === 0 && !result.timedOut && rewritten.length === 0;
      evidence.recordCheck(
        suite.id,
        before,
        await evidence.revision(),
        passed ? 0 : result.exitCode,
      );
      if (passed) continue;
      if (result.exitCode === null || result.timedOut || [126, 127].includes(result.exitCode))
        throw new StepStopped({
          code: "no-progress",
          message: `Verification is blocked: ${suite.name} could not run (exit ${result.exitCode}, timed out: ${result.timedOut}). ${result.output.slice(0, 500)}`,
        });
      if (rewritten.length)
        throw new StepStopped({
          code: "no-progress",
          message: `Verification is blocked: ${suite.name} changed source files: ${rewritten.map((change) => change.path).join(", ")}.`,
        });
      return this.router.route("test", `${suite.name} failed:\n${result.output}`, context);
    }
    await state.update((data) => {
      data.testsPassedRevision = revision;
    });
    return `${suites.length} test suites passed.`;
  }
}
