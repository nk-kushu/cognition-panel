import type { AgentSettingsSchema } from "@kushex/workflow-ui";
import { codingEngineeringCatalog } from "../src/engineering/catalog";
import { RETURN_ROUTES, WORKFLOW_STEPS } from "../src/workflow/WorkflowGraph";
import { LIMITS, MODELS } from "./settingsFields";
import { ROUTE_LABELS } from "./codingWorkflowGraph";
const emptyCommand = {
  command: "npm",
  args: ["run", "lint", "--", "--max-warnings=0"],
  script: "",
  workingDirectory: ".",
  timeoutMs: 120_000,
  successExitCodes: [0],
};
const selection = (value: string) => (value === "auto" ? "automatic" : value);
export const codingSettingsSchema: AgentSettingsSchema = {
  limits: LIMITS,
  models: MODELS,
  defaultModelKey: "default",
  overviewLimits: ["totalReturns", "runMinutes", "modelCalls", "inputTokens"],
  totalReturnsKey: "totalReturns",
  verificationBlockedMessage: "A code change will stop.",
  modes: [
    { value: "", label: "Automatic (JEV decides)" },
    { value: "answer-only", label: "Explain only" },
    { value: "code-change", label: "Change the code" },
  ],
  steps: WORKFLOW_STEPS.map((step) => ({
    ...step,
    laneLabel:
      step.branch === "any"
        ? undefined
        : step.branch === "answer-only"
          ? "Explain"
          : "Change the code",
    showTestPrompt: step.id === "write-tests",
    showTests: step.id === "write-tests" || step.id === "run-tests",
    guidance:
      step.id === "human-review"
        ? {
            title: "Your choices",
            text: "Approve continues to implementation. Request changes returns to the skeleton, and Change the plan returns to planning. Cancel ends the run.",
          }
        : undefined,
  })),
  routes: Object.fromEntries(
    Object.entries(RETURN_ROUTES).map(([id, route]) => [
      id,
      { ...route, label: ROUTE_LABELS[id as keyof typeof ROUTE_LABELS] },
    ]),
  ),
  skillPhases: ["planning", "test-writing", "skeleton", "implementation", "answer"].map(
    (value) => ({ value }),
  ),
  guardPhases: [
    { value: "skeleton", label: "Skeleton, before review" },
    { value: "guards", label: "Finished change" },
  ],
  skillInputs: ["findings", "plan", "tests", "skeleton", "approval"].map((value) => ({ value })),
  newDefinitions: {
    skill: {
      name: "New skill",
      purpose: "What this skill is for.",
      instructions: "What the skill should do.",
      phases: ["planning"],
      dependencies: [],
      requiredInputs: [],
      expectedResult: "",
      selection: "automatic",
      model: "",
    },
    guard: {
      name: "New guard",
      purpose: "What this guard checks.",
      type: "deterministic",
      phases: ["guards"],
      selection: "automatic",
      blocking: true,
      reviewInstructions: "",
      model: "",
      check: emptyCommand,
    },
  },
  builtInDefinitions: {
    skill: codingEngineeringCatalog
      .filter((item) => item.skillInstructions)
      .map((item) => ({
        name: item.label,
        purpose: item.description.slice(0, 1000),
        instructions: item.skillInstructions,
        phases: ["planning", "implementation"],
        dependencies: [],
        requiredInputs: [],
        expectedResult: "",
        selection: selection(item.skillMode),
        model: "",
      })),
    guard: codingEngineeringCatalog.map((item) => ({
      name: item.label,
      purpose: item.description.slice(0, 1000),
      type: "llm",
      phases: ["guards"],
      selection: selection(item.guardMode),
      blocking: !item.advisory,
      reviewInstructions: item.reviewInstructions,
      model: "",
      check: null,
    })),
  },
};
