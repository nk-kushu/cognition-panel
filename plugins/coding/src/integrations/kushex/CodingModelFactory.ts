import type { IModelBindings } from "../../CodingAgentOptions";
import { OpenRouterModels } from "./OpenRouterModels";

import type { CodingSettings } from "../../engineering/types";
import type { CatalogModel } from "./OpenRouterModels";

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
