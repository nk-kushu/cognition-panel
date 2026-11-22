import {
  OpenAiHttpTransport,
  type IOpenAiResponsesTransport,
  type OpenAiTextRequest,
} from "kushibot";

/**
 * Routes prompts only to endpoints with Zero Data Retention that do not store or
 * train on request data. Fallbacks stay enabled because OpenRouter applies these
 * filters to every candidate; a model with no compliant endpoint fails instead.
 */
export const OPENROUTER_PRIVACY = Object.freeze({
  zdr: true,
  data_collection: "deny",
});

/** Keeps bounded HTTP handling from Kushibot, while adapting OpenRouter model aliases. */
export class OpenRouterTransport implements IOpenAiResponsesTransport {
  private readonly transport: OpenAiHttpTransport;
  constructor(apiKey: string, http: typeof fetch) {
    // Kushibot's serializer rejects unknown fields, so routing is added after serialization.
    this.transport = new OpenAiHttpTransport(apiKey, (_url, init) =>
      http("https://openrouter.ai/api/v1/responses", {
        ...init,
        body: JSON.stringify({ ...JSON.parse(String(init?.body)), provider: OPENROUTER_PRIVACY }),
      }),
    );
  }
  async create(body: OpenAiTextRequest, signal: AbortSignal, maxResponseBytes: number) {
    const raw = await this.transport.create(body, signal, maxResponseBytes);
    // OpenRouter can return a canonical model ID when the request used an alias.
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
    return { ...raw, model: body.model };
  }
}
