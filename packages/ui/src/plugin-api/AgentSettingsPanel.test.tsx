import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import {
  AgentSettingsPanel,
  useAgentDefinitions,
  useAgentSettings,
  type AgentSettingsSchema,
  type AgentSettingsApi,
  type AgentSettings,
} from "@kushex/workflow-ui";

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

it("renders the full settings UI for another agent and shares custom field edits between graph and tabs", async () => {
  const saveSettings = vi.fn<AgentSettingsApi["saveSettings"]>(async (settings) => ({
    settings,
    revision: 8,
  }));
  const api: AgentSettingsApi = {
    settings: async () => ({ settings: {}, revision: 7 }),
    saveSettings,
    definitions: async () => [],
    createDefinition: vi.fn(),
    saveDefinition: vi.fn(),
    deleteDefinition: vi.fn(),
    memory: async () => [],
    addMemory: vi.fn(),
    updateMemory: vi.fn(),
    deleteMemory: vi.fn(),
  };
  function Editor() {
    const store = useAgentSettings(api, defaults);
    const definitions = useAgentDefinitions(api);
    return (
      <AgentSettingsPanel
        schema={schema}
        graph={{
          id: "editorial",
          title: "Editorial workflow",
          nodes: [{ id: "draft", title: "Draft article" }],
          edges: [],
        }}
        api={api}
        store={store}
        definitions={definitions}
        disabled={false}
        apiBaseUrl="/editorial-api"
        requestMode="article"
        onRequestModeChange={() => {}}
      />
    );
  }
  const user = userEvent.setup();
  render(<Editor />);
  await user.click(await screen.findByRole("button", { name: "Draft article" }));
  expect(screen.getByLabelText("Author model")).toBeVisible();
  const budget = screen.getByLabelText("Article budget");
  await user.tripleClick(budget);
  await user.keyboard("9");
  await user.click(screen.getByRole("tab", { name: "Limits" }));
  const limits = within(screen.getByRole("tabpanel", { name: "Limits" }));
  expect(limits.getByLabelText("Article budget")).toHaveValue("9");
  await user.click(limits.getByRole("button", { name: "Save" }));
  expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ limits: { budget: 9 } }), 7);
  await user.click(screen.getByRole("tab", { name: "Skills" }));
  await user.click(screen.getByRole("button", { name: "Add skill" }));
  expect(api.createDefinition).toHaveBeenCalledWith("skill", schema.newDefinitions.skill);
  for (const name of ["Workflow", "Limits", "Models", "Tests", "Skills", "Guards", "Memory"]) {
    expect(screen.getByRole("tab", { name })).toBeVisible();
  }
});
