import {
  BoundedDecisionUnit,
  BudgetedModelCall,
  DebugRecordingModelGateway,
  DecisionPromptBuilder,
  DecisionRequestContract,
  JsonValueContract,
  ModelRequestValidator,
  StructuredModelDecisionProvider,
  type AgentRunRuntime,
  type IModelGateway,
  type ModelProfile,
  type IExecutionContext,
} from "kushibot";

/** Every selection and review uses the coding run's budget, deadline, and debug recorder. */
export class CodingEngineeringModel {
  readonly decisions: BoundedDecisionUnit;
  private readonly calls: BudgetedModelCall;
  constructor(
    private readonly runtime: AgentRunRuntime,
    gateway: IModelGateway,
    private readonly profile: ModelProfile,
    private readonly timeoutMs: number,
  ) {
    this.calls = new BudgetedModelCall(
      new DebugRecordingModelGateway(gateway, runtime.debug),
      profile,
      runtime.stores.usage,
      runtime.budgetScopeId,
      runtime.clock,
      new ModelRequestValidator(),
    );
    const json = new JsonValueContract();
    this.decisions = new BoundedDecisionUnit(
      new StructuredModelDecisionProvider(
        this.calls,
        new DecisionPromptBuilder(),
        {
          upperBound: async (prompt) => Buffer.byteLength(JSON.stringify(prompt)) + 1024,
        },
        Math.min(512, profile.maxOutputTokens),
      ),
      new DecisionRequestContract(json),
      json,
      runtime.clock,
    );
  }
  control(context = this.runtime.context) {
    return {
      operationId: this.runtime.ids.nextId(),
      signal: context.signal,
      deadlineEpochMs: context.deadlineEpochMs,
      timeoutMs: this.timeoutMs,
    };
  }
  async review(
    instructions: string,
    evidence: unknown,
    context: IExecutionContext,
  ): Promise<unknown> {
    const prompt = {
      instructions,
      messages: [{ role: "user" as const, text: JSON.stringify(evidence) }],
    };
    const response = await this.calls.run(
      {
        ...prompt,
        maxOutputTokens: Math.min(2048, this.profile.maxOutputTokens),
        inputTokenUpperBound: Buffer.byteLength(JSON.stringify(prompt)) + 1024,
        promptCacheKey: null,
      },
      this.control(context),
    );
    if (
      response.status !== "received" ||
      response.stopReason ||
      response.reply.usage === null ||
      response.reply.status !== "completed"
    )
      throw new Error("Engineering review stopped or requires reconciliation.");
    if (Buffer.byteLength(response.reply.text) > 16_384)
      throw new Error("Engineering review output is too large.");
    return JSON.parse(response.reply.text) as unknown;
  }
}
