import { afterEach, expect, it, vi } from "vitest";
import { HttpAgentSettingsApi } from "../../../workflow-ui/src/settings/AgentSettingsApi";

afterEach(() => vi.unstubAllGlobals());
it("identifies the workspace on settings and definition reads and writes", async () => {
  const fetcher = vi.fn(
    async () => new Response(JSON.stringify({ settings: {}, revision: 1 }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetcher);
  const api = new HttpAgentSettingsApi("/api", "project", "coding", "workspace-two");
  await api.settings();
  await api.definitions();
  await api.createDefinition("skill", { name: "Scoped skill" });
  for (const [, init] of fetcher.mock.calls as unknown as [string, RequestInit][]) {
    expect(new Headers(init.headers).get("X-Workspace-Id")).toBe("workspace-two");
  }
});
