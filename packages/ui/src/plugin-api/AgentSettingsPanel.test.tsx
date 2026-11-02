import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import {
  AgentSettingsPanel,
  AgentSettingsHost,
  type AgentSettingsSchema,
  type AgentSettingsApi,
  type AgentSettings,
} from "@kushex/workflow-ui";

afterEach(() => vi.unstubAllGlobals());

const defaults: AgentSettings = {
  limits: { budget: 4 },
  models: { author: "" },
  testWritingPrompt: "",
  testTypes: [],
  testSuites: [],
};
const schema: AgentSettingsSchema = {
  limits: [{ key: "budget", label: "Article budget", min: 1, max: 20 }],
  models: [{ key: "author", label: "Author" }],
  defaultModelKey: "author",
  overviewLimits: ["budget"],
  steps: [
    {
      id: "draft",
      title: "Draft article",
      summary: "Prepare a draft.",
      models: ["author"],
      limits: ["budget"],
      returns: [],
      skillPhase: "drafting",
    },
  ],
  routes: {},
  modes: [{ value: "article", label: "Write article" }],
  skillPhases: [{ value: "drafting", label: "Drafting" }],
  guardPhases: [{ value: "publication" }],
  skillInputs: [{ value: "sources" }],
  newDefinitions: {
    skill: {
      name: "Editorial skill",
      phases: ["drafting"],
      dependencies: [],
      selection: "automatic",
    },
    guard: { name: "Editorial guard", phases: ["publication"], type: "llm" },
  },
  builtInDefinitions: { skill: [], guard: [] },
};

it("renders the settings UI without a Limits tab and saves limits through the workflow inspector", async () => {
  const saveSettings = vi.fn<AgentSettingsApi["saveSettings"]>(async (settings) => ({
    settings,
    revision: 8,
  }));
  const createDefinition = vi.fn();
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/settings")) {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        return Response.json(await saveSettings(body.settings, body.baseRevision));
      }
      return Response.json({ settings: {}, revision: 7 });
    }
    if (url.endsWith("/definitions")) {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        createDefinition(body.kind, body.content);
        return Response.json({ id: "new", ...body });
      }
      return Response.json([]);
    }
    return Response.json([]);
  });
  vi.stubGlobal("fetch", fetchMock);
  const config = JSON.parse(
    JSON.stringify({
      agentId: "editorial",
      schema,
      defaults,
      graph: {
        id: "editorial",
        title: "Editorial workflow",
        nodes: [{ id: "draft", title: "Draft article" }],
        edges: [],
      },
    }),
  );
  const user = userEvent.setup();
  render(
    <AgentSettingsPanel
      config={{ ...config, projectId: "project /1", apiBaseUrl: "/editorial-api" }}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "Draft article" }));
  expect(screen.getByLabelText("Author model")).toBeVisible();
  expect(fetchMock).toHaveBeenCalledWith(
    "/editorial-api/projects/project%20%2F1/agents/editorial/settings",
    expect.objectContaining({ method: "GET" }),
  );
  const budget = screen.getByLabelText("Article budget");
  await user.tripleClick(budget);
  await user.keyboard("9");
  expect(screen.queryByRole("tab", { name: "Limits" })).not.toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "Models" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ limits: { budget: 9 } }), 7);
  await user.click(screen.getByRole("tab", { name: "Skills" }));
  expect(screen.queryByRole("button", { name: "Add built-in skills" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Add skill" }));
  expect(createDefinition).toHaveBeenCalledWith("skill", schema.newDefinitions.skill);
  await user.click(screen.getByRole("tab", { name: "Guards" }));
  expect(screen.queryByRole("button", { name: "Add built-in guards" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Add guard" }));
  expect(createDefinition).toHaveBeenCalledWith("guard", schema.newDefinitions.guard);
  for (const name of ["Workflow", "Tests", "Skills", "Guards", "Memory"]) {
    expect(screen.getByRole("tab", { name })).toBeVisible();
  }
});

it("connects request mode to the host while preserving other message options", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ settings: {}, revision: 1 })),
  );
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(
    <AgentSettingsHost
      config={{
        agentId: "editorial",
        schema,
        defaults,
        graph: { id: "editorial", title: "Editorial", nodes: [], edges: [] },
      }}
      projectId="p1"
      apiBaseUrl="/api"
      disabled={false}
      value={{ mode: "", note: "Keep this" }}
      onChange={onChange}
    />,
  );
  await user.click(screen.getByRole("combobox", { name: "Request mode" }));
  await user.click(screen.getByText("Write article"));
  expect(onChange).toHaveBeenCalledWith({ mode: "article", note: "Keep this" });
});

it.each(["skill", "guard"] as const)(
  "deletes a collapsed %s after confirmation and reloads the list",
  async (kind) => {
    let items = [
      {
        id: "definition /1",
        version: 1,
        versionId: "v1",
        kind,
        enabled: true,
        content: { ...schema.newDefinitions[kind], name: "Project convention" },
      },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "DELETE") {
        items = [];
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/definitions")) return Response.json(items);
      if (url.endsWith("/settings")) return Response.json({ settings: {}, revision: 1 });
      return Response.json([]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <AgentSettingsPanel
        config={{
          agentId: "editorial",
          schema,
          defaults,
          projectId: "p1",
          apiBaseUrl: "/api",
          graph: { id: "editorial", title: "Editorial", nodes: [], edges: [] },
        }}
      />,
    );
    await user.click(screen.getByRole("tab", { name: kind === "skill" ? "Skills" : "Guards" }));
    const remove = await screen.findByRole("button", {
      name: `Delete ${kind}: Project convention`,
    });
    await user.click(remove);
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    await user.click(remove);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: `Delete ${kind}: Project convention` }),
      ).not.toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/agents/editorial/definitions/definition%20%2F1",
      expect.objectContaining({
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    );
    expect(screen.getByText("None saved for this project.")).toBeVisible();
  },
);
