import { Alert, Select, Tabs, Typography, theme } from "antd";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { WorkflowPanel } from "../WorkflowPanel";
import type { WorkflowSelection } from "../types";
import { OpenRouterApiContext, OpenRouterModelsContext, type OpenRouterModel } from "../OpenRouter";
import { OpenRouterApi } from "../OpenRouterApi";
import { DefinitionsPanel } from "./DefinitionsPanel";
import { MemoryPanel } from "./MemoryPanel";
import { SettingsPanel } from "./SettingsPanel";
import { SettingsSchemaContext } from "./SettingsSchemaContext";
import { WorkflowInspector } from "./WorkflowInspector";
import type { AgentSettingsPanelProps } from "./types";

import { HttpAgentSettingsApi } from "./AgentSettingsApi";
import { useAgentSettings, useAgentDefinitions } from "./useAgentSettings";
import { SettingsWorkflowGraph } from "./SettingsWorkflowGraph";
import { useRequestMode } from "./RequestModeContext";

const sections = {
  workflow: {
    title: "Workflow",
    detail: "Map & configure",
    description: "Explore how your agent works and adjust each part of its run.",
  },
  tests: {
    title: "Tests",
    detail: "Verification",
    description: "Define how the agent writes and runs tests to verify its work.",
  },
  skills: {
    title: "Skills",
    detail: "Agent capabilities",
    description: "Give your agent reusable instructions for specific phases of its work.",
  },
  guards: {
    title: "Guards",
    detail: "Checks & reviews",
    description: "Set up checks that review work and catch problems along the way.",
  },
  memory: {
    title: "Memory",
    detail: "Project preferences",
    description: "Keep project-specific preferences close at hand for future runs.",
  },
} as const;

type Section = keyof typeof sections;

const iconPaths: Record<Section, ReactNode> = {
  workflow: (
    <>
      <rect x="3" y="3" width="6" height="6" rx="1.5" />
      <rect x="15" y="15" width="6" height="6" rx="1.5" />
      <path d="M9 6h4a4 4 0 0 1 4 4v5M6 9v5a4 4 0 0 0 4 4h5" />
    </>
  ),
  tests: (
    <>
      <path d="M9 3h6M10 3v6l-5 8.5A2.3 2.3 0 0 0 7 21h10a2.3 2.3 0 0 0 2-3.5L14 9V3M8 15h8" />
    </>
  ),
  skills: (
    <>
      <path d="m12 3 1.8 5.7L19.5 10l-5.7 1.8L12 17.5l-1.8-5.7L4.5 10l5.7-1.3L12 3ZM19 16v5M16.5 18.5h5" />
    </>
  ),
  guards: (
    <>
      <path d="M12 3 20 6v5c0 5-3.4 8.2-8 10-4.6-1.8-8-5-8-10V6l8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  memory: (
    <>
      <path d="M7 4h10a2 2 0 0 1 2 2v15l-7-4-7 4V6a2 2 0 0 1 2-2Z" />
      <path d="M9 9h6M9 12h6" />
    </>
  ),
};

function SectionIcon({ section }: Readonly<{ section: Section }>) {
  return (
    <svg
      aria-hidden="true"
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {iconPaths[section]}
    </svg>
  );
}

function SectionHeading({ section }: Readonly<{ section: Section }>) {
  return (
    <div className="agent-config-section-heading">
      <div className="agent-config-eyebrow">
        AGENT CONFIGURATION <span>/</span> {sections[section].title.toUpperCase()}
      </div>
      <Typography.Title level={2} className="agent-config-title">
        {sections[section].title}
      </Typography.Title>
      <Typography.Paragraph type="secondary" className="agent-config-description">
        {sections[section].description}
      </Typography.Paragraph>
    </div>
  );
}

