import {
  ExecutorRegistration,
  ExecutorRegistry,
  JsonValueContract,
  StepPolicyRegistry,
  WorkflowPolicyRegistry,
  type IClock,
  type IResultContract,
  type JsonValue,
  type RegistrationRef,
  type WorkflowDefinition,
  type WorkflowTransitionDefinition,
} from "kushibot";
import type { RunContext } from "../context/RunContext";
import type { CodingLimits } from "../engineering/types";
import type { ICodingStep } from "./CodingStep";
import { CodingStepExecutor, type StepResult } from "./CodingStepExecutor";
import { ReturnAllowance, type ReturnCategory } from "./policies/ReturnAllowance";
import { ReturnRoutePolicy, WaitAnsweredPolicy } from "./policies/RoutePolicies";
import {
  RETURN_ROUTES,
  WORKFLOW_STEPS,
  type ReturnRoute,
  type WorkflowStep,
} from "./WorkflowGraph";

/** Waits per run; a safety bound, since each reopens a step and uses an engine attempt. */
export const MAX_WAITS = 12;

const anything: IResultContract<JsonValue> = {
  id: "coding-step-json",
  version: "1",
  validate: async (value) => ({ valid: true, value: value as JsonValue }),
};

/**
 * The state machine. Steps form one chain, because a return may only target an ancestor and
 * completion requires every step: branch selection therefore leaves the other branch's steps
 * finishing without work. Returns invalidate later steps, and those reuse results that are
 * still valid, so a return repeats only what it affects.
 */
export class CodingWorkflow {
  constructor(
    private readonly steps: readonly ICodingStep[],
    private readonly run: RunContext,
    private readonly limits: CodingLimits,
    private readonly clock: IClock,
  ) {}

  create() {
    const json = new JsonValueContract();
    const executors = new ExecutorRegistry();
    const policies = new StepPolicyRegistry();
    const inputPolicy = { id: "coding-input", version: "1" };
    const acceptancePolicy = { id: "coding-accept", version: "1" };
    policies.registerInput(inputPolicy, {
      apply: async ({ stepId }) => ({ stepId }),
    });
    policies.registerAcceptance(acceptancePolicy, {
      apply: async ({ candidate }) => {
        const result = candidate as unknown as StepResult;
        return result.kind === "done"
          ? { status: "accepted" }
          : { status: "rejected", code: "RETURN_REQUESTED", message: result.reason };
      },
    });

    const attempts = 1 + this.limits.totalReturns + MAX_WAITS;
    const definitionSteps = this.steps.map((step, index) => {
      const registration = new ExecutorRegistration({
        id: `coding-${step.id}`,
        version: "2",
        input: anything,
        result: anything,
        executor: new CodingStepExecutor(step, this.run),
        json,
        clock: this.clock,
      });
      executors.register(registration);
      return {
        id: step.id,
        dependencies: index === 0 ? [] : [this.steps[index - 1]!.id],
        executor: registration.metadata,
        inputPolicy,
        acceptancePolicy,
        maxAttempts: Math.min(64, attempts),
      };
    });

    const { transitions, categories } = this.transitions();
    const workflowPolicies = new WorkflowPolicyRegistry();
    const allowance = new ReturnAllowance(this.limits, categories);
    const route = (name: ReturnRoute): RegistrationRef => ({ id: `route-${name}`, version: "1" });
    for (const name of Object.keys(RETURN_ROUTES) as ReturnRoute[])
      workflowPolicies.registerTransition(
        route(name),
        new ReturnRoutePolicy(name, allowance, this.run.state),
      );
    workflowPolicies.registerTransition(WAIT, new WaitAnsweredPolicy());

    const definition: WorkflowDefinition = {
      id: "coding",
      version: "3",
      maxTotalAttempts: Math.min(
        1024,
        this.steps.length * (2 + this.limits.totalReturns) + 2 * MAX_WAITS,
      ),
      transitions,
      steps: definitionSteps,
    };
    return { definition, executors, policies, workflowPolicies, allowance };
  }

  private transitions() {
    const transitions: WorkflowTransitionDefinition[] = [];
    const categories = new Map<string, ReturnCategory>();
    const maxTraversals = 1 + this.limits.totalReturns + MAX_WAITS;
    const steps: readonly WorkflowStep[] = WORKFLOW_STEPS;
    for (const { id: stepId, pauses } of steps) {
      if (!pauses) continue;
      const id = `${stepId}-answered`;
      transitions.push({ id, fromStepId: stepId, toStepId: stepId, policy: WAIT, maxTraversals });
      if (stepId === "mode") categories.set(id, "clarification");
    }
    for (const { id: fromStepId, returns } of steps)
      for (const route of returns) {
        const id = `${fromStepId}-to-${route}`;
        transitions.push({
          id,
          fromStepId,
          toStepId: RETURN_ROUTES[route].target,
          policy: { id: `route-${route}`, version: "1" },
          maxTraversals,
        });
        categories.set(id, route);
      }
    return { transitions, categories };
  }
}

const WAIT: RegistrationRef = { id: "wait-answered", version: "1" };
