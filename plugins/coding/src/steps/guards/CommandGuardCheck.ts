import type { GuardCheckInput, GuardFinding, IExecutionContext, IGuardCheck } from "kushibot";

import type { RunContext } from "../../context/RunContext";

import type { GuardCommand, GuardDefinition } from "../../engineering/types";
import { type GuardFeedback, findings } from "./GuardChecks";

/** Exit codes that mean the check itself could not run: never a pass, and not a code defect. */
const NOT_RUN = new Set([126, 127]);

/** Runs a saved command in the same isolated environment; the model cannot substitute one. */
export class CommandGuardCheck implements IGuardCheck {
  readonly id: string;
  readonly version: string;

  constructor(
    private readonly guard: GuardDefinition,
    private readonly check: GuardCommand,
    private readonly run: RunContext,
    private readonly feedback: GuardFeedback,
  ) {
    this.id = `${guard.id}.command`;
    this.version = guard.versionId;
  }

  async evaluate(input: GuardCheckInput, context: IExecutionContext): Promise<unknown> {
    const { copy, cli, artifacts } = this.run;
    await copy.syncStage();
    const { command, args, script, workingDirectory, timeoutMs, successExitCodes } = this.check;
    const result = await cli.run(
      {
        command: script ? ["/bin/sh", "-c", script] : [command, ...args],
        mounts: copy.directoryMounts(true, true),
        workingDirectory: `/workspace/${workingDirectory}`.replace(/\/+$/, "").replace(/\/\.$/, ""),
        timeoutMs,
        maxOutputBytes: 8_192,
      },
      context,
    );
    // Guards check source; a command that rewrites it has not checked what was reviewed.
    const { changes } = await copy.stagedChanges();
    const rewritten = changes.filter((change) => change.before !== null);
    await copy.syncStage();
    const verdict: GuardFinding["verdict"] =
      result.exitCode === null ||
      result.timedOut ||
      NOT_RUN.has(result.exitCode) ||
      rewritten.length
        ? "unknown"
        : successExitCodes.includes(result.exitCode)
          ? "pass"
          : "fail";
    const evidenceRef = await artifacts.record(
      `Guard: ${this.guard.name}`,
      `Real result of the ${this.guard.name} check on the changed code.`,
      {
        guardVersion: this.guard.versionId,
        revisionRef: input.target.revisionRef,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        rewritten: rewritten.map((change) => change.path),
        output: result.log.slice(0, 200_000),
      },
      input.target.revisionRef,
    );
    if (verdict !== "pass")
      this.feedback.set(this.guard.id, `${this.guard.name}: ${result.output}`);
    return {
      revisionRef: input.target.revisionRef,
      findings: findings(
        input,
        verdict,
        verdict === "pass"
          ? "COMMAND_PASSED"
          : verdict === "fail"
            ? "COMMAND_FAILED"
            : "COMMAND_NOT_VERIFIED",
        evidenceRef,
      ),
    };
  }
}
