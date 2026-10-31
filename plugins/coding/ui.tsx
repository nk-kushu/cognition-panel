import {
  Alert,
  Collapse,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Tabs,
  Typography,
  Button,
} from "antd";
import type { AgentUiPlugin, AgentConfigurationProps } from "@kushex/ui";
import { codingEngineeringCatalog } from "./src/engineering/catalog";
import type { CodingEngineeringDefinition, SelectionMode } from "./src/engineering/types";

type Json = AgentConfigurationProps["value"][string];
type RecordValue = { readonly [key: string]: Json };
const record = (value: Json | undefined): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : {};
const modes: { value: SelectionMode; label: string }[] = [
  { value: "auto", label: "Automatic (DecisionUnit)" },
  { value: "required", label: "Required" },
  { value: "off", label: "Off" },
];

/** Browser-only settings; the backend independently validates and pins each run's configuration. */
export function CodingConfiguration({ value, onChange, disabled }: AgentConfigurationProps) {
  const engineering = record(value.engineering);
  const overrides = record(engineering.overrides);
  const update = (key: string, next: Json) =>
    onChange({ ...value, engineering: { ...engineering, [key]: next } });
  const override = (definition: CodingEngineeringDefinition, key: string, next: Json) => {
    const entry = { ...record(overrides[definition.id]), [key]: next };
    update("overrides", { ...overrides, [definition.id]: entry });
  };
  const entries = (skills: boolean) =>
    codingEngineeringCatalog
      .filter((definition) => !skills || !!definition.skillInstructions)
      .map((definition) => {
        const saved = record(overrides[definition.id]);
        const modeKey = skills ? "skillMode" : "guardMode";
        const instructionsKey = skills ? "skillInstructions" : "reviewInstructions";
        const instructions = saved[instructionsKey] ?? definition[instructionsKey];
        return {
          key: definition.id,
          label: definition.label,
          children: (
            <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
              <Typography.Paragraph>{definition.description}</Typography.Paragraph>
              <div>
                Selection
                <Select
                  aria-label={`${definition.label} ${skills ? "skill" : "guard"} selection`}
                  disabled={disabled}
                  style={{ display: "block", width: 280, maxWidth: "100%", marginTop: 6 }}
                  value={String(saved[modeKey] ?? definition[modeKey])}
                  options={modes}
                  onChange={(next) => override(definition, modeKey, next)}
                />
              </div>
              {!skills && (
                <Space>
                  <Switch
                    aria-label={`${definition.label} advisory`}
                    disabled={disabled}
                    checked={Boolean(saved.advisory ?? definition.advisory)}
                    onChange={(next) => override(definition, "advisory", next)}
                  />
                  Advisory findings (do not block completion)
                </Space>
              )}
              <label style={{ display: "block", width: "100%" }}>
                {skills
                  ? "Skill instructions sent to the planner and editor"
                  : "Reviewer instructions"}
                <Input.TextArea
                  aria-label={`${definition.label} ${skills ? "skill" : "reviewer"} instructions`}
                  disabled={disabled}
                  rows={12}
                  value={String(instructions)}
                  onChange={(event) => override(definition, instructionsKey, event.target.value)}
                />
              </label>
              <Button
                disabled={disabled}
                onClick={() => {
                  const next = { ...overrides };
                  delete next[definition.id];
                  update("overrides", next);
                }}
              >
                Reset {definition.label} defaults
              </Button>
            </Space>
          ),
        };
      });
  return (
    <div
      style={{
        maxWidth: 1100,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      <div>
        Model
        <Input
          aria-label="Coding model"
          placeholder="Server default"
          disabled={disabled}
          maxLength={128}
          value={typeof value.model === "string" ? value.model : ""}
          onChange={(event) => onChange({ ...value, model: event.target.value })}
        />
      </div>
      <Space wrap>
        <Switch
          aria-label="Enable skills and guards"
          disabled={disabled}
          checked={engineering.enabled !== false}
          onChange={(next) => update("enabled", next)}
        />
        Skills and guard review
        <label style={{ marginLeft: 16 }}>
          Maximum fix cycles{" "}
          <InputNumber
            aria-label="Maximum guard fix cycles"
            disabled={disabled}
            min={0}
            max={4}
            precision={0}
            value={typeof engineering.maxFixCycles === "number" ? engineering.maxFixCycles : 2}
            onChange={(next) => update("maxFixCycles", next ?? 2)}
          />
        </label>
      </Space>
      <Alert
        type="info"
        showIcon
        title="Settings apply to the next message."
        description="DecisionUnit selects skills before planning and optional guards after editing. Required selections always apply. Blocking findings return to the editor within the fix limit; incomplete blocking review stops the run. Command checks must be registered by the host; a reviewer does not execute ESLint or tests."
      />
      <Tabs
        items={[
          {
            key: "skills",
            label: `Skills (${entries(true).length})`,
            children: <Collapse items={entries(true)} />,
          },
          {
            key: "guards",
            label: `Guards (${codingEngineeringCatalog.length})`,
            children: <Collapse items={entries(false)} />,
          },
        ]}
      />
    </div>
  );
}

export default { id: "coding", agents: { coding: CodingConfiguration } } satisfies AgentUiPlugin;
