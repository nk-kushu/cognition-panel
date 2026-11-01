import { defaultCodingSettings } from "../../../../plugins/coding/src/engineering/types";
import codingConfig from "../../../../plugins/coding/ui/settings.json";
import { SettingsWorkflowGraph, type AgentSettingsConfiguration } from "@kushex/workflow-ui";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { WorkflowPanel, fromWorkflowDefinition, type WorkflowGraph } from "@kushex/workflow-ui";
import { WorkflowLayout } from "../../../workflow-ui/src/WorkflowLayout";

const graph: WorkflowGraph = {
  id: "publishing",
  title: "Publishing workflow",
  nodes: [
    {
      id: "draft",
      title: "Draft article",
      skills: [{ id: "research", label: "Research sources", description: "Find evidence" }],
    },
    {
      id: "review",
      title: "Review article",
      kind: "human",
      guards: [{ id: "facts", label: "Check facts", enabled: false }],
    },
    { id: "publish", title: "Publish article" },
  ],
  edges: [
    { id: "draft-review", fromStepId: "draft", toStepId: "review" },
    { id: "review-publish", fromStepId: "review", toStepId: "publish" },
    { id: "revise", fromStepId: "review", toStepId: "draft", kind: "return", maxTraversals: 2 },
    { id: "retry", fromStepId: "draft", toStepId: "draft", kind: "retry", maxTraversals: 3 },
  ],
};

it("renders JSON for an unrelated agent and inspects its skills and guards without host callbacks", async () => {
  const user = userEvent.setup();
  render(<WorkflowPanel graph={JSON.parse(JSON.stringify(graph)) as WorkflowGraph} />);
  await user.click(screen.getByRole("button", { name: "Draft article" }));
  expect(screen.getByText("Research sources", { exact: false })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Review article" }));
  expect(screen.getByText("Check facts (disabled)")).toBeVisible();
  expect(screen.getByRole("button", { name: "Retry: 3" })).toBeVisible();
});

it("lays out dependencies with bounded return paths and isolates SVG markers between panels", () => {
  const layout = new WorkflowLayout(graph);
  expect(layout.errors).toEqual([]);
  expect(layout.boxes.get("review")!.y).toBeGreaterThan(layout.boxes.get("draft")!.y);
  expect(layout.boxes.get("publish")!.y).toBeGreaterThan(layout.boxes.get("review")!.y);
  const { container } = render(
    <>
      <WorkflowPanel graph={graph} />
      <WorkflowPanel graph={graph} />
    </>,
  );
  const markers = [...container.querySelectorAll("marker")].map((item) => item.id);
  expect(new Set(markers).size).toBe(markers.length);
});

it("reports missing endpoints and accidental forward cycles without crashing", () => {
  const { rerender } = render(
    <WorkflowPanel
      graph={{ ...graph, edges: [{ id: "bad", fromStepId: "draft", toStepId: "missing" }] }}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("references a missing step");
  rerender(
    <WorkflowPanel
      graph={{
        ...graph,
        edges: [...graph.edges, { id: "cycle", fromStepId: "publish", toStepId: "draft" }],
      }}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("contain a cycle");
});

it("adapts Kushibot definitions, preserving dependencies, policy versions, and traversal bounds", () => {
  const ref = { id: "policy", version: "2" };
  const adapted = fromWorkflowDefinition(
    {
      id: "agent",
      version: "1",
      maxTotalAttempts: 12,
      steps: [
        {
          id: "a",
          dependencies: [],
          executor: ref,
          inputPolicy: ref,
          acceptancePolicy: ref,
          maxAttempts: 3,
        },
        {
          id: "b",
          dependencies: ["a"],
          executor: ref,
          inputPolicy: ref,
          acceptancePolicy: ref,
          maxAttempts: 2,
        },
      ],
      transitions: [
        { id: "revise", fromStepId: "b", toStepId: "a", policy: ref, maxTraversals: 2 },
      ],
    },
    { a: { title: "Plan", skills: [{ id: "research", label: "Research" }] } },
  );
  expect(adapted.nodes[0]).toMatchObject({ title: "Plan", executor: "policy@2", maxAttempts: 3 });
  expect(adapted.edges).toEqual([
    { id: "dependency:b:0", fromStepId: "a", toStepId: "b", kind: "forward" },
    {
      id: "transition:revise",
      fromStepId: "b",
      toStepId: "a",
      kind: "return",
      label: "revise",
      policy: "policy@2",
      maxTraversals: 2,
    },
  ]);
  expect(new WorkflowLayout(adapted).errors).toEqual([]);
});

it("keeps the coding graph compact with non-overlapping cards and separate return paths", () => {
  const coding = new SettingsWorkflowGraph(codingConfig as AgentSettingsConfiguration).build(
    defaultCodingSettings,
    [],
  );
  const layout = new WorkflowLayout(coding);
  expect(layout.errors).toEqual([]);
  expect(layout.width).toBeLessThanOrEqual(528);
  const boxes = [...layout.boxes.values()];
  for (let index = 0; index < boxes.length; index++) {
    const a = boxes[index]!;
    for (const b of boxes.slice(index + 1)) {
      expect(
        a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y,
      ).toBe(true);
    }
  }
  const returns = coding.edges
    .map((edge, index) => ({ edge, path: layout.path(index) }))
    .filter(({ edge }) => edge.fromStepId === "skeleton" && edge.kind === "return");
  expect(new Set(returns.map(({ path }) => path)).size).toBe(returns.length);
});
