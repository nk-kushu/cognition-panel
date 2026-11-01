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
Limits, Models, Tests, Skills, Guards, Memory, workflow inspection, and save/error
feedback. All React editors live in this package.

```tsx
import {
  AgentSettingsPanel,
  useAgentSettings,
  useAgentDefinitions,
  type AgentSettingsSchema,
  type AgentSettingsApi,
} from "@kushex/workflow-ui";

// Keep the API object and defaults stable across renders.
const store = useAgentSettings(api, defaults);
const definitions = useAgentDefinitions(api);

<AgentSettingsPanel
  schema={schema}
  graph={graph}
  api={api}
  store={store}
  definitions={definitions}
  disabled={false}
  apiBaseUrl="/api"
  requestMode={mode}
  onRequestModeChange={setMode}
/>;
```

`AgentSettingsSchema` is serializable data describing limit/model fields, request
modes, step configuration, return routes, skill/guard phases, required inputs, and
blank/built-in definitions. Limits, model keys and phase IDs are supplied by the
agent. `AgentSettingsApi` is a structural interface for settings, definitions and
memory persistence; no endpoint or agent name is fixed in the library.

The settings hooks are optional: a host can supply controlled stores instead.
`AgentSettingsStore` provides the draft, dirty state, notices, update and save;
`AgentDefinitionsStore` provides definitions and change/reload behavior. All tabs
and the workflow inspector share the same draft and revision. Saved definition
changes are reflected throughout the panel.

For graph-only uses, `WorkflowPanel` remains available. Use its optional
`selection` / `onSelect` for controlled selection and `showDetails={false}` when
the host supplies another inspector.

The coding plugin's `ui.tsx` is a thin adapter. `ui/settingsSchema.ts` supplies its
configuration, `ui/codingWorkflowGraph.ts` creates graph JSON from its step
catalog/settings/definitions, and `ui/api.ts` implements persistence. Logical graph
lanes show active branches; the runtime chain also completes inactive steps without
work. The library imports no coding plugin or server code. OpenRouter components
also live here and remain re-exported by `@kushex/ui` for compatibility.

Build/typecheck: `pnpm --filter @kushex/workflow-ui build` and
`pnpm --filter @kushex/workflow-ui typecheck`.
Component/adapter coverage uses the shared UI test setup:
`pnpm --filter @kushex/ui test -- src/plugin-api/WorkflowPanel.test.tsx`.

For curated diagrams, optional `presentation` JSON supplies node rectangles,
edge waypoints, and lane-label positions. Automatic layout remains the default.
This lets an extracted renderer retain an existing compact design without importing
agent-specific rendering code.
