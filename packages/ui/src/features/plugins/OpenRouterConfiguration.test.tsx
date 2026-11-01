import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ConfigProvider } from "antd";
import { CodingConfiguration } from "../../../../../plugins/coding/ui";

afterEach(() => vi.unstubAllGlobals());

it("loads the account catalog and persists the selected model in project settings", async () => {
  const calls: { url: string; method: string; body: Record<string, unknown> | null }[] = [];
  const configured = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      calls.push({ url, method, body });
      if (url.endsWith("/integrations/openrouter/models"))
        return Response.json([{ id: "vendor/code", name: "Code model", contextTokens: 32000 }]);
      if (url.endsWith("/integrations/openrouter")) {
        return Response.json({ configured, updatedAt: null });
      }
      if (url.endsWith("/settings"))
        return Response.json({
          settings: body?.settings ?? {},
          revision: method === "PUT" ? 1 : 0,
        });
      return Response.json([]);
    }),
  );
  const user = userEvent.setup();
  render(
    <ConfigProvider>
      <CodingConfiguration
        value={{}}
        onChange={() => {}}
        disabled={false}
        agentName="coding"
        projectId="p1"
        apiBaseUrl="/custom-api"
      />
    </ConfigProvider>,
  );
  await user.click(await screen.findByRole("tab", { name: "Models" }));
  const panel = within(screen.getByRole("tabpanel", { name: "Models" }));
  expect(panel.queryByLabelText("OpenRouter API key")).toBeNull();
  await panel.findByText(/Set up your API key in Cognition Panel Settings/);
  await user.click(panel.getByLabelText("Default model"));
  await user.click(await screen.findByText("Code model (32,000 context)"));
  await user.click(panel.getByRole("button", { name: "Save" }));
  await panel.findByText("Saved. New runs use these settings.");
  const saved = calls.find(
    (call) => call.url.endsWith("/agents/coding/settings") && call.method === "PUT",
  );
  expect(saved?.body).toMatchObject({
    settings: { models: { default: "openrouter:vendor/code" } },
  });
  expect(calls.some((call) => call.url === "/custom-api/integrations/openrouter/models")).toBe(
    true,
  );
});
