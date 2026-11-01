import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { ConfigProvider } from "antd";
import type { AgentConfiguration } from "@kushex/contracts";
import { CodingConfiguration } from "../../../../../plugins/coding/ui";

type Call = { url: string; method: string; body: unknown };

/** A small in-memory stand-in for the settings, definitions and memory endpoints. */
function serve(reject?: { path: string; message: string }, saved: object = {}) {
  const calls: Call[] = [];
  const memory: { id: string; statement: string; createdAt: string }[] = [];
  const definitions: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      calls.push({ url, method, body });
      const json = (value: unknown, status = 200) =>
        new Response(JSON.stringify(value), { status });
      if (url.endsWith("/settings") && method === "PUT") {
        if (reject) return json({ message: "Request body is invalid.", details: [reject] }, 400);
        return json({ settings: body?.settings, revision: 1 });
      }
      if (url.endsWith("/settings")) return json({ settings: saved, revision: 0 });
      if (url.endsWith("/definitions") && method === "POST") {
        const saved = {
          id: `d${definitions.length}`,
          version: 1,
          versionId: `v${definitions.length}`,
          ...body,
        };
        definitions.push(saved);
        return json(saved, 201);
      }
      if (url.endsWith("/definitions")) return json(definitions);
      if (url.includes("/definitions/") && method === "PUT") {
        const saved = definitions.find((item) => url.endsWith(`/${String(item.id)}`))!;
        Object.assign(saved, body, { version: Number(saved.version) + 1 });
        return json(saved);
      }
      if (url.endsWith("/memory") && method === "POST") {
        const saved = {
          id: `m${memory.length}`,
          statement: String(body?.statement),
          createdAt: "2026-11-01T00:00:00.000Z",
        };
        memory.push(saved);
        return json(saved, 201);
      }
      return json(memory);
    }),
  );
  return calls;
}

function Editor() {
  const [value, setValue] = useState<AgentConfiguration>({});
  return (
    <ConfigProvider>
      <CodingConfiguration
        value={value}
        onChange={setValue}
        disabled={false}
        agentName="coding"
        projectId="project-one"
        apiBaseUrl="/api"
      />
    </ConfigProvider>
  );
}

afterEach(() => vi.unstubAllGlobals());

/** Inactive tabs stay mounted, so the same field can exist in a hidden pane. */
const limitsTab = () => within(screen.getByRole("tabpanel", { name: "Limits" }));

it("saves every limit to the project, starting from the proposed defaults", async () => {
  const calls = serve();
  const user = userEvent.setup();
  render(<Editor />);
  await user.click(await screen.findByRole("tab", { name: "Limits" }));
  const total = await limitsTab().findByLabelText("Total returns per run");
  expect(total).toHaveValue("8");
  await user.clear(total);
  await user.type(total, "5");
  await user.click(limitsTab().getByRole("button", { name: "Save" }));
  await limitsTab().findByText("Saved. New runs use these settings.");
  const saved = calls.find((call) => call.method === "PUT");
  expect(saved?.url).toBe("/api/projects/project-one/agents/coding/settings");
  expect(saved?.body).toMatchObject({
    baseRevision: 0,
    settings: { limits: { totalReturns: 5, clarifications: 2, codeFixReturns: 3 } },
  });
});

it("shows the backend's reason when it refuses a value", async () => {
  serve({ path: "limits.totalReturns", message: "Too big" });
  const user = userEvent.setup();
  render(<Editor />);
  await user.click(await screen.findByRole("tab", { name: "Limits" }));
  await limitsTab().findByLabelText("Total returns per run");
  await user.click(limitsTab().getByRole("button", { name: "Save" }));
  await limitsTab().findByText("limits.totalReturns Too big");
});

it("adds the built-in guards as project definitions", async () => {
  const calls = serve();
  const user = userEvent.setup();
  render(<Editor />);
  await user.click(await screen.findByRole("tab", { name: "Guards" }));
  await user.click(await screen.findByRole("button", { name: "Add built-in guards" }));
  await screen.findByText("Input validation");
  const created = calls.filter((call) => call.method === "POST");
  expect(created).toHaveLength(12);
  expect(created[0]?.body).toMatchObject({
    kind: "guard",
    content: { type: "llm", selection: "automatic", blocking: true },
  });
});

it("manages project memory", async () => {
  const calls = serve();
  const user = userEvent.setup();
  render(<Editor />);
  await user.click(await screen.findByRole("tab", { name: "Memory" }));
  await user.type(await screen.findByLabelText("New memory"), "Prefer maintained packages.");
  await user.click(screen.getByRole("button", { name: "Add" }));
  await screen.findByText("Prefer maintained packages.");
  await waitFor(() =>
    expect(calls.some((call) => call.url === "/api/projects/project-one/memory")).toBe(true),
  );
});

