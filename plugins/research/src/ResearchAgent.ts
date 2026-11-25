import {
  Agent,
  AgentRuntimeFactory,
  DefaultAgentAssignmentPolicy,
  ExecutorRegistration,
  ExecutorRegistry,
  JsonValueContract,
  StepPolicyRegistry,
  StructuredTaskExecutor,
  TaskInputContract,
  WorkflowPolicyRegistry,
  type AgentModelBinding,
  type IAgentSetupInput,
  type IAgentWorkflow,
  type IPolicy,
  type IScopedDebugRecorderFactory,
} from "kushibot";
import {
  ResearchAnswerContract,
  ResearchRequestContract,
  type ResearchAnswer,
  type ResearchRequest,
} from "./ResearchRequest";
import type { CapabilityContext, CapabilityModel } from "./capabilities/Capability";
import type { CapabilityRegistry } from "./capabilities/CapabilityRegistry";
import { CapabilityRouter } from "./routing/CapabilityRouter";

export type ResearchModels = Readonly<Record<CapabilityModel, AgentModelBinding>>;

/** What every capability may use, fixed for one chat message. */
export type ResearchEnvironment = CapabilityContext & Readonly<{ progress(message: string): void }>;

/** Routes the message to one capability (step 0), then runs that capability as a single session step. */
class ResearchWorkflow implements IPolicy<IAgentSetupInput<ResearchRequest>, IAgentWorkflow<ResearchAnswer>> {
  private readonly router: CapabilityRouter;
  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly models: ResearchModels,
    private readonly environment: ResearchEnvironment,
  ) {
    this.router = new CapabilityRouter(registry);
  }

  async apply({ task, runtime }: IAgentSetupInput<ResearchRequest>): Promise<IAgentWorkflow<ResearchAnswer>> {
    const route = await this.router.route(task, runtime, this.models.fast);
    const { capability } = route;
    this.environment.progress(`Capability: ${capability.id} (${route.source})`);
    const context: CapabilityContext = { research: this.environment.research };

    const json = new JsonValueContract();
    const tasks = new TaskInputContract(json);
    const answers = new ResearchAnswerContract();
    const factory = runtime.createTaskFactory(
      answers,
      {
        apply: async () => ({
          instructions: capability.instructions(),
          input: { message: route.message, conversation: task.conversation.slice(-10) },
          tools: capability.tools(context),
          acceptance: { apply: async () => ({ accepted: true, feedback: "Accepted." }) },
        }),
      },
      this.models[capability.model],
    );
    const executors = new ExecutorRegistry();
    executors.register(
      new ExecutorRegistration({
        id: capability.id,
        version: "1",
        input: tasks,
        result: answers,
        executor: new StructuredTaskExecutor({
          input: tasks,
          result: answers,
          policy: new DefaultAgentAssignmentPolicy(`Handle the user's message as ${capability.id}.`),
          factory,
          json,
          clock: runtime.clock,
        }),
        json,
        clock: runtime.clock,
      }),
    );
    const policies = new StepPolicyRegistry();
    const inputRef = { id: `${capability.id}-input`, version: "1" };
    const acceptRef = { id: `${capability.id}-accept`, version: "1" };
    policies.registerInput(inputRef, {
      apply: async () => ({ goal: route.message, acceptanceCriteria: ["Return a markdown summary"], sourceRefs: [], filePaths: [] }),
    });
    policies.registerAcceptance(acceptRef, { apply: async () => ({ status: "accepted" }) });
    const workflowPolicies = new WorkflowPolicyRegistry();
    const completionPolicy = { id: "research-complete", version: "1" };
    workflowPolicies.registerCompletion(completionPolicy, { apply: async () => ({ accepted: true }) });
    return {
      definition: {
        id: "research-agent",
        version: "1",
        maxTotalAttempts: 1,
        transitions: [],
        steps: [
          {
            id: capability.id,
            dependencies: [],
            executor: executors.resolve(capability.id, "1").metadata,
            inputPolicy: inputRef,
            acceptancePolicy: acceptRef,
            maxAttempts: 1,
          },
        ],
      },
      executors,
      policies,
      workflowPolicies,
      completionPolicy,
      evidence: { apply: async () => true },
      resultPolicy: {
        apply: async (result) => {
          const checked = await answers.validate(result.results[0]?.result);
          if (!checked.valid) throw new Error("The research agent returned no answer.");
          return checked.value;
        },
      },
      resultContract: answers,
    };
  }
}

export function createResearchAgent(
  options: Readonly<{
    registry: CapabilityRegistry;
    models: ResearchModels;
    environment: ResearchEnvironment;
    debug?: IScopedDebugRecorderFactory;
  }>,
): Agent<ResearchRequest, ResearchAnswer> {
  return new Agent({
    id: "research-agent",
    requestContract: new ResearchRequestContract(),
    workflow: new ResearchWorkflow(options.registry, options.models, options.environment),
    runtime: new AgentRuntimeFactory({
      gateway: options.models.main.gateway,
      profile: options.models.main.profile,
      // A long document takes many turns: read in parts, then one call per fact.
      maxTurns: 90,
      timeoutMs: 25 * 60_000,
      // Large reasoning models can take minutes on a long context.
      modelTimeoutMs: 240_000,
      limits: { modelCalls: 90, toolCalls: 160 },
      ...(options.debug ? { debug: options.debug } : {}),
    }),
  });
}
