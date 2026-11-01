import type { AgentDefinition as AgentDefinitionDto } from "./types";
import {
  Alert,
  Button,
  Collapse,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from "antd";
import { useState } from "react";
import { useSettingsSchema } from "./SettingsSchemaContext";
import type { AgentSettingsApi } from "./types";
import { OpenRouterModelInput } from "../OpenRouter";
import type { AgentDefinitionsStore } from "./types";

type Kind = "skill" | "guard";
type Content = Record<string, unknown>;

const SELECTION = [
  { value: "automatic", label: "Automatic" },
  { value: "required", label: "Required" },
  { value: "off", label: "Off" },
];
const emptyCommand = {
  command: "npm",
  args: ["run", "lint", "--", "--max-warnings=0"],
  script: "",
  workingDirectory: ".",
  timeoutMs: 120_000,
  successExitCodes: [0],
};
/** Create, view, edit, enable and delete; saving adds a version and past runs keep theirs. */
export function DefinitionsPanel({
  api,
  store,
  kind,
  disabled,
}: Readonly<{
  api: AgentSettingsApi;
  store: AgentDefinitionsStore;
  kind: Kind;
  disabled: boolean;
}>) {
  const schema = useSettingsSchema();
  const { items, error, change } = store;
  const own = items.filter((item) => item.kind === kind);
  const others = own.map((item) => ({ value: item.id, label: String(item.content.name) }));
  return (
    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      {error && <Alert type="error" showIcon title={error} />}
      <Space wrap>
        <Button
          disabled={disabled}
          onClick={() => void change(() => api.createDefinition(kind, schema.newDefinitions[kind]))}
        >
          Add {kind}
        </Button>
      </Space>
      {own.length === 0 && (
        <Typography.Text type="secondary">None saved for this project.</Typography.Text>
      )}
      <Collapse
        items={own.map((item) => ({
          key: item.id,
          label: (
            <Space>
              {String(item.content.name)}
              <Tag>v{item.version}</Tag>
              {!item.enabled && <Tag>disabled</Tag>}
            </Space>
          ),
          extra: (
            <Popconfirm
              title={`Delete this ${kind}?`}
              description="Past runs keep the version they used."
              disabled={disabled}
              okText="Delete"
              cancelText="Cancel"
              onConfirm={(event) => {
                event?.stopPropagation();
                return change(() => api.deleteDefinition(item.id));
              }}
              onCancel={(event) => event?.stopPropagation()}
            >
              <Button
                danger
                size="small"
                disabled={disabled}
                aria-label={`Delete ${kind}: ${String(item.content.name)}`}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                Delete
              </Button>
            </Popconfirm>
          ),
          children: (
            <Editor
              key={item.versionId}
              item={item}
              others={others.filter((other) => other.value !== item.id)}
              disabled={disabled}
              onSave={(enabled, content) =>
                change(() => api.saveDefinition(item.id, enabled, content))
              }
            />
          ),
        }))}
      />
    </Space>
  );
}

function Editor({
  item,
  others,
  disabled,
  onSave,
}: Readonly<{
  item: AgentDefinitionDto;
  others: readonly { value: string; label: string }[];
  disabled: boolean;
  onSave: (enabled: boolean, content: Content) => Promise<void>;
}>) {
  const {
    skillPhases: PHASES,
    guardPhases: GUARD_PHASES,
    skillInputs: INPUTS,
  } = useSettingsSchema();
  const [content, setContent] = useState<Content>(item.content as Content);
  const [enabled, setEnabled] = useState(item.enabled);
  const set = (key: string, value: unknown) => setContent({ ...content, [key]: value });
  const text = (key: string, label: string, rows = 1) => (
    <div style={{ display: "block" }}>
      {label}
      <Input.TextArea
        aria-label={label}
        disabled={disabled}
        rows={rows}
        value={String(content[key] ?? "")}
        onChange={(event) => set(key, event.target.value)}
      />
    </div>
  );
  const model = (label: string) => (
    <div style={{ display: "block" }}>
      {label}
      <OpenRouterModelInput
        label={label}
        disabled={disabled}
        placeholder="Inherit"
        value={String(content.model ?? "")}
        onChange={(value) => set("model", value)}
      />
    </div>
  );
  const check = (content.check ?? null) as typeof emptyCommand | null;
  const setCheck = (change: Partial<typeof emptyCommand>) =>
    set("check", { ...(check ?? emptyCommand), ...change });
  const type = String(content.type ?? "");
  return (
    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      <Space>
        <Switch aria-label="Enabled" disabled={disabled} checked={enabled} onChange={setEnabled} />
        Enabled
      </Space>
      {text("name", "Name")}
      {text("purpose", "Purpose", 2)}
      <div style={{ display: "block" }}>
        Selection
        <Select
          aria-label="Selection"
          disabled={disabled}
          style={{ display: "block", width: 240 }}
          value={String(content.selection)}
          options={SELECTION}
          onChange={(value) => set("selection", value)}
        />
      </div>
      {item.kind === "skill" ? (
        <>
          {text("instructions", "Instructions", 10)}
          <div style={{ display: "block" }}>
            Phases
            <Select
              aria-label="Phases"
              mode="multiple"
              disabled={disabled}
              style={{ width: "100%" }}
              value={content.phases as string[]}
              options={[...PHASES]}
              onChange={(value) => set("phases", value)}
            />
          </div>
          <div style={{ display: "block" }}>
            Runs after
            <Select
              aria-label="Dependencies"
              mode="multiple"
              disabled={disabled}
              style={{ width: "100%" }}
              value={content.dependencies as string[]}
              options={[...others]}
              onChange={(value) => set("dependencies", value)}
            />
          </div>
          <div style={{ display: "block" }}>
            Needs before it can run
            <Select
              aria-label="Required inputs"
              mode="multiple"
              disabled={disabled}
              style={{ width: "100%" }}
              value={(content.requiredInputs ?? []) as string[]}
              options={[...INPUTS]}
              onChange={(value) => set("requiredInputs", value)}
            />
          </div>
          {text(
            "expectedResult",
            "Expected result (empty: short guidance sent with assignments)",
            2,
          )}
          {model("Model (empty: the run's default model)")}
        </>
      ) : (
        <>
          <div style={{ display: "block" }}>
            Runs on
            <Select
              aria-label="Guard phases"
              mode="multiple"
              disabled={disabled}
              style={{ width: "100%" }}
              value={(content.phases ?? ["guards"]) as string[]}
              options={[...GUARD_PHASES]}
              onChange={(value) => set("phases", value)}
            />
          </div>
          <div style={{ display: "block" }}>
            Type
            <Select
              aria-label="Guard type"
              disabled={disabled}
              style={{ display: "block", width: 240 }}
              value={type}
              options={[
                { value: "deterministic", label: "Deterministic code" },
                { value: "llm", label: "LLM review" },
                { value: "combined", label: "Both" },
              ]}
              onChange={(value) =>
                setContent({
                  ...content,
                  type: value,
                  check: value === "llm" ? null : (check ?? emptyCommand),
                })
              }
            />
          </div>
          <Space>
            <Switch
              aria-label="Blocking"
              disabled={disabled}
              checked={Boolean(content.blocking)}
              onChange={(value) => set("blocking", value)}
            />
            Findings block completion
          </Space>
          {type !== "llm" && (
            <>
              <div style={{ display: "block" }}>
                Command and arguments
                <Input
                  aria-label="Guard command"
                  disabled={disabled}
                  value={[check?.command ?? "", ...(check?.args ?? [])].join(" ").trim()}
                  onChange={(event) => {
                    const [command = "", ...args] = event.target.value.split(" ");
                    setCheck({ command, args });
                  }}
                />
              </div>
              <div style={{ display: "block" }}>
                Or a script
                <Input.TextArea
                  aria-label="Guard script"
                  disabled={disabled}
                  rows={3}
                  value={check?.script ?? ""}
                  onChange={(event) => setCheck({ script: event.target.value })}
                />
              </div>
              <div style={{ display: "block" }}>
                Working directory
                <Input
                  aria-label="Guard working directory"
                  disabled={disabled}
                  value={check?.workingDirectory ?? "."}
                  onChange={(event) => setCheck({ workingDirectory: event.target.value })}
                />
              </div>
              <div>
                Timeout (seconds){" "}
                <InputNumber
                  aria-label="Guard timeout"
                  disabled={disabled}
                  min={1}
                  max={3600}
                  value={(check?.timeoutMs ?? 120_000) / 1000}
                  onChange={(value) => setCheck({ timeoutMs: (value ?? 120) * 1000 })}
                />
              </div>
              <div style={{ display: "block" }}>
                Success exit codes
                <Input
                  aria-label="Guard success exit codes"
                  disabled={disabled}
                  value={(check?.successExitCodes ?? [0]).join(", ")}
                  onChange={(event) =>
                    setCheck({
                      successExitCodes: event.target.value
                        .split(",")
                        .map((code) => Number(code.trim()))
                        .filter((code) => Number.isInteger(code)),
                    })
                  }
                />
              </div>
            </>
          )}
          {type !== "deterministic" && (
            <>
              {text("reviewInstructions", "Review instructions", 10)}
              {model("Model (empty: the run's guard model)")}
            </>
          )}
        </>
      )}
      <Space>
        <Button type="primary" disabled={disabled} onClick={() => void onSave(enabled, content)}>
          Save
        </Button>
      </Space>
    </Space>
  );
}
