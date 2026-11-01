import type { WorkflowAttachment, WorkflowGraph } from "../types";
import type {
  AgentDefinition,
  AgentSettings,
  AgentSettingsConfiguration,
  ConfigurableStep,
} from "./types";

/** Resolves declarative graph bindings against the current draft and definitions. */
export class SettingsWorkflowGraph {
  constructor(private readonly config: AgentSettingsConfiguration) {}

  build(settings: AgentSettings, definitions: readonly AgentDefinition[]): WorkflowGraph {
    const { graph, schema } = this.config;
    return {
      ...graph,
      overview: schema.totalReturnsKey
        ? `Whole run: ${settings.limits[schema.totalReturnsKey]} returns`
        : graph.overview,
      controls: Object.entries(schema.routes).map(([id, route]) => ({
        id,
        label: route.label,
        value: settings.limits[route.limit] ?? 0,
      })),
      edges: graph.edges.map((edge) => {
        const limit = this.config.edgeLimits?.[edge.id];
        return limit ? { ...edge, maxTraversals: settings.limits[limit] } : edge;
      }),
      nodes: graph.nodes.map((node) => {
        const step = schema.steps.find((item) => item.id === node.id);
        if (!step) return node;
        const skills = this.attachments(step, "skill", definitions);
        const guards = this.attachments(step, "guard", definitions);
        const skillCount = skills.filter((item) => item.enabled).length;
        const guardCount = guards.filter((item) => item.enabled).length;
        const source = this.config.nodeDetails?.[step.id];
        const models = step.models
          .map((role) => settings.models[role] || settings.models[schema.defaultModelKey])
          .filter((model): model is string => Boolean(model));
        const suites = settings.testSuites.filter((suite) => suite.enabled).length;
        const worker =
          source === "guards"
            ? this.count(guardCount, "guard")
            : source === "tests"
              ? this.count(suites, "suite")
              : (source ??
                models[0] ??
                schema.models.find((item) => item.key === step.models[0])?.label);
        return {
          ...node,
          models,
          skills,
          guards,
          detail: [
            worker,
            skillCount > 0 && this.count(skillCount, "skill"),
            source !== "guards" && guardCount > 0 && this.count(guardCount, "guard"),
          ]
            .filter(Boolean)
            .join(" · "),
        };
      }),
    };
  }

  private count(value: number, noun: string): string {
    return `${value} ${noun}${value === 1 ? "" : "s"}`;
  }

  private attachments(
    step: ConfigurableStep,
    kind: "skill" | "guard",
    definitions: readonly AgentDefinition[],
  ): WorkflowAttachment[] {
    const phase = kind === "skill" ? step.skillPhase : step.guardPhase;
    if (!phase) return [];
    return definitions
      .filter(
        (item) =>
          item.kind === kind &&
          Array.isArray(item.content.phases) &&
          item.content.phases.includes(phase),
      )
      .map((item) => ({
        id: item.id,
        label: String(item.content.name ?? item.id),
        description: String(item.content.description ?? ""),
        enabled: item.enabled && item.content.selection !== "off",
      }));
  }
}
