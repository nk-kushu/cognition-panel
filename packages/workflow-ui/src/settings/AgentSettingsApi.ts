import type { AgentDefinition, ProjectMemory, AgentSettings, AgentSettingsApi } from "./types";
type AgentSettingsDto = { settings: unknown; revision: number };

/** The server validates everything again; this only moves it. */
export class HttpAgentSettingsApi implements AgentSettingsApi {
  constructor(
    private readonly base: string,
    private readonly projectId: string,
    private readonly agentId: string,
    private readonly workspaceId?: string,
  ) {}

  private async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const response = await fetch(
      `${this.base}/projects/${encodeURIComponent(this.projectId)}${path}`,
      {
        method,
        headers: {
          ...(this.workspaceId ? { "X-Workspace-Id": this.workspaceId } : {}),
          ...(method === "GET" ? {} : { "Content-Type": "application/json" }),
        },
        // The server requires JSON on every state-changing request, even an empty one.
        ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
      },
    );
    if (!response.ok) {
      const failure = (await response.json().catch(() => null)) as {
        message?: string;
        details?: readonly { path: string; message: string }[];
      } | null;
      const details = failure?.details?.map((item) => `${item.path} ${item.message}`).join("; ");
      throw new Error(details || failure?.message || `Request failed (${response.status}).`);
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  settings(): Promise<AgentSettingsDto> {
    return this.request(`/agents/${encodeURIComponent(this.agentId)}/settings`);
  }
  saveSettings(settings: AgentSettings, baseRevision: number): Promise<AgentSettingsDto> {
    return this.request(`/agents/${encodeURIComponent(this.agentId)}/settings`, "PUT", {
      settings,
      baseRevision,
    });
  }
  definitions(): Promise<readonly AgentDefinition[]> {
    return this.request(`/agents/${encodeURIComponent(this.agentId)}/definitions`);
  }
  createDefinition(kind: "skill" | "guard", content: object): Promise<AgentDefinition> {
    return this.request(`/agents/${encodeURIComponent(this.agentId)}/definitions`, "POST", {
      kind,
      enabled: true,
      content,
    });
  }
  saveDefinition(id: string, enabled: boolean, content: object): Promise<AgentDefinition> {
    return this.request(
      `/agents/${encodeURIComponent(this.agentId)}/definitions/${encodeURIComponent(id)}`,
      "PUT",
      { enabled, content },
    );
  }
  deleteDefinition(id: string): Promise<void> {
    return this.request(
      `/agents/${encodeURIComponent(this.agentId)}/definitions/${encodeURIComponent(id)}`,
      "DELETE",
    );
  }
  memory(): Promise<readonly ProjectMemory[]> {
    return this.request("/memory");
  }
  addMemory(statement: string): Promise<ProjectMemory> {
    return this.request("/memory", "POST", { statement });
  }
  updateMemory(id: string, statement: string): Promise<ProjectMemory> {
    return this.request(`/memory/${encodeURIComponent(id)}`, "PUT", { statement });
  }
  deleteMemory(id: string): Promise<void> {
    return this.request(`/memory/${encodeURIComponent(id)}`, "DELETE");
  }
}
