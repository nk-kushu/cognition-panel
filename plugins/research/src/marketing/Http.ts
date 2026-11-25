import { ToolUseError } from "../ToolBox";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** A provider failed (bad key, quota, outage). Reported to the model; other providers may still answer. */
export class ProviderError extends ToolUseError {}

/**
 * JSON and text over HTTP for providers. Errors name the provider and the status only: request URLs
 * can carry keys (Meta takes its token in the query string), so they never reach the model.
 */
export class Http {
  constructor(
    private readonly signal: AbortSignal,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async json<T>(provider: string, url: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
    const response = await this.send(provider, url, init, timeoutMs);
    try {
      return (await response.json()) as T;
    } catch {
      throw new ProviderError(`${provider} returned something that is not JSON.`);
    }
  }

  async text(provider: string, url: string, init: RequestInit = {}, timeoutMs = 30_000, maxChars = 2_000_000): Promise<{ text: string; contentType: string }> {
    const response = await this.send(provider, url, init, timeoutMs);
    return { text: (await response.text()).slice(0, maxChars), contentType: response.headers.get("content-type") ?? "" };
  }

  private async send(provider: string, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, { ...init, signal: AbortSignal.any([this.signal, AbortSignal.timeout(timeoutMs)]) });
    } catch (error) {
      if (this.signal.aborted) throw error;
      throw new ProviderError(`${provider} is unreachable: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.ok) return response;
    if (response.status === 401 || response.status === 403) throw new ProviderError(`${provider} rejected the key (HTTP ${response.status}).`);
    if (response.status === 402) throw new ProviderError(`${provider} account is out of credit (HTTP 402).`);
    if (response.status === 429) throw new ProviderError(`${provider} rate limit reached (HTTP 429).`);
    throw new ProviderError(`${provider} failed (HTTP ${response.status}).`);
  }
}

export function requireText(value: string | undefined, what: string): string {
  const text = value?.trim();
  if (!text) throw new ToolUseError(`${what} is required.`);
  return text;
}

/** Waits `ms`, ending early (with the abort reason) if the run is cancelled. */
export function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
