import type {
  AgentDefinition as AgentDefinitionDto,
  AgentSettings,
  ConfigurableStep as WorkflowStep,
  AgentSettingsApi,
  AgentSettingsStore,
  AgentDefinitionsStore,
} from "./types";
import { uncoveredTestTypes } from "./types";
import { Alert, Button, Checkbox, Input, Space, Tag, Typography } from "antd";
import type { ReactNode } from "react";
import type { WorkflowSelection } from "../types";
import { useSettingsSchema } from "./SettingsSchemaContext";
import { LimitField, ModelField } from "./settingsFields";
export type ConfigurationTab = "tests" | "skills" | "guards";

type InspectorProps = Readonly<{
  api: AgentSettingsApi;
  settings: AgentSettings;
  store: AgentSettingsStore;
  definitions: AgentDefinitionsStore;
  selection: WorkflowSelection;
  disabled: boolean;
  onSelect: (selection: WorkflowSelection) => void;
  onOpenTab: (tab: ConfigurationTab) => void;
}>;

const Section = ({ title, children }: Readonly<{ title: string; children: ReactNode }>) => (
  <Space orientation="vertical" size="small" style={{ width: "100%" }}>
    <Typography.Text strong>{title}</Typography.Text>
    {children}
  </Space>
);

const contentOf = (item: AgentDefinitionDto) => item.content as Record<string, unknown>;

/** Choosing a skill for a phase saves a new version straight away, like the Skills tab's Save. */
function PhaseSkills({
  api,
  phase,
  store,
  disabled,
  onOpenTab,
}: Readonly<{
  api: AgentSettingsApi;
  phase: string;
  store: AgentDefinitionsStore;
  disabled: boolean;
  onOpenTab: InspectorProps["onOpenTab"];
}>) {
  const skills = store.items.filter((item) => item.kind === "skill");
  return (
    <Section title="Skills in this step">
      {skills.length === 0 && (
        <Typography.Text type="secondary">None saved for this project.</Typography.Text>
      )}
      {skills.map((skill) => {
        const content = contentOf(skill);
        const phases = (content.phases ?? []) as readonly string[];
        return (
          <Checkbox
            key={skill.id}
            disabled={disabled}
            checked={phases.includes(phase)}
            onChange={({ target }) =>
              void store.change(() =>
                api.saveDefinition(skill.id, skill.enabled, {
                  ...content,
                  phases: target.checked
                    ? [...phases, phase]
                    : phases.filter((item) => item !== phase),
                }),
              )
            }
          >
            {String(content.name)}
            {!skill.enabled && <Tag style={{ marginLeft: 6 }}>disabled</Tag>}
            {content.selection === "off" && <Tag style={{ marginLeft: 6 }}>off</Tag>}
          </Checkbox>
        );
      })}
      <Typography.Link onClick={() => onOpenTab("skills")}>Manage skills</Typography.Link>
    </Section>
  );
}

/** Which guards check this point in the run; like skills, a change saves a new version. */
function PhaseGuards({
  api,
  phase,
  store,
  disabled,
  onOpenTab,
}: Readonly<{
  api: AgentSettingsApi;
  phase: string;
  store: AgentDefinitionsStore;
  disabled: boolean;
  onOpenTab: InspectorProps["onOpenTab"];
}>) {
  const guards = store.items.filter((item) => item.kind === "guard");
  return (
    <Section title="Guards in this step">
      {guards.length === 0 && (
        <Typography.Text type="secondary">None saved for this project.</Typography.Text>
      )}
      {guards.map((guard) => {
        const content = contentOf(guard);
        const phases = (content.phases ?? ["guards"]) as readonly string[];
        return (
          <Checkbox
            key={guard.id}
            disabled={disabled}
            checked={phases.includes(phase)}
            onChange={({ target }) =>
              void store.change(() =>
                api.saveDefinition(guard.id, guard.enabled, {
                  ...content,
                  phases: target.checked
                    ? [...phases, phase]
                    : phases.filter((item) => item !== phase),
                }),
              )
            }
          >
            {String(content.name)}
            {!guard.enabled && <Tag style={{ marginLeft: 6 }}>disabled</Tag>}
            {content.selection === "off" && <Tag style={{ marginLeft: 6 }}>off</Tag>}
          </Checkbox>
        );
      })}
      <Typography.Link onClick={() => onOpenTab("guards")}>Manage guards</Typography.Link>
    </Section>
  );
}

