import {
  OpenAiHttpTransport,
  type IOpenAiResponsesTransport,
  type OpenAiTextRequest,
} from "kushibot";

/** Keeps bounded HTTP handling from Kushibot, while adapting OpenRouter model aliases. */
export class OpenRouterTransport implements IOpenAiResponsesTransport {
  private readonly transport: OpenAiHttpTransport;
  constructor(apiKey: string, http: typeof fetch) {
    this.transport = new OpenAiHttpTransport(apiKey, (_url, init) =>
      http("https://openrouter.ai/api/v1/responses", init),
    );
  }
  async create(body: OpenAiTextRequest, signal: AbortSignal, maxResponseBytes: number) {
    const raw = await this.transport.create(body, signal, maxResponseBytes);
    // OpenRouter can return a canonical model ID when the request used an alias.
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
    return { ...raw, model: body.model };
  }
}