it("opens on the whole workflow and edits a return limit from its path", async () => {
  const calls = serve();
  const user = userEvent.setup();
  render(<Editor />);
  await screen.findByRole("button", { name: "Change the code: Human review" });
  await screen.findByRole("button", { name: "Explain: Write answer" });

  await user.click(screen.getByRole("button", { name: "Code-fix returns: 3" }));
  const limit = await screen.findByLabelText(/^Code-fix returns/);
  await user.clear(limit);
  await user.type(limit, "5");
  await screen.findByRole("button", { name: "Code-fix returns: 5" });
  await screen.findByText("Unsaved changes");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Saved. New runs use these settings.");
  expect(screen.queryByText("Unsaved changes")).toBeNull();
  expect(calls.find((call) => call.method === "PUT")?.body).toMatchObject({
    settings: { limits: { codeFixReturns: 5 } },
  });
});

it("shows only what controls the selected step", async () => {
  serve();
  const user = userEvent.setup();
  render(<Editor />);
  await user.click(await screen.findByRole("button", { name: "Choose mode" }));
  await screen.findByLabelText("Mode clarifications");
  expect(screen.queryByLabelText("Total returns per run")).toBeNull();

  await user.click(screen.getByRole("button", { name: "Change the code: Implement" }));
  await screen.findByLabelText("Implementation model");
  expect(screen.queryByLabelText("Mode clarifications")).toBeNull();
});

it("keeps one draft across views, so a later save does not hit a stale revision", async () => {
  const calls = serve();
  const user = userEvent.setup();
  render(<Editor />);
  await user.click(await screen.findByRole("button", { name: "Plan revisions: 2" }));
  const limit = await screen.findByLabelText("Plan revisions");
  await user.clear(limit);
  await user.type(limit, "4");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Saved. New runs use these settings.");

  await user.click(screen.getByRole("tab", { name: "Limits" }));
  expect(await limitsTab().findByLabelText("Plan revisions")).toHaveValue("4");
  await user.click(limitsTab().getByRole("button", { name: "Save" }));
  await waitFor(() => expect(calls.filter((call) => call.method === "PUT")).toHaveLength(2));
  expect(calls.filter((call) => call.method === "PUT")[1]?.body).toMatchObject({
    baseRevision: 1,
  });
});

it("adds a saved skill to the selected step's phase", async () => {
  const calls = serve();
  const user = userEvent.setup();
  render(<Editor />);
  await user.click(await screen.findByRole("tab", { name: "Skills" }));
  await user.click(await screen.findByRole("button", { name: "Add skill" }));
  await screen.findByText("New skill");

  await user.click(screen.getByRole("tab", { name: "Workflow" }));
  await user.click(await screen.findByRole("button", { name: "Change the code: Skeleton" }));
  await user.click(await screen.findByRole("checkbox", { name: "New skill" }));
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "New skill" })).toBeChecked());
  expect(calls.find((call) => call.method === "PUT")?.body).toMatchObject({
    enabled: true,
    content: { phases: ["planning", "skeleton"] },
  });
});

it("draws the paths that end a run and the limits on repeating steps", async () => {
  serve();
  const user = userEvent.setup();
  const { container } = render(<Editor />);
  await screen.findByText("Stop and report");
  await screen.findByText("Run cancelled");
  const loop = container.querySelector('[data-loop="answer-investigate"]')!;
  expect(loop).toHaveTextContent("3");
  await user.click(loop);
  await screen.findByLabelText("Answer-only investigation rounds");
});

it("warns when a selected test type has no suite", async () => {
  serve(undefined, { testTypes: ["unit"] });
  const user = userEvent.setup();
  render(<Editor />);
  await user.click(await screen.findByRole("tab", { name: "Tests" }));
  const panel = within(screen.getByRole("tabpanel", { name: "Tests" }));
  await panel.findByText("No enabled suite runs: unit.");
  await user.click(screen.getByRole("tab", { name: "Workflow" }));
  await user.click(await screen.findByRole("button", { name: "Change the code: Run tests" }));
  await screen.findByText(/No enabled suite runs: unit\. A code change will stop\./);
});

it("adds a guard to the skeleton step from the graph", async () => {
  const calls = serve();
  const user = userEvent.setup();
  render(<Editor />);
  await user.click(await screen.findByRole("tab", { name: "Guards" }));
  await user.click(await screen.findByRole("button", { name: "Add guard" }));
  await screen.findByText("New guard");
  await user.click(screen.getByRole("tab", { name: "Workflow" }));
  await user.click(await screen.findByRole("button", { name: "Change the code: Skeleton" }));
  await user.click(await screen.findByRole("checkbox", { name: "New guard" }));
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "New guard" })).toBeChecked());
  expect(calls.find((call) => call.method === "PUT")?.body).toMatchObject({
    content: { phases: ["guards", "skeleton"] },
  });
});
