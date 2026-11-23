/**
 * The cognition app's API, reached from the Cognition Panel's agent process. Inside the panel's
 * Docker container the host is host.docker.internal; set COGNITION_API_URL when it runs elsewhere.
 */
export const DEFAULT_COGNITION_API_URL = "http://host.docker.internal:3000";

export type CognitionApp = Readonly<{ id: string; name: string; appDir: string }>;

export type CognitionNote = Readonly<{ id: string; title: string; contentMd: string; updatedAt: string }>;

export class CognitionApi {
  private readonly baseUrl: string;

  constructor(
    baseUrl = process.env.COGNITION_API_URL || DEFAULT_COGNITION_API_URL,
    private readonly signal?: AbortSignal,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  /** `{ query, results: [{ title, url, snippet }] }` or `{ error }`. */
  search(query: string): Promise<unknown> {
    return this.request("POST", "/api/harness/research/search", { query }, 45_000);
  }

  /** `{ title, url, text }` or `{ error }`. */
  read(url: string): Promise<unknown> {
    return this.request("POST", "/api/harness/research/read", { url }, 60_000);
  }

  async apps(): Promise<CognitionApp[]> {
    const value = await this.request("GET", "/api/local-apps");
    return Array.isArray(value) ? (value as CognitionApp[]) : [];
  }

  async notes(appId: string): Promise<CognitionNote[]> {
    const value = await this.request("GET", `/api/harness/projects/app/${encodeURIComponent(appId)}/notes`);
    return Array.isArray(value) ? (value as CognitionNote[]) : [];
  }

  /** The idempotency key makes a retried save create the note once. */
  async createNote(appId: string, title: string, contentMd: string, idempotencyKey: string): Promise<CognitionNote> {
    return (await this.request(
      "POST",
      `/api/harness/projects/app/${encodeURIComponent(appId)}/notes`,
      { title, contentMd },
      15_000,
      { "Idempotency-Key": idempotencyKey },
    )) as CognitionNote;
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    timeoutMs = 15_000,
    headers: Record<string, string> = {},
  ): Promise<unknown> {
    const signals = [AbortSignal.timeout(timeoutMs), ...(this.signal ? [this.signal] : [])];
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.any(signals),
      });
    } catch (error) {
      throw new Error(`Cannot reach the cognition API at ${this.baseUrl} (${(error as Error).message}). Set COGNITION_API_URL.`);
    }
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = (value as { error?: unknown } | null)?.error;
      throw new Error(`cognition API ${method} ${path} failed (HTTP ${response.status})${typeof message === "string" ? `: ${message}` : ""}.`);
    }
    return value;
  }
}

/**
 * The app whose directory the chat's workspace is. The panel and cognition see the same folder under
 * different roots (/roots/PersonalProjects/… vs /Users/…/PersonalProjects/…), so paths are matched by
 * their longest common tail; at least the parent and the app folder must match.
 */
export function appForWorkspace(apps: readonly CognitionApp[], workspace: string): CognitionApp | null {
  const target = segments(workspace);
  let best: CognitionApp | null = null;
  let bestLength = 1;
  let tie = false;
  for (const app of apps) {
    const length = commonTail(target, segments(app.appDir));
    if (length > bestLength) [best, bestLength, tie] = [app, length, false];
    else if (length === bestLength && best) tie = true;
  }
  return tie ? null : best;
}

function segments(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

function commonTail(left: readonly string[], right: readonly string[]): number {
  let length = 0;
  while (length < left.length && length < right.length && left[left.length - 1 - length] === right[right.length - 1 - length]) length++;
  return length;
}
