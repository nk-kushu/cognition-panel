import {
  OpenAiHttpTransport,
  OpenAiTextGatewayFactory,
  type AgentModelBinding,
  type IOpenAiResponsesTransport,
  type ModelProfile,
  type OpenAiTextRequest,
} from "kushibot";

/** Chinese open-weight models with Zero Data Retention endpoints on OpenRouter. */
export const DEFAULT_MAIN_MODEL = "moonshotai/kimi-k3";
/** Cheap and fast: routing and clarifying questions. */
export const DEFAULT_FAST_MODEL = "deepseek/deepseek-v4.1-flash";

/** Same policy as the coding plugin: only endpoints that neither store nor train on prompts. */
const OPENROUTER_PRIVACY = Object.freeze({ zdr: true, data_collection: "deny" });

type CatalogModel = Readonly<{
  id: string;
  context_length: number;
  top_provider?: { max_completion_tokens?: number | null };
  supported_parameters?: readonly string[];
}>;

/**
 * Models whose OpenRouter catalog entry lists `response_format` can be told to answer with one JSON object, which keeps
 * a model such as kimi-k3 from answering in its own tool-call markup. Set OPENROUTER_JSON_MODE=off to switch it off.
 */
export function supportsJsonMode(model: Readonly<{ supported_parameters?: readonly string[] }> | undefined): boolean {
  return Boolean(model?.supported_parameters?.includes("response_format")) && process.env.OPENROUTER_JSON_MODE?.toLowerCase() !== "off";
}

/** Adds OpenAI-style JSON mode to a serialized /responses body; a format the caller already chose is left alone. */
export function withJsonMode(body: Record<string, unknown>, enabled: boolean): Record<string, unknown> {
  if (!enabled) return body;
  const text = typeof body.text === "object" && body.text !== null ? (body.text as Record<string, unknown>) : {};
  if (text.format !== undefined) return body;
  return { ...body, text: { ...text, format: { type: "json_object" } } };
}


class OpenRouterTransport implements IOpenAiResponsesTransport {
  private readonly transport: OpenAiHttpTransport;
  constructor(apiKey: string, jsonMode = false) {
    // Kushibot's serializer rejects unknown fields, so routing is added after serialization.
    this.transport = new OpenAiHttpTransport(apiKey, async (_url, init) => {
      const response = await fetch("https://openrouter.ai/api/v1/responses", {
        ...init,
        body: JSON.stringify(withJsonMode({ ...JSON.parse(String(init?.body)), provider: OPENROUTER_PRIVACY }, jsonMode)),
      });
      // kushibot reports a failed call only as "unavailable"; say why in the run output.
      if (!response.ok) {
        const detail = await response.clone().text().catch(() => "");
        console.error(`OpenRouter /responses HTTP ${response.status}: ${detail.slice(0, 500)}`);
      }
      return response;
    });
  }
  async create(body: OpenAiTextRequest, signal: AbortSignal, maxResponseBytes: number) {
    const raw = await this.transport.create(body, signal, maxResponseBytes);
    // OpenRouter can answer with a canonical ID for an alias; kushibot expects the requested one.
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
    return { ...raw, model: body.model };
  }
}

/** Binds OpenRouter models after one catalog lookup, sizing each profile from the catalog. */
export class OpenRouterModels {
  private constructor(
    private readonly apiKey: string,
    private readonly catalog: readonly CatalogModel[],
  ) {}

  static async load(apiKey: string | undefined, signal: AbortSignal): Promise<OpenRouterModels> {
    if (!apiKey)
      throw new Error("No OpenRouter API key. Save one in Cognition Panel's coding settings, or set OPENROUTER_API_KEY.");
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    if (!response.ok) throw new Error(`OpenRouter model lookup failed (HTTP ${response.status}). Check the saved API key.`);
    // The model list is public, so it says nothing about the key; ask OpenRouter about the key itself.
    const key = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    if (key.status === 401 || key.status === 403)
      throw new Error(
        `OpenRouter rejected the saved API key (HTTP ${key.status}: ${(await key.text().catch(() => "")).slice(0, 200)}). Save a valid key in Cognition Panel's coding settings.`,
      );
    return new OpenRouterModels(apiKey, ((await response.json()) as { data?: CatalogModel[] }).data ?? []);
  }

  bind(role: string, modelId: string, setting: string): AgentModelBinding {
    if (!/^[a-zA-Z0-9_.:/-]{1,128}$/.test(modelId)) throw new Error(`Invalid OpenRouter model ID in ${setting}: ${modelId}`);
    const model = this.catalog.find((item) => item.id === modelId);
    if (!model || !Number.isSafeInteger(model.context_length) || model.context_length < 2)
      throw new Error(`OpenRouter model is unavailable: ${modelId}. Set ${setting} to another model.`);
    const profile: ModelProfile = {
      id: `research-${role}`,
      providerId: "openrouter",
      modelId,
      contextTokens: model.context_length,
      maxOutputTokens: Math.min(16_000, model.top_provider?.max_completion_tokens ?? 4096, model.context_length - 1),
      maxRequestBytes: 1_048_576,
      maxResponseBytes: 1_048_576,
      supportsPromptCacheKey: false,
    };
    return { profile, gateway: new OpenAiTextGatewayFactory(() => new OpenRouterTransport(this.apiKey, supportsJsonMode(model))).create(profile) };
  }
}
