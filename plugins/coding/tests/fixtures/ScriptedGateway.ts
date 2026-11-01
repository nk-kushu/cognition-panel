import type { IModelGateway, ModelProfile, ModelRequest } from "kushibot";

export const profile: ModelProfile = {
  id: "coding-test",
  providerId: "openai",
  modelId: "test-model",
  contextTokens: 400_000,
  maxOutputTokens: 4096,
  maxRequestBytes: 1_048_576,
  maxResponseBytes: 1_048_576,
  supportsPromptCacheKey: false,
};

export const cli = (command: string) => ({ kind: "tool", toolId: "cli", arguments: { command } });
export const final = (value: unknown) => ({ kind: "final", value });
export const done = (result: unknown, inform: readonly string[] = []) =>
  final({ status: "done", result, inform });

/** The last observation a session received, so a script can react to its own tool call. */
export const observation = (request: ModelRequest): Record<string, unknown> =>
  (JSON.parse(request.messages.at(-1)!.text) as { observation: { value: Record<string, unknown> } })
    .observation.value;

type Reply = unknown | ((request: ModelRequest) => unknown);

/**
 * Answers each model call from the first script whose key its instructions contain, so a test
 * describes sessions by their job instead of the exact order of every call.
 */
export class ScriptedGateway implements IModelGateway {
  readonly requests: ModelRequest[] = [];
  /** A throw inside a gateway reads as an unknown result, so tests assert these are empty. */
  readonly failures: string[] = [];
  private readonly scripts: { key: string; replies: Reply[] }[];

  constructor(scripts: Readonly<Record<string, readonly Reply[]>>) {
    this.scripts = Object.entries(scripts).map(([key, replies]) => ({
      key,
      replies: [...replies],
    }));
  }

  remaining(): readonly string[] {
    return this.scripts.filter((script) => script.replies.length).map((script) => script.key);
  }

  sessions(key: string): number {
    return this.requests.filter(
      (request) => request.instructions.includes(key) && request.messages.length === 1,
    ).length;
  }

  async generate(request: ModelRequest) {
    this.requests.push(request);
    const script = this.scripts.find(
      (item) => request.instructions.includes(item.key) && item.replies.length,
    );
    if (!script) {
      this.failures.push(`Unexpected model call: ${request.instructions.slice(0, 200)}`);
      throw new Error(this.failures.at(-1));
    }
    const reply = script.replies.shift();
    let value: unknown;
    try {
      value = typeof reply === "function" ? reply(request) : reply;
    } catch (error) {
      this.failures.push(String(error));
      throw error;
    }
    return {
      status: "completed" as const,
      text: JSON.stringify(value),
      providerId: profile.providerId,
      modelId: profile.modelId,
      responseId: "test-response",
      errorCode: null,
      usage: {
        inputTokens: 100,
        outputTokens: 100,
        cachedInputTokens: null,
        reasoningTokens: null,
      },
    };
  }
}
