import { createRequire } from "node:module";
import type {
  DecisionProviderResult,
  DecisionRequest,
  IDecisionProvider,
  IUsageLedgerStore,
  ModelCallControl,
} from "kushibot";
import { zeroUsage } from "kushibot";

/** The part of `@typesafe-ai/sdk` this adapter uses. */
type TypeSafeSdk = Readonly<{
  TypeSafeClient: new (options: Record<string, unknown>) => {
    systemOne(
      request: Record<string, unknown>,
      options: { signal: AbortSignal },
    ): Promise<{
      answers: Readonly<Record<string, { choice: string; confidence: number }>>;
      usage: { input_tokens: number; output_tokens: number };
    }>;
  };
  choice(instructions: string, criteria: Record<string, string>): unknown;
}>;

export type JevSettings = Readonly<{
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** Below this confidence the provider abstains; a caller never receives a guess. */
  minConfidence: number;
  budgetScopeId: string;
  ledger: IUsageLedgerStore;
}>;

const INPUT_TOKEN_BOUND = 8_000;
const require = createRequire(import.meta.url);

/**
 * JEV behind kushibot's provider interface, through TypeSafe's `systemOne` API. Options become
 * opaque labels, because JEV picks a label and file paths are not usable as one. Every call
 * is charged to the run's budget; a failure is reported as unavailable, never as an answer.
 */
export class JevDecisionProvider implements IDecisionProvider {
  constructor(private readonly settings: JevSettings) {}

  async evaluate(
    request: DecisionRequest,
    control: ModelCallControl,
  ): Promise<DecisionProviderResult> {
    const { apiKey, ledger, budgetScopeId, model, baseUrl, minConfidence } = this.settings;
    if (!apiKey) return { status: "unavailable" };
    const admitted = await ledger.mutate((usage) =>
      usage.reserve(control.operationId, budgetScopeId, {
        ...zeroUsage,
        modelCalls: 1,
        inputTokens: INPUT_TOKEN_BOUND,
        outputTokens: 64,
      }),
    );
    if (!admitted.admitted)
      return {
        status: "stopped",
        reason: { code: "limit-reached", message: "Model allowance unavailable." },
      };
    const labels = Object.fromEntries(
      request.options.map((option, index) => [`o${index}`, option]),
    );
    try {
      const sdk = require("@typesafe-ai/sdk") as TypeSafeSdk;
      const client = new sdk.TypeSafeClient({
        apiKey,
        defaultModel: model,
        timeout: Math.min(control.timeoutMs, 10_000),
        retry: { maxRetries: 1 },
        ...(baseUrl ? { baseURL: baseUrl } : {}),
      });
      const response = await client.systemOne(
        {
          state: {
            purpose: request.purpose,
            evidence: Object.fromEntries(request.evidence.map((item) => [item.ref, item.text])),
          },
          questions: { decision: sdk.choice(request.question, labels) },
        },
        { signal: control.signal },
      );
      await ledger.mutate((usage) =>
        usage.settle(control.operationId, {
          ...zeroUsage,
          modelCalls: 1,
          inputTokens: Math.min(response.usage.input_tokens, INPUT_TOKEN_BOUND),
          outputTokens: Math.min(response.usage.output_tokens, 64),
        }),
      );
      const answer = response.answers.decision;
      const choice = answer ? labels[answer.choice] : undefined;
      if (!answer || choice === undefined) return { status: "invalid-output" };
      return {
        status: "output",
        value:
          answer.confidence < minConfidence
            ? { kind: "abstained", supportingRefs: [] }
            : { kind: "answered", choice, supportingRefs: [] },
      };
    } catch {
      await ledger.mutate((usage) => usage.settle(control.operationId, zeroUsage));
      if (control.signal.aborted)
        return { status: "stopped", reason: { code: "cancelled", message: "Decision cancelled." } };
      return { status: "unavailable" };
    }
  }
}
