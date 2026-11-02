import { OpenAiTextGatewayFactory, type ModelProfile } from "kushibot";

import type { IModelBindings, ModelRole } from "../../CodingAgentOptions";

import type { CodingSettings } from "../../engineering/types";
import { OpenRouterTransport } from "./OpenRouterTransport";
export type CatalogModel = Readonly<{
  id: string;
  context_length: number;
  top_provider?: { max_completion_tokens?: number | null };
}>;

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