const styles = `
.agent-config { --agent-border: var(--agent-border-color); color: var(--agent-text); max-width: 1600px; margin: 0 auto; }
.agent-config * { box-sizing: border-box; }
.agent-config-top { display:flex; justify-content:space-between; align-items:center; gap:24px; padding: 22px 28px; border:1px solid var(--agent-border); border-radius:16px; background:var(--agent-bg); }
.agent-config-top-copy { min-width:0; }
.agent-config-kicker, .agent-config-eyebrow { color:var(--agent-muted); font-size:10px; font-weight:700; letter-spacing:.13em; }
.agent-config-top-title { display:flex; align-items:center; gap:10px; margin-top:6px; font-size:17px; font-weight:650; letter-spacing:-.02em; }
.agent-config-top-mark { display:grid; place-items:center; width:32px; height:32px; color:var(--agent-primary); background:var(--agent-primary-bg); border-radius:10px; }
.agent-config-top-note { color:var(--agent-muted); font-size:12px; margin:5px 0 0 42px; }
.agent-config-mode { display:flex; align-items:center; gap:14px; padding-left:22px; border-left:1px solid var(--agent-border); }
.agent-config-mode-label { color:var(--agent-muted); font-size:11px; white-space:nowrap; }
.agent-config-mode-label strong { display:block; color:var(--agent-text); font-size:12px; margin-bottom:2px; }
.agent-config-main { margin-top:18px; border:1px solid var(--agent-border); border-radius:16px; overflow:hidden; background:var(--agent-bg); }
.agent-config-tabs:is(.ant-tabs,.kx-tabs) { align-items:stretch; min-height:620px; }
.agent-config-tabs > :is(.ant-tabs-nav,.kx-tabs-nav) { width:220px; flex:none; margin:0; padding:25px 12px; background:var(--agent-subtle); }
.agent-config-tabs > :is(.ant-tabs-nav,.kx-tabs-nav)::before { border-color:var(--agent-border) !important; }
.agent-config-tabs :is(.ant-tabs-nav-list,.kx-tabs-nav-list) { width:100%; gap:4px; }
.agent-config-tabs :is(.ant-tabs-tab,.kx-tabs-tab) { margin:0 !important; padding:10px 12px !important; border-radius:9px; transition:background .18s ease; }
.agent-config-tabs :is(.ant-tabs-tab,.kx-tabs-tab):hover { background:var(--agent-hover); }
.agent-config-tabs :is(.ant-tabs-tab-active,.kx-tabs-tab-active) { background:var(--agent-selected); }
.agent-config-tabs :is(.ant-tabs-ink-bar,.kx-tabs-ink-bar) { display:none; }
.agent-config-tabs :is(.ant-tabs-tab-btn,.kx-tabs-tab-btn) { width:100%; }
.agent-config-tab { display:flex; align-items:center; gap:12px; text-align:left; }
.agent-config-tab-icon { display:grid; place-items:center; flex:none; color:var(--agent-muted); }
.agent-config-tabs :is(.ant-tabs-tab-active,.kx-tabs-tab-active) .agent-config-tab-icon { color:var(--agent-primary); }
.agent-config-tab-title { display:block; font-size:13px; line-height:1.3; font-weight:600; }
.agent-config-tab-detail { display:block; margin-top:3px; color:var(--agent-muted); font-size:11px; line-height:1.3; font-weight:400; }
.agent-config-tabs > :is(.ant-tabs-body-holder,.kx-tabs-body-holder) { min-width:0; border-color:var(--agent-border) !important; }
.agent-config-pane { min-width:0; padding:30px 34px 42px; }
.agent-config-section-heading { margin-bottom:25px; }
.agent-config-eyebrow span { margin:0 6px; opacity:.45; }
.agent-config .agent-config-title { margin:8px 0 4px; font-size:28px; line-height:1.2; letter-spacing:-.035em; }
.agent-config .agent-config-description { margin:0; max-width:660px; font-size:13px; line-height:1.6; }
.agent-config-content { max-width:850px; }
.agent-config-workflow { display:grid; grid-template-columns:minmax(0, 1.4fr) minmax(270px, .8fr); gap:20px; align-items:start; }
.agent-config-card { min-width:0; border:1px solid var(--agent-border); border-radius:13px; background:var(--agent-bg); }
.agent-config-card-header { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:17px 19px; border-bottom:1px solid var(--agent-border); }
.agent-config-card-title { font-size:13px; font-weight:650; }
.agent-config-card-subtitle { margin-top:3px; font-size:11px; color:var(--agent-muted); }
.agent-config-card-indicator { display:flex; align-items:center; gap:6px; white-space:nowrap; color:var(--agent-muted); font-size:11px; }
.agent-config-card-indicator::before { content:''; width:6px; height:6px; border-radius:50%; background:var(--agent-primary); }
.agent-config-card-body { padding:19px; }
.agent-config-graph-legend { margin-top:18px; padding:13px 15px; background:var(--agent-subtle); border-radius:9px; color:var(--agent-muted); font-size:12px; line-height:1.6; }
.agent-config-inspector { position:sticky; top:0; max-height:calc(100dvh - 100px); overflow:auto; }
.agent-config-snapshot { display:flex; gap:10px; align-items:flex-start; margin-top:18px; padding:13px 15px; border:1px solid var(--agent-border); border-radius:10px; color:var(--agent-muted); font-size:12px; line-height:1.5; background:var(--agent-subtle); }
.agent-config-snapshot svg { flex:none; margin-top:1px; color:var(--agent-primary); }
.agent-config-snapshot strong { color:var(--agent-text); }
@media (max-width: 1100px) { .agent-config-workflow { grid-template-columns:minmax(0,1fr); } .agent-config-inspector { position:static; max-height:none; } }
@media (max-width: 700px) { .agent-config-top { padding:16px; align-items:flex-start; flex-direction:column; gap:14px; } .agent-config-mode { padding:0; border:0; width:100%; } .agent-config-tabs > :is(.ant-tabs-nav,.kx-tabs-nav) { width:64px; padding:16px 7px; } .agent-config-tabs :is(.ant-tabs-tab,.kx-tabs-tab) { padding:12px !important; } .agent-config-tab { justify-content:center; } .agent-config-tab-copy { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; } .agent-config-pane { padding:23px 16px 30px; } .agent-config .agent-config-title { font-size:24px; } }
`;

