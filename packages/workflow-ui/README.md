# @kushex/workflow-ui

Reusable React workflow panel. The required input is a serializable `WorkflowGraph`;
the panel owns layout, local selection, and read-only inspection. It does not fetch
data, run a workflow, or save agent configuration. React and Ant Design are peers,
so it follows the host's `ConfigProvider` theme.

```tsx
import { WorkflowPanel, type WorkflowGraph } from "@kushex/workflow-ui";

const graph: WorkflowGraph = {
  id: "review",
  title: "Review workflow",
  nodes: [
    { id: "write", title: "Write", skills: [{ id: "research", label: "Research" }] },
    { id: "check", title: "Check", guards: [{ id: "facts", label: "Fact check" }] },
    { id: "approve", title: "Approve", kind: "human", pauses: true },
  ],
  edges: [
    { id: "write-check", fromStepId: "write", toStepId: "check" },
    { id: "check-approve", fromStepId: "check", toStepId: "approve" },
    { id: "revise", fromStepId: "check", toStepId: "write", kind: "return", maxTraversals: 2 },
  ],
};

<WorkflowPanel graph={graph} />;
```

Load stored JSON into the same shape. No functions or React elements belong in the
graph. `nodes` contain titles, descriptions, executor/model names, policies, skill
and guard attachments, attempt limits, and optional lane IDs. `edges` use Kushibot's
`fromStepId` / `toStepId` endpoint names:

- `forward` (the default) determines dependency order and automatic layout.
- `return` goes back to an earlier step.
- `retry` repeats the same step.
- `stop` leads to a terminal outcome and uses a dashed line.

Optional `lanes` label branches. Optional `controls` group return edges by
`controlId`, with a shared label and limit. Without lanes, independent steps are
placed in separate columns. Invalid references, duplicate IDs, and forward cycles
produce an error panel. Layout is horizontally scrollable in a narrow host.

## Kushibot definitions

Kushibot's `WorkflowDefinition` contains steps, dependency IDs, executor and policy
registrations, attempt limits, and bounded transitions to ancestors (including
self-transitions). Its `SkillDescriptor` and `GuardDefinition` are separate types;
a workflow definition alone does not tell the viewer which phase runs a skill or
guard. Supply those associations as display metadata:

```tsx
import { fromWorkflowDefinition, WorkflowPanel } from "@kushex/workflow-ui";

const graph = fromWorkflowDefinition(definitionJson, {
  implement: {
    title: "Implement",
    skills: [{ id: "testing", label: "Testing", enabled: true }],
    guards: [{ id: "validation", label: "Input validation" }],
  },
});
<WorkflowPanel graph={graph} />;
```

This structural adapter accepts a Kushibot definition without a runtime dependency
on Kushibot. It preserves registration versions, dependency edges, attempt limits,
and transition traversal limits. Hosts that already produce display graphs can
pass those directly.

## Complete agent settings panel

`AgentSettingsPanel` owns the entire configuration view: request mode, Workflow,
Tests, Skills, Guards, Memory, workflow inspection, and save/error
feedback. All React editors live in this package.

```tsx
import { AgentSettingsPanel, AgentSettingsHost } from "@kushex/workflow-ui";

// config contains only JSON data, including the current project/API address.
<AgentSettingsPanel config={{ ...agentConfig, projectId, apiBaseUrl: "/api" }} />;

// For a host with controlled next-message options, the shared adapter connects events.
<AgentSettingsHost
  config={agentConfig}
  projectId={projectId}
  apiBaseUrl="/api"
  disabled={false}
  value={messageOptions}
  onChange={setMessageOptions}
/>;
```

`AgentSettingsConfiguration` contains `agentId`, `schema`, `defaults`, and a graph
with optional layout coordinates. `edgeLimits` maps edge IDs to limit keys;
`nodeDetails` maps node IDs to a fixed worker label or the count sources `guards`
and `tests`. `SettingsWorkflowGraph` resolves model choices, enabled suites,
skill/guard attachments, return limits, and counts from the current draft.

The panel owns HTTP persistence, loading, drafts, revisions, definitions, memory,
and OpenRouter integration. Its only prop is `config`; no clients, stores, hooks,
React nodes, or callbacks are passed to it. API requests use
`/projects/:projectId/agents/:agentId/{settings,definitions}` and project `/memory`.
`apiBaseUrl` supplies the prefix. `AgentSettingsHost` bridges the surrounding app's
controlled request-mode events through context while keeping the panel input JSON.

The coding plugin's `ui/settings.json` supplies its complete configuration and
curated graph layout. `ui.tsx` only connects it to the shared host adapter. Runtime
workflow execution remains in the coding plugin. The library imports no coding
plugin or server code. `WorkflowPanel` remains available for graph-only uses.

Build/typecheck: `pnpm --filter @kushex/workflow-ui build` and
`pnpm --filter @kushex/workflow-ui typecheck`.
Component/adapter coverage uses the shared UI test setup:
`pnpm --filter @kushex/ui test -- src/plugin-api/WorkflowPanel.test.tsx`.

For curated diagrams, optional `presentation` JSON supplies node rectangles,
edge waypoints, and lane-label positions. Automatic layout remains the default.
This lets an extracted renderer retain an existing compact design without importing
agent-specific rendering code.
