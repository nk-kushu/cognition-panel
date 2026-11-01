import { Alert, Select, Tabs, Typography } from "antd";
import { useState } from "react";
import { WorkflowPanel } from "../WorkflowPanel";
import type { WorkflowSelection } from "../types";
import {
  OpenRouterApiContext,
  OpenRouterModelsContext,
  OpenRouterPanel,
  type OpenRouterModel,
} from "../OpenRouter";
import { DefinitionsPanel } from "./DefinitionsPanel";
import { MemoryPanel } from "./MemoryPanel";
import { SettingsPanel } from "./SettingsPanel";
import { SettingsSchemaContext } from "./SettingsSchemaContext";
import { WorkflowInspector } from "./WorkflowInspector";
import type { AgentSettingsPanelProps } from "./types";

/** Complete agent configuration UI. The host supplies schema, graph, state and persistence. */
export function AgentSettingsPanel({
  schema,
  graph,
  api,
  store,
  definitions,
  disabled,
  requestMode,
  onRequestModeChange,
  apiBaseUrl,
}: AgentSettingsPanelProps) {
  const [tab, setTab] = useState("workflow");
  const [selection, setSelection] = useState<WorkflowSelection>({ kind: "graph" });
  const [models, setModels] = useState<readonly OpenRouterModel[]>([]);
  const select = (next: WorkflowSelection) => {
    setSelection(
      next.kind === "step" && !schema.steps.some((step) => step.id === next.id)
        ? { kind: "graph" }
        : next,
    );
  };
  return (
    <SettingsSchemaContext.Provider value={schema}>
      <OpenRouterApiContext.Provider value={apiBaseUrl}>
        <OpenRouterModelsContext.Provider value={models}>
          <div
            style={{
              maxWidth: 1100,
              margin: "0 auto",
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            {schema.modes.length > 0 && (
              <div>
                Next message
                <Select
                  aria-label="Request mode"
                  disabled={disabled}
                  style={{ display: "block", width: 280, maxWidth: "100%", marginTop: 6 }}
                  value={requestMode}
                  options={[...schema.modes]}
                  onChange={onRequestModeChange}
                />
              </div>
            )}
            <Alert
              type="info"
              showIcon
              title="Project settings apply to new runs."
              description="A run keeps the settings, skills and guards it started with, even while it waits for you."
            />
            <Tabs
              activeKey={tab}
              onChange={setTab}
              items={[
                {
                  key: "workflow",
                  label: "Workflow",
                  children: store.settings ? (
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 32,
                        alignItems: "flex-start",
                      }}
                    >
                      <div style={{ flex: "0 1 528px", minWidth: 0, maxWidth: "100%" }}>
                        <WorkflowPanel
                          graph={graph}
                          selection={selection}
                          onSelect={select}
                          showDetails={false}
                        />
                        <Typography.Paragraph
                          type="secondary"
                          style={{ marginTop: 12, maxWidth: 524 }}
                        >
                          Grey arrows are the normal path. Coloured lines send a run back or repeat
                          a step, and each number is how many times it may. Dashed lines end the
                          run: a run that reaches a limit or makes no progress stops and reports
                          what is unresolved.
                        </Typography.Paragraph>
                      </div>
                      <div
                        style={{
                          flex: "1 1 300px",
                          minWidth: 0,
                          position: "sticky",
                          top: 0,
                          maxHeight: "calc(100dvh - 96px)",
                          overflowY: "auto",
                        }}
                      >
                        <WorkflowInspector
                          api={api}
                          settings={store.settings}
                          store={store}
                          definitions={definitions}
                          selection={selection}
                          disabled={disabled}
                          onSelect={select}
                          onOpenTab={setTab}
                        />
                      </div>
                    </div>
                  ) : store.notice ? (
                    <Alert type="error" title={store.notice.text} />
                  ) : null,
                },
                {
                  key: "limits",
                  label: "Limits",
                  children: <SettingsPanel store={store} section="limits" disabled={disabled} />,
                },
                {
                  key: "models",
                  label: "Models",
                  children: (
                    <>
                      <OpenRouterPanel disabled={disabled} onModels={setModels} />
                      <SettingsPanel store={store} section="models" disabled={disabled} />
                    </>
                  ),
                },
                {
                  key: "tests",
                  label: "Tests",
                  children: <SettingsPanel store={store} section="tests" disabled={disabled} />,
                },
                {
                  key: "skills",
                  label: "Skills",
                  children: (
                    <DefinitionsPanel
                      api={api}
                      store={definitions}
                      kind="skill"
                      disabled={disabled}
                    />
                  ),
                },
                {
                  key: "guards",
                  label: "Guards",
                  children: (
                    <DefinitionsPanel
                      api={api}
                      store={definitions}
                      kind="guard"
                      disabled={disabled}
                    />
                  ),
                },
                {
                  key: "memory",
                  label: "Memory",
                  children: <MemoryPanel api={api} disabled={disabled} />,
                },
              ]}
            />
          </div>
        </OpenRouterModelsContext.Provider>
      </OpenRouterApiContext.Provider>
    </SettingsSchemaContext.Provider>
  );
}
