import {
  type EditingResult,
  type IAgentSetupInput,
  type IAgentWorkflow,
  type IArtifactWriter,
  type IPolicy,
  type IResultContract,
  type JsonValue,
} from "kushibot";
import { stat } from "node:fs/promises";
import path from "node:path";
import { AssignmentRunner } from "../assignments/AssignmentRunner";
import type { CodingAgentOptions } from "../CodingAgentOptions";
import { RunArtifacts } from "../context/RunArtifacts";
import { RunContext } from "../context/RunContext";
import type { RunState } from "../context/RunState";
import { SkillPhaseRunner } from "../engineering/SkillPhaseRunner";
import { WorkingCopy } from "../infrastructure/workspace/WorkingCopy";
import { AnswerInvestigateStep } from "../steps/answer/AnswerInvestigateStep";
import { AnswerPrepareStep } from "../steps/answer/AnswerPrepareStep";
import { AnswerWriteStep } from "../steps/answer/AnswerWriteStep";
import { ImplementStep } from "../steps/editing/ImplementStep";
import { FailureRouter } from "../steps/guards/FailureRouter";
import { GuardPass } from "../steps/guards/GuardPass";
import { RunGuardsStep } from "../steps/guards/RunGuardsStep";
import { InvestigateStep } from "../steps/investigation/InvestigateStep";
import { Investigator } from "../steps/investigation/Investigator";
import { PlanInvestigationStep } from "../steps/investigation/PlanInvestigationStep";
import { QuestionPlanner } from "../steps/investigation/QuestionPlanner";
import { ChooseModeStep } from "../steps/mode/ChooseModeStep";
import { PlanImplementationStep } from "../steps/planning/PlanImplementationStep";
import { HumanReviewStep } from "../steps/review/HumanReviewStep";
import { CreateSkeletonStep } from "../steps/skeleton/CreateSkeletonStep";
import { WriteTestsStep } from "../steps/tests/WriteTestsStep";
import { RunTestsStep, requiredSuites } from "../steps/verification/RunTestsStep";
import type { ICodingStep } from "./CodingStep";
import { CodingWorkflow } from "./CodingWorkflow";
import type { ReturnAllowance } from "./policies/ReturnAllowance";
import { WORKFLOW_STEPS, type WorkflowStepId } from "./WorkflowGraph";

export type CodingTask = Readonly<{ digest: string }>;

export type CodingResult =
  | Readonly<{ mode: "answer-only"; answer: string; unresolved: readonly string[] }>
  | Readonly<{ mode: "code-change"; change: EditingResult; noTestsRegistered: boolean }>;

const resultContract: IResultContract<CodingResult> = {
  id: "coding-result",
  version: "2",
  validate: async (value) => ({ valid: true, value: value as CodingResult }),
};

/** Prepares one run: its working copy, services, steps and completion rules. */
export class CodingRunWorkflow implements IPolicy<
  IAgentSetupInput<CodingTask>,
  IAgentWorkflow<CodingResult>
