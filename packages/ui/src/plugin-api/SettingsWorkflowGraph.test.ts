import { expect, it } from "vitest";
import { SettingsWorkflowGraph, type AgentSettingsConfiguration } from "@kushex/workflow-ui";
import settingsJson from "../../../../plugins/coding/ui/settings.json";
import { defaultCodingSettings } from "../../../../plugins/coding/src/engineering/types";
import {
  WORKFLOW_STEPS,
  RETURN_ROUTES,
} from "../../../../plugins/coding/src/workflow/WorkflowGraph";

const config = settingsJson as AgentSettingsConfiguration;

it("keeps coding's JSON configuration aligned with its runtime workflow and defaults", () => {
  expect(config.defaults).toEqual(defaultCodingSettings);
  expect(config.schema.steps.map((step) => step.id)).toEqual(WORKFLOW_STEPS.map((step) => step.id));
  for (const step of WORKFLOW_STEPS) {
    expect(config.schema.steps.find((item) => item.id === step.id)).toMatchObject(step);
    for (const route of step.returns) {
      expect(config.graph.edges).toContainEqual(
        expect.objectContaining({
          fromStepId: step.id,
          toStepId: RETURN_ROUTES[route].target,
          controlId: route,
        }),
      );
    }
  }
  for (const [id, route] of Object.entries(RETURN_ROUTES)) {
    expect(config.schema.routes[id]).toMatchObject(route);
  }
});

it("updates graph limits, models, suite counts and attachments from the current draft", () => {
  const graph = new SettingsWorkflowGraph(config).build(
    {
      ...defaultCodingSettings,
      limits: { ...defaultCodingSettings.limits, totalReturns: 19, clarifications: 7, plan: 8 },
      models: { ...defaultCodingSettings.models, default: "provider/model" },
      testSuites: [
        {
          id: "unit",
          type: "unit",
          name: "Unit",
          command: "npm",
          args: ["test"],
          workingDirectory: ".",
          timeoutMs: 1000,
          enabled: true,
        },
      ],
    },
    [
      {
        id: "skill-1",
        version: 1,
        versionId: "v1",
        kind: "skill",
        enabled: true,
        content: { name: "Review the plan", phases: ["planning"], selection: "automatic" },
      },
    ],
  );
  expect(graph.overview).toBe("Whole run: 19 returns");
  expect(graph.edges.find((edge) => edge.id === "clarify")?.maxTraversals).toBe(7);
  expect(graph.nodes.find((node) => node.id === "run-tests")?.detail).toBe("1 suite");
  const planning = graph.nodes.find((node) => node.skills?.some((skill) => skill.id === "skill-1"));
  expect(planning?.models).toContain("provider/model");
  expect(planning?.detail).toContain("1 skill");
  expect(planning?.skills).toContainEqual(
    expect.objectContaining({ id: "skill-1", enabled: true }),
  );
  const cleared = new SettingsWorkflowGraph(config).build(defaultCodingSettings, []);
  expect(cleared.nodes.every((node) => !node.skills?.length)).toBe(true);
});