function StepDetails({
  step,
  api,
  settings,
  store,
  definitions,
  disabled,
  onSelect,
  onOpenTab,
}: Readonly<{ step: WorkflowStep }> & InspectorProps) {
  const schema = useSettingsSchema();
  const fieldProps = { settings, update: store.update, disabled };
  return (
    <>
      <Typography.Title level={5} style={{ margin: 0 }}>
        {step.title}
      </Typography.Title>
      <Typography.Text type="secondary">{step.summary}</Typography.Text>
      <Space wrap size={4}>
        {step.laneLabel && <Tag>{step.laneLabel}</Tag>}
        {step.pauses && <Tag>Can wait for you</Tag>}
      </Space>
      {step.limits.length > 0 && (
        <Section title="Limits">
          {step.limits.map((limit) => (
            <LimitField key={limit} field={limit} {...fieldProps} />
          ))}
        </Section>
      )}
      {step.models.length > 0 && (
        <Section title="Models">
          {step.models.map((model) => (
            <ModelField key={model} field={model} {...fieldProps} />
          ))}
        </Section>
      )}
      {step.skillPhase && (
        <PhaseSkills
          api={api}
          phase={step.skillPhase}
          store={definitions}
          disabled={disabled}
          onOpenTab={onOpenTab}
        />
      )}
      {step.guardPhase && (
        <PhaseGuards
          api={api}
          phase={step.guardPhase}
          store={definitions}
          disabled={disabled}
          onOpenTab={onOpenTab}
        />
      )}
      {step.guidance && (
        <Section title={step.guidance.title}>
          <Typography.Text type="secondary">{step.guidance.text}</Typography.Text>
        </Section>
      )}
      {step.showTestPrompt && (
        <div style={{ display: "block" }}>
          Test-writing prompt
          <Input.TextArea
            aria-label="Test-writing prompt"
            disabled={disabled}
            rows={4}
            maxLength={8000}
            value={settings.testWritingPrompt}
            onChange={(event) =>
              store.update({ ...settings, testWritingPrompt: event.target.value })
            }
          />
        </div>
      )}
      {step.showTests && (
        <Section title="Tests">
          <Typography.Text type="secondary">
            {settings.testTypes.length === 0
              ? "No test types selected, so a run writes tests but does not run any."
              : `Selected: ${settings.testTypes.join(", ")}.`}
          </Typography.Text>
          {uncoveredTestTypes(settings).length > 0 && (
            <Alert
              type="warning"
              showIcon
              title={`No enabled suite runs: ${uncoveredTestTypes(settings).join(", ")}. ${schema.verificationBlockedMessage ?? "A run will stop."}`}
            />
          )}
          <Typography.Link onClick={() => onOpenTab("tests")}>Manage tests</Typography.Link>
        </Section>
      )}
      {step.returns.length > 0 && (
        <Section title="Can send a run back through">
          <Space wrap size={4}>
            {step.returns.map((route) => (
              <Button
                key={route}
                size="small"
                onClick={() => onSelect({ kind: "control", id: route })}
              >
                {schema.routes[route]?.label ?? route}
              </Button>
            ))}
          </Space>
        </Section>
      )}
    </>
  );
}

/** Everything that controls the selected part of the workflow, and nothing else. */
export function WorkflowInspector(props: InspectorProps) {
  const { settings, store, definitions, selection, disabled, onSelect } = props;
  const schema = useSettingsSchema();
  const STEPS = schema.steps;
  const RUN_LIMITS = schema.overviewLimits;
  const route = selection.kind === "control" ? schema.routes[selection.id] : undefined;
  const fieldProps = { settings, update: store.update, disabled };
  const step = selection.kind === "step" && STEPS.find(({ id }) => id === selection.id);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {selection.kind === "graph" && (
        <>
          <Typography.Title level={5} style={{ margin: 0 }}>
            Whole run
          </Typography.Title>
          <Typography.Text type="secondary">
            Select a step or a coloured return path to see what controls it. These limits apply to
            the run as a whole; a run stops and reports what is unresolved when one is reached.
          </Typography.Text>
          {RUN_LIMITS.map((limit) => (
            <LimitField key={limit} field={limit} {...fieldProps} />
          ))}
        </>
      )}
      {selection.kind === "control" && route && (
        <>
          <Typography.Title level={5} style={{ margin: 0 }}>
            {route.label}
          </Typography.Title>
          <Typography.Text type="secondary">{route.summary}</Typography.Text>
          <LimitField field={route.limit} {...fieldProps} />
          <Typography.Text type="secondary">
            Each return also counts toward the{" "}
            {schema.totalReturnsKey ? settings.limits[schema.totalReturnsKey] : "the configured"}{" "}
            total returns per run.
          </Typography.Text>
          <Section title="Returns to">
            <Button size="small" onClick={() => onSelect({ kind: "step", id: route.target })}>
              {STEPS.find(({ id }) => id === route.target)?.title ?? route.target}
            </Button>
          </Section>
          <Section title="Comes from">
            <Space wrap size={4}>
              {STEPS.filter(({ returns }) => returns.includes(selection.id)).map(
                ({ id, title }) => (
                  <Button key={id} size="small" onClick={() => onSelect({ kind: "step", id })}>
                    {title}
                  </Button>
                ),
              )}
            </Space>
          </Section>
        </>
      )}
      {step && <StepDetails step={step} {...props} />}
      {definitions.error && <Alert type="error" showIcon title={definitions.error} />}
      {store.notice && <Alert type={store.notice.type} showIcon title={store.notice.text} />}
      <Space>
        <Button type="primary" disabled={disabled} onClick={() => void store.save()}>
          Save
        </Button>
        {store.dirty && <Typography.Text type="secondary">Unsaved changes</Typography.Text>}
      </Space>
    </div>
  );
}
