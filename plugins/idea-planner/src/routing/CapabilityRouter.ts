import {
  BoundedDecisionUnit,
  DecisionPromptBuilder,
  DecisionRequestContract,
  JsonValueContract,
  StructuredModelDecisionProvider,
  type AgentModelBinding,
  type AgentRunRuntime,
  type DecisionEvidence,
  type IModelInputSizer,
} from "kushibot";
import type { ICapability } from "../capabilities/Capability";
import type { CapabilityRegistry } from "../capabilities/CapabilityRegistry";
import type { AssistantRequest } from "../AssistantRequest";

export type Route = Readonly<{
  capability: ICapability;
  /** The message without the slash command, if one chose the capability. */
  message: string;
  source: "command" | "router" | "unclear" | "fallback";
}>;

/** Decision evidence must be one line of at most 1024 UTF-8 bytes. */
const EVIDENCE_BYTES = 1000;
const HISTORY_TURNS = 4;

/** Step 0: a slash command wins; otherwise one bounded single-choice model call picks the capability. */
export class CapabilityRouter {
  constructor(private readonly registry: CapabilityRegistry) {}

  async route(request: AssistantRequest, runtime: AgentRunRuntime, model: AgentModelBinding): Promise<Route> {
    const command = request.message.match(/^(\/[a-z][\w-]*)(?:\s+|$)([\s\S]*)$/i);
    const chosen = command ? this.registry.command(command[1] ?? "") : undefined;
    if (command && chosen) return { capability: chosen, message: (command[2] ?? "").trim() || request.message, source: "command" };

    const capabilities = this.registry.all();
    const json = new JsonValueContract();
    const unit = new BoundedDecisionUnit(
      new StructuredModelDecisionProvider(runtime.createModelCall(model), new DecisionPromptBuilder(), new ByteSizer(), 512),
      new DecisionRequestContract(json),
      json,
      runtime.clock,
    );
    const outcome = await unit.evaluate(
      {
        purpose: "route-request",
        question:
          "Which capability should handle the user's latest message? Read the capability descriptions and the conversation. Abstain only if the message is too unclear to choose.",
        options: capabilities.map((capability) => capability.id),
        evidence: [
          { ref: "message", text: oneLine(request.message) },
          ...request.conversation.slice(-HISTORY_TURNS).map(
            (turn, index): DecisionEvidence => ({ ref: `conversation:${index}`, text: oneLine(`${turn.role}: ${turn.text}`) }),
          ),
          ...capabilities.map((capability): DecisionEvidence => ({ ref: `capability:${capability.id}`, text: oneLine(capability.whenToUse) })),
        ],
      },
      {
        operationId: runtime.ids.nextId(),
        signal: runtime.context.signal,
        deadlineEpochMs: runtime.context.deadlineEpochMs,
        timeoutMs: runtime.modelLimits(model).timeoutMs,
      },
    );
    if (outcome.status === "answered")
      return { capability: this.registry.get(outcome.answer.choice), message: request.message, source: "router" };
    if (outcome.status === "abstained")
      return { capability: this.registry.get(this.registry.unclearId), message: request.message, source: "unclear" };
    if (outcome.status === "stopped") throw new RouteStopped(outcome.reason.message);
    // Invalid output, an unavailable or uncertain provider: the fallback capability handles any request.
    return { capability: this.registry.get(this.registry.fallbackId), message: request.message, source: "fallback" };
  }
}

export class RouteStopped extends Error {}

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
