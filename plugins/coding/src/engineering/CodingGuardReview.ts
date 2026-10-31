import {
  BoundedGuardCheckRunner,
  GuardEnforcementPolicy,
  GuardRegistry,
  GuardRunner,
  JsonValueContract,
  zeroUsage,
  type AgentRunRuntime,
  type EditingResult,
  type GuardTarget,
  type IExecutionContext,
  type IGuardTargetVerifier,
} from "kushibot";
import type { WorkspaceTools } from "../tools/WorkspaceTools";
import type { CodingEngineeringConfiguration } from "./CodingEngineeringConfiguration";
import type { CodingEngineeringSelection } from "./CodingEngineeringSelection";
import type { CodingEngineeringModel } from "./CodingEngineeringModel";
import type { CodingReviewArtifacts } from "./CodingReviewArtifacts";
import { CodingModelGuardCheck } from "./CodingModelGuardCheck";

/** Owns the run's bounded repair counter and approval of one exact workspace revision. */
export class CodingGuardReview implements IGuardTargetVerifier {
  private readonly registry = new GuardRegistry();
  private readonly checks = new Map<string, CodingModelGuardCheck>();
  private readonly enforcement: GuardEnforcementPolicy;
  private readonly runner: GuardRunner;
  private candidate: EditingResult | null = null;
  private acceptedRevision: string | null = null;
  private repairs = 0;
  private terminal: string | null = null;
  private readonly context: IExecutionContext;
  constructor(
    private readonly config: CodingEngineeringConfiguration,
    private readonly selection: CodingEngineeringSelection,
    model: CodingEngineeringModel,
    private readonly tools: WorkspaceTools,
    private readonly artifacts: CodingReviewArtifacts,
    private readonly runtime: AgentRunRuntime,
    private readonly goal: string,
  ) {
    this.context = {
      ...runtime.context,
      scope: {
        ...runtime.context.scope,
        workspaceId: runtime.context.scope.workspaceId ?? runtime.context.scope.scopeId,
      },
    };
    for (const definition of config.settings.definitions.filter(
      (item) => item.guardMode !== "off",
    )) {
      const check = new CodingModelGuardCheck(definition, config.version, model, artifacts);
      this.checks.set(definition.id, check);
      this.registry.registerCheck(check);
      this.registry.registerGuard({
        id: definition.id,
        version: config.version,
        description: definition.description.slice(0, 500),
        instructions: `Review ${definition.label}.`,
        rules: [
          {
            id: `${definition.id}.review`,
            requirement: `The proposed changes satisfy ${definition.label}.`,
            blocking: !definition.advisory,
            checkIds: [check.id],
          },
        ],
      });
    }
    const required = config.settings.definitions
      .filter((item) => item.guardMode === "required")
      .map((item) => item.id);
    this.enforcement = new GuardEnforcementPolicy(this.registry, required);
    this.runner = new GuardRunner(
      this.registry,
      this,
      artifacts,
      new BoundedGuardCheckRunner(runtime.clock, 120_000),
      new JsonValueContract(),
      runtime.clock,
      runtime.ids,
    );
  }
  async apply(candidate: EditingResult): Promise<{ accepted: boolean; feedback: string }> {
    if (this.terminal) throw new Error(this.terminal);
    this.context.signal.throwIfAborted();
    if (!(await this.tools.accepts(candidate)))
      return {
        accepted: false,
        feedback:
          "Refresh CLI status and pass required checks on current files before guard review.",
      };
    this.candidate = candidate;
    this.acceptedRevision = null;
    const target: GuardTarget = {
      workspaceId: this.context.scope.workspaceId!,
      revisionRef: candidate.resultSnapshotRef,
      artifactRefs: candidate.changeArtifactRefs,
    };
    await this.runtime.context.reporter.progress("Selecting guards for the proposed changes.");
    const changes = this.artifacts.reviewChanges(candidate.changeArtifactRefs);
    // Reserve evidence for both the task and changed paths/content; selection never grants permissions.
    const summary = `Task: ${this.goal.slice(0, 250)} Paths: ${candidate.changedPaths.join(", ").slice(0, 300)} Changes: ${JSON.stringify(changes).slice(0, 400)}`;
    const selected = await this.selection.guards(this.registry, summary, target.revisionRef);
    await this.runtime.context.reporter.progress(
      `Reviewing with guards: ${selected.guards.map((item) => item.id).join(", ") || "none"}.`,
    );
    const outcome = await this.runner.run(selected, target, this.context);
    const decision = await this.enforcement.apply({
      report: outcome.report,
      expectedTarget: target,
      stopReason: outcome.stopReason,
    });
    await this.artifacts.record(
      "coding-guard-enforcement",
      { ...outcome, decision, repairs: this.repairs },
      target.revisionRef,
    );
    if (decision.action === "accept" && (await this.verify(target, this.context))) {
      this.acceptedRevision = target.revisionRef;
      await this.runtime.context.reporter.progress(
        `Guard review accepted${decision.warningRuleIds.length ? ` with ${decision.warningRuleIds.length} advisory warning(s)` : ""}.`,
      );
      return { accepted: true, feedback: "Guard review passed on the current files." };
    }
    if (decision.action !== "request-fix")
      return this.stop(
        `Guard review incomplete: ${decision.reasonCodes.join(", ") || "workspace changed"}.`,
      );
    if (this.repairs >= this.config.settings.maxFixCycles)
      return this.stop("Guard repair limit reached; unresolved blockers remain.");
    const operationId = this.runtime.ids.nextId();
    const reserved = await this.runtime.stores.usage.mutate((ledger) =>
      ledger.reserve(operationId, this.runtime.budgetScopeId, { ...zeroUsage, fixes: 1 }),
    );
    if (!reserved.admitted || reserved.replayed)
      return this.stop("Guard repair allowance unavailable.");
    await this.runtime.stores.usage.mutate((ledger) =>
      ledger.settle(operationId, { ...zeroUsage, fixes: 1 }),
    );
    this.repairs++;
    const feedback = decision.blockingRuleIds
      .map((rule) => {
        const id = rule.replace(/\.review$/, "");
        return `${id}: ${this.checks.get(id)?.correction() || "Resolve the blocking rule."}`;
      })
      .join("; ");
    await this.runtime.context.reporter.progress(
      `Guard blockers require repair ${this.repairs}/${this.config.settings.maxFixCycles}: ${feedback.slice(0, 500)}`,
    );
    return {
      accepted: false,
      feedback: `Fix guard blockers, run checks, and refresh status: ${feedback}`.slice(0, 1024),
    };
  }
  async approved(candidate: EditingResult): Promise<boolean> {
    return (
      this.acceptedRevision === candidate.resultSnapshotRef && (await this.tools.accepts(candidate))
    );
  }
  async verify(target: GuardTarget, context: IExecutionContext): Promise<boolean> {
    context.signal.throwIfAborted();
    return (
      !!this.candidate &&
      target.workspaceId === this.context.scope.workspaceId &&
      target.revisionRef === this.candidate.resultSnapshotRef &&
      JSON.stringify(target.artifactRefs) === JSON.stringify(this.candidate.changeArtifactRefs) &&
      (await this.tools.accepts(this.candidate))
    );
  }
  private async stop(message: string): Promise<never> {
    this.terminal = message;
    await this.runtime.context.reporter.progress(message);
    throw new Error(message);
  }
}