> {
  constructor(
    private readonly options: CodingAgentOptions,
    private readonly state: RunState,
    private readonly writer: IArtifactWriter,
  ) {}

  async apply({ runtime }: IAgentSetupInput<CodingTask>): Promise<IAgentWorkflow<CodingResult>> {
    const { pinned, cli, models } = this.options;
    const copy = await this.workingCopy();
    const artifacts = new RunArtifacts(this.writer, runtime, pinned.message);
    const context = new RunContext(
      pinned,
      this.state,
      copy,
      cli,
      artifacts,
      runtime,
      models,
      this.options.decisions(runtime),
      this.writer,
      requiredSuites(pinned.settings.testSuites, pinned.settings.testTypes).map(
        (suite) => suite.id,
      ),
    );
    await context.initialize();

    const assignments = new AssignmentRunner(context);
    const skills = new SkillPhaseRunner(context, assignments);
    const investigator = new Investigator(context, assignments);
    const planner = new QuestionPlanner(context, assignments);
    const router = new FailureRouter(context);
    const guards = new GuardPass(context);
    let allowance: ReturnAllowance | null = null;
    const steps: Readonly<Record<WorkflowStepId, ICodingStep>> = {
      mode: new ChooseModeStep(context, () => allowance!),
      "answer-prepare": new AnswerPrepareStep(context, planner),
      "answer-investigate": new AnswerInvestigateStep(context, investigator),
      "answer-write": new AnswerWriteStep(context, assignments, skills),
      "plan-investigation": new PlanInvestigationStep(context, planner),
      investigate: new InvestigateStep(context, assignments, investigator),
      "plan-implementation": new PlanImplementationStep(context, assignments, skills),
      "write-tests": new WriteTestsStep(context, assignments, skills),
      skeleton: new CreateSkeletonStep(context, assignments, skills, guards),
      "human-review": new HumanReviewStep(context),
      implement: new ImplementStep(context, assignments, skills),
      guards: new RunGuardsStep(context, guards, router),
      "run-tests": new RunTestsStep(context, router),
    };
    const workflow = new CodingWorkflow(
      WORKFLOW_STEPS.map(({ id }) => steps[id]),
      context,
      pinned.settings.limits,
      runtime.clock,
    ).create();
    allowance = workflow.allowance;

    const completionPolicy = { id: "coding-complete", version: "2" };
    workflow.workflowPolicies.registerCompletion(completionPolicy, {
      apply: async () => {
        const problem = await this.completionProblem(context);
        return problem === null
          ? { accepted: true }
          : { accepted: false, code: "CODING_EVIDENCE_MISMATCH", message: problem };
      },
    });
    return {
      definition: workflow.definition,
      executors: workflow.executors,
      policies: workflow.policies,
      workflowPolicies: workflow.workflowPolicies,
      completionPolicy,
      evidence: { apply: async () => true },
      resultPolicy: {
        apply: async () => {
          const { data } = this.state;
          if (data.mode === "answer-only")
            return {
              mode: "answer-only" as const,
              answer: data.answer ?? "",
              unresolved: data.questions
                .filter((item) => item.status === "unresolved")
                .map((item) => item.question),
            };
          const change = await context.status();
          return {
            mode: "code-change" as const,
            change: {
              ...change,
              summary: data.plan?.value.summary.slice(0, 2000) ?? change.summary,
            },
            noTestsRegistered: data.noTestsRegistered,
          };
        },
      },
      resultContract,
      artifacts: () =>
        ({ ...context.evidence.evidence(), ...artifacts.evidence() }) as Record<string, JsonValue>,
    };
  }

  /** Workflow code rechecks the end state; accepted steps alone do not prove it. */
  private async completionProblem(context: RunContext): Promise<string | null> {
    const { data } = this.state;
    if (data.mode === "answer-only")
      return data.answer ? null : "The answer-only run produced no answer.";
    const revision = await context.copy.revision();
    if (data.guardsPassedRevision !== revision) return "Guards did not pass on the final files.";
    if (data.testsPassedRevision !== revision) return "Tests did not pass on the final files.";
    if (
      !data.skeleton ||
      data.approval?.digest !== data.skeleton.digest ||
      data.approval.planDigest !== data.plan?.digest
    )
      return "The final work does not trace to an approved skeleton.";
    const status = await context.status();
    return status.unresolved.length === 0 ? null : status.unresolved.join("; ").slice(0, 1000);
  }

  private async workingCopy(): Promise<WorkingCopy> {
    const { run, pinned } = this.options;
    const created = await stat(path.join(run.workspacePath, "manifest.json")).then(
      () => true,
      () => false,
    );
    return created
      ? WorkingCopy.open(run.workspacePath, pinned.sourceWorkspace, pinned.excludedDirectories)
      : WorkingCopy.create(run.workspacePath, pinned.sourceWorkspace, pinned.excludedDirectories);
  }
}
