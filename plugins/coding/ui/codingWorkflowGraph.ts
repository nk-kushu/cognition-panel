import { codingWorkflowPresentation } from "./codingWorkflowPresentation";
import type { AgentDefinition as AgentDefinitionDto } from "@kushex/workflow-ui";
import type { WorkflowGraph, WorkflowEdge, WorkflowAttachment } from "@kushex/workflow-ui";
import type { CodingSettings } from "../src/engineering/types";
import {
  RETURN_ROUTES,
  WORKFLOW_STEPS,
  type ReturnRoute,
  type WorkflowStep,
} from "../src/workflow/WorkflowGraph";
import { MODELS } from "./settingsFields";

export const STEPS: readonly WorkflowStep[] = WORKFLOW_STEPS;
export const ROUTE_LABELS: Readonly<Record<ReturnRoute, string>> = {
  investigation: "Investigation returns",
  plan: "Plan revisions",
  skeleton: "Skeleton revisions",
  "code-fix": "Code-fix returns",
};
/** Line two of a step: who does the work, then whatever is configured for it. */
function detail(
  step: WorkflowStep,
  settings: CodingSettings,
  definitions: readonly AgentDefinitionDto[],
) {
  const role = step.models[0];
  const skills = definitions.filter(
    (item) =>
      item.kind === "skill" &&
      item.enabled &&
      item.content.selection !== "off" &&
      step.skillPhase &&
      (item.content.phases as readonly string[]).includes(step.skillPhase),
  ).length;
  const guards = definitions.filter(
    (item) =>
      item.kind === "guard" &&
      item.enabled &&
      item.content.selection !== "off" &&
      step.guardPhase &&
      ((item.content.phases ?? ["guards"]) as readonly string[]).includes(step.guardPhase),
  ).length;
  const suites = settings.testSuites.filter((suite) => suite.enabled).length;
  const worker =
    step.id === "guards"
      ? `${guards} guard${guards === 1 ? "" : "s"}`
      : step.id === "run-tests"
        ? `${suites} suite${suites === 1 ? "" : "s"}`
        : step.worker === "jev"
          ? "JEV"
          : step.worker === "human"
            ? "You approve, change or cancel"
            : role &&
              (settings.models[role] ||
                settings.models.default ||
                MODELS.find(({ key }) => key === role)!.label);
  return [
    worker,
    skills > 0 && `${skills} skill${skills === 1 ? "" : "s"}`,
    step.id === "skeleton" && guards > 0 && `${guards} guard${guards === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Coding-specific phase assignments become plain JSON at this boundary. */
export function codingWorkflowGraph(
  settings: CodingSettings,
  definitions: readonly AgentDefinitionDto[],
): WorkflowGraph {
  const attachments = (step: WorkflowStep, kind: "skill" | "guard"): WorkflowAttachment[] => {
    const phase = kind === "skill" ? step.skillPhase : step.guardPhase;
    if (!phase) return [];
    return definitions
      .filter(
        (item) =>
          item.kind === kind &&
          (
            (item.content.phases ?? (kind === "guard" ? ["guards"] : [])) as readonly string[]
          ).includes(phase),
      )
      .map((item) => ({
        id: item.id,
        label: String(item.content.name ?? item.id),
        description: String(item.content.description ?? ""),
        enabled: item.enabled && item.content.selection !== "off",
      }));
  };
  const edges: WorkflowEdge[] = [];
  for (const branch of ["answer-only", "code-change"] as const) {
    const lane = STEPS.filter((step) => step.branch === branch);
    let previous = "mode";
    for (const step of lane) {
      edges.push({
        id: `${previous}-${step.id}`,
        fromStepId: previous,
        toStepId: step.id,
        kind: "forward",
      });
      previous = step.id;
    }
    edges.push({
      id: `${branch}-done`,
      fromStepId: previous,
      toStepId: `${branch}-done`,
      kind: "forward",
    });
  }
  for (const step of STEPS)
    for (const route of step.returns) {
      edges.push({
        id: `${step.id}-${route}`,
        fromStepId: step.id,
        toStepId: RETURN_ROUTES[route].target,
        kind: "return",
        controlId: route,
        label: ROUTE_LABELS[route],
        policy: RETURN_ROUTES[route].summary,
        maxTraversals: settings.limits[RETURN_ROUTES[route].limit],
      });
    }
  edges.push(
    {
      id: "clarify",
      fromStepId: "mode",
      toStepId: "mode",
      kind: "retry",
      label: "Mode clarifications",
      maxTraversals: settings.limits.clarifications,
    },
    {
      id: "answer-rounds",
      fromStepId: "answer-investigate",
      toStepId: "answer-investigate",
      kind: "retry",
      label: "Answer-only investigation rounds",
      maxTraversals: settings.limits.answerRounds,
    },
    {
      id: "cancel",
      fromStepId: "human-review",
      toStepId: "cancelled",
      kind: "stop",
      label: "Cancel",
    },
  );
  for (const step of STEPS.filter(
    (step) => step.returns.length || step.id === "mode" || step.id === "answer-investigate",
  )) {
    edges.push({
      id: `${step.id}-stop`,
      fromStepId: step.id,
      toStepId: "stopped",
      kind: "stop",
      label: "Limit reached or no progress",
    });
  }
  return {
    presentation: codingWorkflowPresentation(edges),
    id: "coding",
    title: "Coding workflow",
    description: "Select a step or return limit to inspect its configuration.",
    lanes: [
      { id: "answer-only", label: "Explain" },
      { id: "code-change", label: "Change the code" },
      { id: "outcomes", label: "Stopped runs" },
    ],
    overview: `Whole run: ${settings.limits.totalReturns} returns`,
    controls: (Object.keys(RETURN_ROUTES) as ReturnRoute[]).map((id) => ({
      id,
      label: ROUTE_LABELS[id],
      value: settings.limits[RETURN_ROUTES[id].limit],
    })),
    nodes: [
      ...STEPS.map((step) => ({
        id: step.id,
        title: step.title,
        description: step.summary,
        lane: step.branch === "any" ? undefined : step.branch,
        kind: step.worker === "human" ? ("human" as const) : ("step" as const),
        executor: step.worker,
        models: step.models
          .map((role) => settings.models[role] || settings.models.default)
          .filter(Boolean),
        detail: detail(step, settings, definitions),
        skills: attachments(step, "skill"),
        guards: attachments(step, "guard"),
        pauses: step.pauses,
      })),
      { id: "answer-only-done", title: "Answer", lane: "answer-only", kind: "terminal" },
      { id: "code-change-done", title: "Proposal to apply", lane: "code-change", kind: "terminal" },
      { id: "stopped", title: "Stop and report", lane: "outcomes", kind: "terminal" },
      { id: "cancelled", title: "Run cancelled", lane: "outcomes", kind: "terminal" },
    ],
    edges,
  };
}
