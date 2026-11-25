import { ToolUseError } from "./ToolBox";

export const DEFAULT_COGNITION_API_URL = "http://host.docker.internal:3000/api";

/** cognition refused the request (4xx): told to the model so it can correct the next call. */
export class CognitionRejected extends ToolUseError {}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The cognition API base: run configuration, then COGNITION_API_URL, then the Docker host default. */
export function cognitionApiUrl(configuration: Readonly<Record<string, unknown>>, env: Readonly<Record<string, string | undefined>>): string {
  const configured = typeof configuration.cognitionApiUrl === "string" ? configuration.cognitionApiUrl.trim() : "";
  return (configured || env.COGNITION_API_URL?.trim() || DEFAULT_COGNITION_API_URL).replace(/\/+$/, "");
}

/** JSON over HTTP to cognition. A 4xx becomes CognitionRejected; anything else stops the run. */
export class CognitionClient {
  constructor(
    private readonly baseUrl: string,
    private readonly signal: AbortSignal,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const endpoint = `${method} ${path}`;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.any([this.signal, AbortSignal.timeout(60_000)]),
      });
    } catch (error) {
      if (this.signal.aborted) throw error;
      throw new Error(`cognition is unreachable (${endpoint} at ${this.baseUrl}): ${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.status >= 400 && response.status < 500) throw new CognitionRejected(await errorMessage(response, endpoint));
    if (!response.ok) throw new Error(`cognition failed: ${await errorMessage(response, endpoint)}`);
    if (response.status === 204) return null as T;
    return (await response.json()) as T;
  }
}

async function errorMessage(response: Response, endpoint: string): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
    const message = typeof parsed.error === "string" ? parsed.error : typeof parsed.message === "string" ? parsed.message : "";
    if (message) return `${message} (${endpoint}, HTTP ${response.status})`;
  } catch {
    // not JSON; fall through
  }
  return `${endpoint} returned HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`;
}
