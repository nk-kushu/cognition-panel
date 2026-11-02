import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ConfigProvider } from "antd";
import { CodingConfiguration } from "../../../../../plugins/coding/ui";
import config from "../../../../../plugins/coding/ui/settings.json";

afterEach(() => vi.unstubAllGlobals());

function renderCoding() {
  return render(
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
}

it("searches the account catalog in workflow steps and saves only a selected model", async () => {
  const calls: { url: string; method: string; body: Record<string, unknown> | null }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      calls.push({ url, method, body });
      if (url.endsWith("/integrations/openrouter/models"))
        return Response.json([
          { id: "vendor/code", name: "Code model", contextTokens: 32000 },
          { id: "other/general", name: "General model", contextTokens: 64000 },
        ]);
      if (url.endsWith("/integrations/openrouter"))
        return Response.json({ configured: true, updatedAt: null });
      if (url.endsWith("/settings"))
        return Response.json({
          settings: body?.settings ?? {},
          revision: method === "PUT" ? 1 : 0,
        });
      return Response.json([]);
    }),
  );
  const user = userEvent.setup();
  renderCoding();
  await user.click(
    await screen.findByRole("button", { name: "Change the code: Plan investigation" }),
  );
  const input = screen.getByRole("combobox", { name: "Investigation model" });
  await user.type(input, "CoDe");
  await screen.findByText("Code model (vendor/code, 32,000 context)");
  expect(
    screen.queryByText("General model (other/general, 64,000 context)"),
  ).not.toBeInTheDocument();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(calls.findLast((call) => call.method === "PUT")?.body).toMatchObject({
    settings: { models: { investigationPlanning: "" } },
  });

  await user.click(input);
  await user.clear(input);
  await user.type(input, "VENDOR/CODE");
  await user.click(await screen.findByText("Code model (vendor/code, 32,000 context)"));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Saved. New runs use these settings.");
  expect(calls.findLast((call) => call.method === "PUT")?.body).toMatchObject({
    settings: { models: { investigationPlanning: "openrouter:vendor/code" } },
  });
  expect(
    calls.filter((call) => call.url === "/custom-api/integrations/openrouter/models"),
  ).toHaveLength(1);

  // Every model-using step exposes the appropriate searchable role fields.
  for (const step of config.schema.steps) {
    if (!step.models.length) continue;
    const nodeName = step.laneLabel ? `${step.laneLabel}: ${step.title}` : step.title;
    await user.click(screen.getByRole("button", { name: nodeName }));
    for (const role of step.models) {
      const label = config.schema.models.find((model) => model.key === role)!.label;
      expect(screen.getByRole("combobox", { name: `${label} model` })).toBeVisible();
    }
  }
});

it.each(["missing key", "catalog failure"])("shows actionable feedback for %s", async (failure) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/integrations/openrouter/models")) {
        return Response.json(
          { message: "OpenRouter is temporarily unavailable." },
          { status: 503 },
        );
      }
      if (url.endsWith("/integrations/openrouter"))
        return Response.json({ configured: failure !== "missing key", updatedAt: null });
      if (url.endsWith("/settings")) return Response.json({ settings: {}, revision: 0 });
      return Response.json([]);
    }),
  );
  const user = userEvent.setup();
  renderCoding();
  await user.click(
    await screen.findByRole("button", { name: "Change the code: Plan investigation" }),
  );
  if (failure === "missing key") {
    await screen.findByText("Connect your API key in Settings → OpenRouter to choose a model.");
  } else {
    await screen.findByText("OpenRouter is temporarily unavailable.");
    expect(screen.getByRole("button", { name: "Retry models" })).toBeVisible();
  }
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "Investigation model" })).toBeVisible(),
  );
});
