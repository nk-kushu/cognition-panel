export type OpenRouterModel = Readonly<{
  id: string;
  name: string;
  contextTokens: number;
  maxOutputTokens?: number;
}>;

export type OpenRouterStatus = Readonly<{
  configured: boolean;
  updatedAt: string | null;
}>;

/** Account-scoped catalog access. API keys stay on the Cognition Panel server. */
export class OpenRouterApi {
  constructor(
    private readonly apiBaseUrl = "/api",
    // Native browser fetch must be invoked on the global object, not this API instance.
    private readonly http: typeof fetch = (...args) => globalThis.fetch(...args),
  ) {}

  status(signal?: AbortSignal): Promise<OpenRouterStatus> {
    return this.get("", signal);
  }

  /** Case-insensitive search by provider/model ID or display name. */
  async models(search = "", signal?: AbortSignal): Promise<OpenRouterModel[]> {
    const models = await this.get<OpenRouterModel[]>("/models", signal);
    const query = search.trim().toLowerCase();
    return models.filter((model) => `${model.id} ${model.name}`.toLowerCase().includes(query));
  }

  private async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const base = this.apiBaseUrl.replace(/\/$/, "");
    const response = await this.http(`${base}/integrations/openrouter${path}`, { signal });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.message || "Could not load OpenRouter settings or models.");
    return data as T;
  }
}
