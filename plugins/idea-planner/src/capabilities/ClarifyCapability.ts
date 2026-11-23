import type { IAgentToolCall, ToolCallRequest, ToolDispatchOutcome } from "kushibot";
import type { ICapability } from "./Capability";

/** Asks one short question when the request is too unclear to route. Uses no tools. */
export class ClarifyCapability implements ICapability {
  readonly id = "clarify";
  readonly command = "/clarify";
  readonly model = "fast" as const;
  readonly whenToUse =
    "The message is too short or ambiguous to tell whether the user describes something to build or asks a question, and the conversation does not settle it. " +
    'Examples: "booking", "help", "something with payments".';

  instructions(): string {
    return `The user's request is unclear. Do not answer or plan anything yet.
Ask one short question, in the user's language, that settles what they want. Offer the two things you can do:
analysing an idea against the cognition templates (/idea ...), or answering a question about the templates (/ask ...).
Return it right away as the final answer; do not call tools.`;
  }

  tools(): IAgentToolCall {
    return new NoTools();
  }
}

class NoTools implements IAgentToolCall {
  async dispatch(request: ToolCallRequest): Promise<ToolDispatchOutcome> {
    return {
      status: "completed",
      replayed: false,
      observation: {
        operationId: request.operationId,
        toolId: request.toolId,
        toolVersion: "1",
        value: { error: "No tools are available. Return the final answer." },
      },
    };
  }
}
