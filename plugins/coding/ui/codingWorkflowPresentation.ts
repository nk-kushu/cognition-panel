import type {
  WorkflowBox,
  WorkflowEdge,
  WorkflowPoint,
  WorkflowPresentation,
} from "@kushex/workflow-ui";
import { WORKFLOW_STEPS } from "../src/workflow/WorkflowGraph";

/** Display coordinates only. The shared library still owns all React rendering. */
export function codingWorkflowPresentation(edges: readonly WorkflowEdge[]): WorkflowPresentation {
  const nodes: Record<string, WorkflowBox> = { mode: { x: 85, y: 0, width: 216, height: 56 } };
  for (const branch of ["answer-only", "code-change"] as const) {
    const steps = WORKFLOW_STEPS.filter((step) => step.branch === branch);
    const x = branch === "answer-only" ? 0 : 194;
    const width = branch === "answer-only" ? 170 : 216;
    steps.forEach((step, index) => {
      nodes[step.id] = { x, y: 104 + index * 72, width, height: 56 };
    });
    nodes[`${branch}-done`] = { x, y: 104 + steps.length * 72 + 12, width, height: 32 };
  }
  const end = nodes["code-change-done"]!.y;
  nodes.stopped = { x: 424, y: end, width: 100, height: 32 };
  nodes.cancelled = { x: 70, y: nodes["human-review"]!.y + 12, width: 100, height: 32 };
  const paths: Record<string, WorkflowPoint[]> = {};
  const rails: Record<string, number> = {
    investigation: 488,
    plan: 462,
    skeleton: 436,
    "code-fix": 436,
  };
  const offsets: Record<string, number> = {
    investigation: -15,
    plan: -5,
    skeleton: 5,
    "code-fix": 5,
  };
  for (const edge of edges) {
    const from = nodes[edge.fromStepId]!;
    const to = nodes[edge.toStepId]!;
    const center = from.y + from.height / 2;
    if (edge.kind === "return") {
      const rail = rails[edge.controlId!]!;
      const y = center + offsets[edge.controlId!]!;
      const arrival = to.y + to.height / 2 + 15;
      paths[edge.id] = [
        { x: from.x + from.width, y },
        { x: rail, y },
        { x: rail, y: arrival },
        { x: to.x + to.width + 1, y: arrival },
      ];
    } else if (edge.fromStepId === edge.toStepId) {
      const x = from.x + from.width;
      const rail = x + (from.width < 190 ? 12 : 24);
      paths[edge.id] = [
        { x, y: center - 12 },
        { x: rail, y: center - 12 },
        { x: rail, y: center + 12 },
        { x: x + 1, y: center + 12 },
      ];
    } else if (edge.id === "cancel") {
      paths[edge.id] = [
        { x: from.x, y: center },
        { x: to.x + to.width + 1, y: center },
      ];
    } else if (edge.kind === "stop") {
      // Termination paths stay in the outer gutter instead of crossing every return rail.
      const x = from.x + from.width;
      const rail = 512;
      paths[edge.id] = [
        { x, y: center - 22 },
        { x: rail, y: center - 22 },
        { x: rail, y: to.y - 2 },
      ];
    } else if (edge.fromStepId === "mode") {
      const x = from.x + from.width / 2;
      const target = to.x + to.width / 2;
      paths[edge.id] = [
        { x, y: from.y + from.height },
        { x, y: 76 },
        { x: target, y: 76 },
        { x: target, y: to.y - 2 },
      ];
    }
  }
  return {
    nodes,
    edges: paths,
    lanes: {
      "answer-only": { x: 90, y: 96 },
      "code-change": { x: 310, y: 96 },
      outcomes: { x: 424, y: end - 10 },
    },
  };
}
