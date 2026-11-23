import type { IAgentToolCall, JsonValue, ToolCallRequest, ToolDispatchOutcome } from "kushibot";

/** A set of tools, each answering a fixed set of tool ids. */
export interface IToolSet {
  readonly ids: readonly string[];
  call(toolId: string, args: Record<string, unknown>): Promise<JsonValue>;
}

/** Bad arguments or a spent budget: reported back to the model so it can adjust. */
export class ToolUseError extends Error {}

/** Dispatches each tool call to the set that owns its id. Unknown ids come back as an error to the model. */
export class ToolBox implements IAgentToolCall {
  constructor(private readonly sets: readonly IToolSet[]) {}

  async dispatch(request: ToolCallRequest): Promise<ToolDispatchOutcome> {
    const args = (typeof request.arguments === "object" && request.arguments !== null ? request.arguments : {}) as Record<string, unknown>;
    const owner = this.sets.find((set) => set.ids.includes(request.toolId));
    let value: JsonValue;
    try {
      if (!owner) throw new ToolUseError(`Unknown tool ${request.toolId}. Available: ${this.sets.flatMap((set) => set.ids).join(", ")}.`);
      value = await owner.call(request.toolId, args);
    } catch (error) {
      if (!(error instanceof ToolUseError)) throw error;
      value = { error: error.message };
    }
    return {
      status: "completed",
      replayed: false,
      observation: { operationId: request.operationId, toolId: request.toolId, toolVersion: "1", value },
    };
  }
}
