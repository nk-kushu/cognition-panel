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
  AssistantAnswerContract,
  AssistantRequestContract,
  type AssistantAnswer,
  type AssistantRequest,
} from "./AssistantRequest";
import type { CapabilityContext, CapabilityModel } from "./capabilities/Capability";
import type { CapabilityRegistry } from "./capabilities/CapabilityRegistry";
import { CapabilityRouter } from "./routing/CapabilityRouter";
import type { TemplateCatalog } from "./TemplateCatalog";

/**
 * The result contract takes exactly {"answer": "<markdown>"}. The capabilities describe the content; this says the
 * shape, because a model told only to write "sections" invents its own fields and has its result rejected.
 */
export const FINAL_ANSWER_RULE =
  'Your final action is {"kind":"final","value":{"answer":"<markdown>"}}: the whole answer, with its sections, as ONE Markdown string in "answer". Never put other fields in "value" (no "idea", "templates", "order" or similar): anything but "answer" is rejected.';

export type AssistantModels = Readonly<Record<CapabilityModel, AgentModelBinding>>;

/** What every capability may use, fixed for one chat message. */
export type AssistantEnvironment = Readonly<{
  catalog: TemplateCatalog;
  progress(message: string): void;
}>;

/** Routes the message to one capability (step 0), then runs that capability as a single session step. */
class AssistantWorkflow implements IPolicy<IAgentSetupInput<AssistantRequest>, IAgentWorkflow<AssistantAnswer>> {
  private readonly router: CapabilityRouter;
  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly models: AssistantModels,
    private readonly environment: AssistantEnvironment,
  ) {
    this.router = new CapabilityRouter(registry);
  }

  async apply({ task, runtime }: IAgentSetupInput<AssistantRequest>): Promise<IAgentWorkflow<AssistantAnswer>> {
    const route = await this.router.route(task, runtime, this.models.fast);
    const { capability } = route;
    this.environment.progress(`Capability: ${capability.id} (${route.source})`);
    const context: CapabilityContext = this.environment;

    const json = new JsonValueContract();
    const tasks = new TaskInputContract(json);
    const answers = new AssistantAnswerContract();
    const factory = runtime.createTaskFactory(
      answers,
      {
        apply: async () => ({
          instructions: `${capability.instructions()}\n\n${FINAL_ANSWER_RULE}`,
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
      apply: async () => ({ goal: route.message, acceptanceCriteria: ["Return a markdown answer"], sourceRefs: [], filePaths: [] }),
    });
    policies.registerAcceptance(acceptRef, { apply: async () => ({ status: "accepted" }) });
    const workflowPolicies = new WorkflowPolicyRegistry();
    const completionPolicy = { id: "assistant-complete", version: "1" };
    workflowPolicies.registerCompletion(completionPolicy, { apply: async () => ({ accepted: true }) });
    return {
      definition: {
        id: "cognition-assistant",
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
          if (!checked.valid) throw new Error("The assistant returned no answer.");
          return checked.value;
        },
      },
      resultContract: answers,
    };
  }
}

export function createAssistantAgent(
  options: Readonly<{
    registry: CapabilityRegistry;
    models: AssistantModels;
    environment: AssistantEnvironment;
    debug?: IScopedDebugRecorderFactory;
  }>,
): Agent<AssistantRequest, AssistantAnswer> {
  return new Agent({
    id: "cognition-assistant",
    requestContract: new AssistantRequestContract(),
    workflow: new AssistantWorkflow(options.registry, options.models, options.environment),
    runtime: new AgentRuntimeFactory({
      gateway: options.models.main.gateway,
      profile: options.models.main.profile,
      maxTurns: 30,
      timeoutMs: 15 * 60_000,
      // Large reasoning models can take minutes on a long context.
      modelTimeoutMs: 240_000,
      limits: { modelCalls: 40, toolCalls: 40 },
      ...(options.debug ? { debug: options.debug } : {}),
    }),
  });
}
