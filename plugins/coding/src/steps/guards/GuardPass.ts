import {
  BoundedGuardCheckRunner,
  ConservativeGuardSelectionPolicy,
  GuardEnforcementPolicy,
  GuardRegistry,
  GuardRunner,
  GuardSelectionService,
  JsonValueContract,
  type GuardSelection,
  type GuardTarget,
  type IExecutionContext,
  type IGuardCheck,
  type IGuardTargetVerifier,
} from "kushibot";
import { StepStopped } from "../../assignments/StepStopped";
import { decisionText, type RunContext } from "../../context/RunContext";
import type { GuardDefinition, GuardPhase } from "../../engineering/types";
import { CommandGuardCheck } from "./CommandGuardCheck";
import { type GuardFeedback } from "./GuardChecks";
import { ModelGuardCheck } from "./ModelGuardCheck";

const SELECTION_BATCH = 8;

export type GuardPassResult =
  | Readonly<{ status: "passed"; summary: string }>
  | Readonly<{ status: "findings"; details: string }>;

/**
 * Runs one phase's guards through kushibot's guard framework. The caller decides where blocking
 * findings go; incomplete verification stops the run wherever it happens.
 */
export class GuardPass implements IGuardTargetVerifier {
  private target: GuardTarget | null = null;

  constructor(private readonly run: RunContext) {}

  async verify(target: GuardTarget): Promise<boolean> {
    return (
      target.revisionRef === this.target?.revisionRef &&
      (await this.run.copy.revision()) === target.revisionRef
    );
  }

  async execute(phase: GuardPhase, context: IExecutionContext): Promise<GuardPassResult> {
    const { pinned, copy, runtime, artifacts } = this.run;
    const revision = await copy.revision();
    const guards = pinned.guards.filter(
      (guard) => guard.selection !== "off" && guard.phases.includes(phase),
    );
    const { changedPaths, changeArtifactRefs } = await this.run.status();
    if (guards.length === 0 || changedPaths.length === 0)
      return { status: "passed", summary: "No guards apply." };

    const feedback: GuardFeedback = new Map();
    const registry = new GuardRegistry();
    for (const guard of guards) this.register(registry, guard, feedback);
    const scoped: IExecutionContext = {
      ...context,
      scope: { ...context.scope, workspaceId: context.scope.workspaceId ?? context.scope.scopeId },
    };
    const target: GuardTarget = {
      workspaceId: scoped.scope.workspaceId!,
      revisionRef: revision,
      artifactRefs: changeArtifactRefs,
    };
    this.target = target;
    const selected = await this.select(registry, guards, changedPaths, scoped);
    await context.reporter.progress(
      `Running guards: ${selected.guards.map((item) => item.id).join(", ") || "none"}.`,
    );
    const outcome = await new GuardRunner(
      registry,
      this,
      artifacts,
      new BoundedGuardCheckRunner(runtime.clock, 900_000),
      new JsonValueContract(),
      runtime.clock,
      runtime.ids,
    ).run(selected, target, scoped);
    const required = guards
      .filter((guard) => guard.selection === "required")
      .map((guard) => guard.id);
    const decision = await new GuardEnforcementPolicy(registry, required).apply({
      report: outcome.report,
      expectedTarget: target,
      stopReason: outcome.stopReason,
    });
    await artifacts.record(
      "Guard enforcement",
      "Whether the guards allow this change to complete.",
      { decision, report: outcome.report },
      revision,
    );
    if (decision.action === "accept")
      return {
        status: "passed",
        summary: `Guards passed${decision.warningRuleIds.length ? ` with ${decision.warningRuleIds.length} advisory warnings` : ""}.`,
      };
    const details = [...feedback.values()].join("\n").slice(0, 6000);
    if (decision.action === "request-fix") return { status: "findings", details };
    throw new StepStopped({
      code: "no-progress",
      message: `Verification is incomplete, so the change was not accepted: ${decision.reasonCodes.join(", ")}. ${details.slice(0, 800)}`,
    });
  }

  private register(registry: GuardRegistry, guard: GuardDefinition, feedback: GuardFeedback): void {
    const { models } = this.run;
    const checks: IGuardCheck[] = [];
    if (guard.type !== "llm" && guard.check)
      checks.push(new CommandGuardCheck(guard, guard.check, this.run, feedback));
    if (guard.type !== "deterministic")
      checks.push(
        new ModelGuardCheck(guard, this.run, feedback, () =>
          models.bind("guardReview", guard.model),
        ),
      );
    checks.forEach((check) => registry.registerCheck(check));
    registry.registerGuard({
      id: guard.id,
      version: guard.versionId,
      description: guard.purpose.slice(0, 500),
      instructions: `Check ${guard.name}.`,
      rules: [
        {
          id: `${guard.id}.rule`,
          requirement: `The change satisfies ${guard.name}.`,
          blocking: guard.blocking,
          checkIds: checks.map((check) => check.id),
        },
      ],
    });
  }

  private async select(
    registry: GuardRegistry,
    guards: readonly GuardDefinition[],
    paths: readonly string[],
    context: IExecutionContext,
  ): Promise<GuardSelection> {
    const { runtime, pinned } = this.run;
    const service = new GuardSelectionService(
      registry,
      this.run.decisions,
      new ConservativeGuardSelectionPolicy(true),
      runtime.ids,
      runtime.clock,
    );
    const summary = decisionText(
      `Task: ${pinned.message.slice(0, 400)} Paths: ${paths.join(", ")}`,
    );
    const chosen: GuardSelection[] = [];
    for (let offset = 0; offset < guards.length; offset += SELECTION_BATCH) {
      const batch = guards.slice(offset, offset + SELECTION_BATCH);
      const result = await service.select(
        batch.filter((guard) => guard.selection === "required").map((guard) => guard.id),
        batch.filter((guard) => guard.selection === "automatic").map((guard) => guard.id),
        summary,
        this.run.control(context),
      );
      if (
        result.stopReason ||
        result.selection.pendingOperationRefs.length ||
        result.selection.unresolvedGuardIds.length
      )
        throw new StepStopped({
          code: "no-progress",
          message: "Guard selection is incomplete, so the change was not accepted.",
        });
      chosen.push(result.selection);
    }
    return {
      schemaVersion: 1,
      guards: chosen.flatMap((item) => [...item.guards]),
      unresolvedGuardIds: [],
      pendingOperationRefs: [],
    };
  }
}
