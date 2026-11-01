import {
  OpenAiHttpTransport,
  OpenAiTextGatewayFactory,
  type IOpenAiResponsesTransport,
  type OpenAiTextRequest,
  type ModelProfile,
} from "kushibot";
import type { IModelBindings, ModelRole } from "../../CodingAgentOptions";
import type { CodingSettings } from "../../engineering/types";

type CatalogModel = Readonly<{
  id: string;
  context_length: number;
  top_provider?: { max_completion_tokens?: number | null };
}>;

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

/** Selects the provider at the binding boundary; the workflow only sees model gateways. */
export class OpenRouterModels implements IModelBindings {
  private readonly factory: OpenAiTextGatewayFactory;
  constructor(
    private readonly settings: CodingSettings,
    private readonly fallback: IModelBindings,
    private readonly catalog: readonly CatalogModel[],
    apiKey: string,
    http: typeof fetch,
  ) {
    this.factory = new OpenAiTextGatewayFactory(() => new OpenRouterTransport(apiKey, http));
  }

  bind(role: ModelRole, override?: string) {
    const selected = override || this.settings.models[role] || this.settings.models.default;
    if (!selected.startsWith("openrouter:")) return this.fallback.bind(role, override);
    const modelId = selected.slice("openrouter:".length);
    if (!/^[a-zA-Z0-9_.:/-]{1,128}$/.test(modelId))
      throw new Error("This OpenRouter model ID is not supported by the coding gateway.");
    const model = this.catalog.find((item) => item.id === modelId);
    if (!model || !Number.isSafeInteger(model.context_length) || model.context_length < 2)
      throw new Error(
        `OpenRouter model is unavailable: ${modelId}. Choose a model in coding settings.`,
      );
    const profile: ModelProfile = {
      id: `coding-${role}`,
      providerId: "openrouter",
      modelId,
      contextTokens: model.context_length,
      maxOutputTokens: Math.min(
        16_000,
        model.top_provider?.max_completion_tokens ?? 4096,
        model.context_length - 1,
      ),
      maxRequestBytes: 1_048_576,
      maxResponseBytes: 1_048_576,
      supportsPromptCacheKey: false,
    };
    return { profile, gateway: this.factory.create(profile) };
  }
}

export class CodingModelFactory {
  constructor(
    private readonly apiKey: string | undefined,
    private readonly http: typeof fetch,
  ) {}

  async create(
    settings: CodingSettings,
    fallback: IModelBindings,
    /** Models chosen on individual skills and guards. */
    extra: readonly string[] = [],
  ): Promise<IModelBindings> {
    const chosen = [...Object.values(settings.models), ...extra];
    if (!chosen.some((model) => model.startsWith("openrouter:"))) return fallback;
    if (!this.apiKey)
      throw new Error(
        "Save an OpenRouter API key in coding settings before using OpenRouter models.",
      );
    const response = await this.http("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `OpenRouter model lookup failed (HTTP ${response.status}). Check the saved API key.`,
      );
    }
    const raw = (await response.json()) as { data?: CatalogModel[] };
    if (!Array.isArray(raw.data)) throw new Error("OpenRouter returned an invalid model catalog.");
    return new OpenRouterModels(settings, fallback, raw.data, this.apiKey, this.http);
  }
}
