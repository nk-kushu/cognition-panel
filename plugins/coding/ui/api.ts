import type { AgentDefinitionDto, AgentSettingsDto, ProjectMemoryDto } from "@kushex/ui";
import type { AgentSettings, AgentSettingsApi } from "@kushex/workflow-ui";

/** The server validates everything again; this only moves it. */
export class CodingApi implements AgentSettingsApi {
  constructor(
    private readonly base: string,
    private readonly projectId: string,
  ) {}

  private async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const response = await fetch(
      `${this.base}/projects/${encodeURIComponent(this.projectId)}${path}`,
      {
        method,
        // The server requires JSON on every state-changing request, even an empty one.
        ...(method === "GET"
          ? {}
          : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }),
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
    return this.request("/agents/coding/settings");
  }
  saveSettings(settings: AgentSettings, baseRevision: number): Promise<AgentSettingsDto> {
    return this.request("/agents/coding/settings", "PUT", { settings, baseRevision });
  }
  definitions(): Promise<readonly AgentDefinitionDto[]> {
    return this.request("/agents/coding/definitions");
  }
  createDefinition(kind: "skill" | "guard", content: object): Promise<AgentDefinitionDto> {
    return this.request("/agents/coding/definitions", "POST", { kind, enabled: true, content });
  }
  saveDefinition(id: string, enabled: boolean, content: object): Promise<AgentDefinitionDto> {
    return this.request(`/agents/coding/definitions/${id}`, "PUT", { enabled, content });
  }
  deleteDefinition(id: string): Promise<void> {
    return this.request(`/agents/coding/definitions/${id}`, "DELETE");
  }
  memory(): Promise<readonly ProjectMemoryDto[]> {
    return this.request("/memory");
  }
  addMemory(statement: string): Promise<ProjectMemoryDto> {
    return this.request("/memory", "POST", { statement });
  }
  updateMemory(id: string, statement: string): Promise<ProjectMemoryDto> {
    return this.request(`/memory/${id}`, "PUT", { statement });
  }
  deleteMemory(id: string): Promise<void> {
    return this.request(`/memory/${id}`, "DELETE");
  }
}
