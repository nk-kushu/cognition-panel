import {
  AgentRuntimeFactory,
  BoundedDecisionUnit,
  DecisionPromptBuilder,
  DecisionRequestContract,
  JsonValueContract,
  StructuredModelDecisionProvider,
  type DecisionEvidence,
  type IModelInputSizer,
  type IScopedDebugRecorderFactory,
} from "kushibot";
import { OpenRouterModels } from "./OpenRouterModel";
import type { DecisionInput, IAgentDecider } from "./Router";

/** Decision evidence must be one line of at most 1024 UTF-8 bytes. */
const EVIDENCE_BYTES = 1000;
const HISTORY_TURNS = 4;

/**
 * One bounded single-choice model call (kushibot DecisionUnit) on the fast model. Any problem with
 * the model itself (no key, a rejected key, invalid output) means "cannot decide", never a failed run:
 * the chosen agent then reports the problem in its own words.
 */
export class ModelDecider implements IAgentDecider {
  constructor(
    private readonly options: Readonly<{
      apiKey: string | undefined;
      model: string;
      signal: AbortSignal;
      progress(message: string): void;
      debug?: IScopedDebugRecorderFactory;
    }>,
  ) {}

  async choose(input: DecisionInput): Promise<string | null> {
    let binding;
    try {
      binding = (await OpenRouterModels.load(this.options.apiKey, this.options.signal)).bind("fast", this.options.model, "COGNITION_ROUTER_MODEL");
    } catch (error) {
      if (this.options.signal.aborted) throw error;
      this.options.progress(`Routing without a model: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
    const runtime = await new AgentRuntimeFactory({
      gateway: binding.gateway,
      profile: binding.profile,
      maxTurns: 1,
      timeoutMs: 120_000,
      modelTimeoutMs: 60_000,
      limits: { modelCalls: 1, toolCalls: 0 },
      ...(this.options.debug ? { debug: this.options.debug } : {}),
    }).create("cognition-router", { signal: this.options.signal });
    const json = new JsonValueContract();
    const unit = new BoundedDecisionUnit(
      new StructuredModelDecisionProvider(runtime.createModelCall(binding), new DecisionPromptBuilder(), new ByteSizer(), 512),
      new DecisionRequestContract(json),
      json,
      runtime.clock,
    );
    const outcome = await unit.evaluate(
      {
        purpose: "route-to-agent",
        question:
          "Which agent should answer the user's latest message? Read each agent's description and the conversation. " +
          "Keep the previous agent when the message continues its topic. Abstain only if no agent fits.",
        options: input.agents.map((agent) => agent.id),
        evidence: [
          { ref: "message", text: oneLine(input.message) },
          ...input.conversation.slice(-HISTORY_TURNS).map(
            (turn, index): DecisionEvidence => ({ ref: `conversation:${index}`, text: oneLine(`${turn.role}: ${turn.text}`) }),
          ),
          ...(input.previousAgentId ? [{ ref: "previous-agent", text: input.previousAgentId }] : []),
          ...input.agents.map((agent): DecisionEvidence => ({ ref: `agent:${agent.id}`, text: oneLine(`${agent.name}: ${agent.description}`) })),
        ],
      },
      {
        operationId: runtime.ids.nextId(),
        signal: runtime.context.signal,
        deadlineEpochMs: runtime.context.deadlineEpochMs,
        timeoutMs: runtime.modelLimits(binding).timeoutMs,
      },
    );
    if (outcome.status === "answered") return outcome.answer.choice;
    if (outcome.status === "stopped") throw new Error(`Routing stopped: ${outcome.reason.message}`);
    return null;
  }
}

/** Conservative token bound: one token per UTF-8 byte, plus room for the wrapper. */
class ByteSizer implements IModelInputSizer {
  async upperBound(request: Parameters<IModelInputSizer["upperBound"]>[0]): Promise<number> {
    return new TextEncoder().encode(JSON.stringify(request)).byteLength + 1024;
  }
}

/** Collapses control characters and cuts to the evidence limit without splitting a character. */
function oneLine(text: string): string {
  let line = text.replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim() || "(empty)";
  const encoder = new TextEncoder();
  while (encoder.encode(line).byteLength > EVIDENCE_BYTES) line = [...line].slice(0, -Math.max(1, Math.floor(line.length / 10))).join("");
  return line;
}