/** Complete agent configuration UI driven by serializable configuration. */
export function AgentSettingsPanel({ config }: AgentSettingsPanelProps) {
  return (
    <AgentSettingsPanelContent
      key={JSON.stringify([config.apiBaseUrl, config.projectId, config.agentId])}
      config={config}
    />
  );
}

function AgentSettingsPanelContent({ config }: AgentSettingsPanelProps) {
  const { schema, projectId, apiBaseUrl, disabled = false } = config;
  const api = useMemo(
    () => new HttpAgentSettingsApi(apiBaseUrl, projectId, config.agentId),
    [apiBaseUrl, projectId, config.agentId],
  );
  const store = useAgentSettings(api, config.defaults);
  const definitions = useAgentDefinitions(api);
  const graph = new SettingsWorkflowGraph(config).build(
    store.settings ?? config.defaults,
    definitions.items,
  );
  const { mode: requestMode, change: onRequestModeChange } = useRequestMode();
  const { token } = theme.useToken();
  const [tab, setTab] = useState<Section>("workflow");
  const [selection, setSelection] = useState<WorkflowSelection>({ kind: "graph" });
  const [models, setModels] = useState<readonly OpenRouterModel[]>([]);
  useEffect(() => {
    let active = true;
    const api = new OpenRouterApi(apiBaseUrl);
    void api
      .status()
      .then((status) => (status.configured ? api.models() : []))
      .then((catalog) => {
        if (active) setModels(catalog);
      })
      .catch(() => {
        if (active) setModels([]);
      });
    return () => {
      active = false;
    };
  }, [apiBaseUrl]);
  const select = (next: WorkflowSelection) => {
    setSelection(
      next.kind === "step" && !schema.steps.some((step) => step.id === next.id)
        ? { kind: "graph" }
        : next,
    );
  };
  const colors = {
    "--agent-text": token.colorText,
    "--agent-muted": token.colorTextSecondary,
    "--agent-border-color": token.colorBorderSecondary,
    "--agent-bg": token.colorBgContainer,
    "--agent-subtle": token.colorFillQuaternary,
    "--agent-hover": token.colorFillTertiary,
    "--agent-selected": token.colorPrimaryBg,
    "--agent-primary": token.colorPrimary,
    "--agent-primary-bg": token.colorPrimaryBg,
  } as CSSProperties;
  const content: Record<Section, ReactNode> = {
    workflow: store.settings ? (
      <>
        <div className="agent-config-workflow">
          <div className="agent-config-card">
            <div className="agent-config-card-header">
              <div>
                <div className="agent-config-card-title">Workflow map</div>
                <div className="agent-config-card-subtitle">
                  Select a step or a path to configure it
                </div>
              </div>
              <span className="agent-config-card-indicator">Interactive</span>
            </div>
            <div className="agent-config-card-body">
              <WorkflowPanel
                graph={graph}
                selection={selection}
                onSelect={select}
                showDetails={false}
              />
              <div className="agent-config-graph-legend">
                Grey arrows show the normal path. Coloured lines return to or repeat a step; the
                number shows how many times. Dashed lines end the run when it reaches a limit or
                cannot make progress.
              </div>
            </div>
          </div>
          <div className="agent-config-card agent-config-inspector">
            <div className="agent-config-card-header">
              <div>
                <div className="agent-config-card-title">Configuration</div>
                <div className="agent-config-card-subtitle">Settings for your selection</div>
              </div>
            </div>
            <div className="agent-config-card-body">
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
        </div>
      </>
    ) : store.notice ? (
      <Alert type="error" title={store.notice.text} />
    ) : null,
    tests: <SettingsPanel store={store} section="tests" disabled={disabled} />,
    skills: <DefinitionsPanel api={api} store={definitions} kind="skill" disabled={disabled} />,
    guards: <DefinitionsPanel api={api} store={definitions} kind="guard" disabled={disabled} />,
    memory: <MemoryPanel api={api} disabled={disabled} />,
  };
  return (
    <SettingsSchemaContext.Provider value={schema}>
      <OpenRouterApiContext.Provider value={apiBaseUrl}>
        <OpenRouterModelsContext.Provider value={models}>
          <div className="agent-config" style={colors}>
            <style>{styles}</style>
            <div className="agent-config-top">
              <div className="agent-config-top-copy">
                <div className="agent-config-kicker">PROJECT WORKSPACE</div>
                <div className="agent-config-top-title">
                  <span className="agent-config-top-mark">
                    <SectionIcon section="workflow" />
                  </span>
                  Agent settings
                </div>
                <div className="agent-config-top-note">
                  Shape how your agent works on this project.
                </div>
              </div>
              {schema.modes.length > 0 && (
                <div className="agent-config-mode">
                  <div className="agent-config-mode-label">
                    <strong>Next message</strong>Choose how to start
                  </div>
                  <Select
                    aria-label="Request mode"
                    disabled={disabled}
                    style={{ width: 200, maxWidth: "100%" }}
                    value={requestMode}
                    options={[...schema.modes]}
                    onChange={onRequestModeChange}
                  />
                </div>
              )}
            </div>
            <div className="agent-config-main">
              <Tabs
                className="agent-config-tabs"
                tabPlacement="start"
                activeKey={tab}
                onChange={(key) => setTab(key as Section)}
                items={(Object.keys(sections) as Section[]).map((key) => ({
                  key,
                  label: (
                    <span className="agent-config-tab" title={sections[key].title}>
                      <span className="agent-config-tab-icon">
                        <SectionIcon section={key} />
                      </span>
                      <span className="agent-config-tab-copy">
                        <span className="agent-config-tab-title">{sections[key].title}</span>
                        <span className="agent-config-tab-detail" aria-hidden="true">
                          {sections[key].detail}
                        </span>
                      </span>
                    </span>
                  ),
                  children: (
                    <div className="agent-config-pane">
                      <SectionHeading section={key} />
                      <div className={key === "workflow" ? undefined : "agent-config-content"}>
                        {content[key]}
                      </div>
                      <div className="agent-config-snapshot">
                        <SectionIcon section="guards" />
                        <span>
                          <strong>Settings are saved per project.</strong> New runs use the latest
                          settings; a run keeps the settings, skills and guards it started with.
                        </span>
                      </div>
                    </div>
                  ),
                }))}
              />
            </div>
          </div>
        </OpenRouterModelsContext.Provider>
      </OpenRouterApiContext.Provider>
    </SettingsSchemaContext.Provider>
  );
}
