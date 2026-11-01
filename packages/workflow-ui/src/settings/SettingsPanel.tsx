import { useSettingsSchema } from "./SettingsSchemaContext";
import { Alert, Button, Input, Select, Space, Switch, Table, Typography } from "antd";
import { uncoveredTestTypes, type TestSuite } from "./types";
import { LimitField, ModelField } from "./settingsFields";
import type { AgentSettingsStore } from "./types";

/** Saved for the project; each run pins a snapshot when it starts. */
export function SettingsPanel({
  store,
  section,
  disabled,
}: Readonly<{
  store: AgentSettingsStore;
  section: "limits" | "models" | "tests";
  disabled: boolean;
}>) {
  const { limits: LIMITS, models: MODELS } = useSettingsSchema();
  const { settings, notice, update: setSettings, save } = store;
  if (!settings) return notice ? <Alert type="error" title={notice.text} /> : null;
  const suites = settings.testSuites;
  const setSuite = (index: number, change: Partial<TestSuite>) =>
    setSettings({
      ...settings,
      testSuites: suites.map((suite, at) => (at === index ? { ...suite, ...change } : suite)),
    });

  return (
    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      {section === "limits" && (
        <>
          <Typography.Paragraph>
            Returns count extra attempts after the first pass. A run stops and reports what is
            unresolved when a limit is reached.
          </Typography.Paragraph>
          {LIMITS.map(({ key }) => (
            <LimitField
              key={key}
              field={key}
              settings={settings}
              update={setSettings}
              disabled={disabled}
            />
          ))}
        </>
      )}
      {section === "models" &&
        MODELS.map(({ key }) => (
          <ModelField
            key={key}
            field={key}
            settings={settings}
            update={setSettings}
            disabled={disabled}
          />
        ))}
      {section === "tests" && (
        <>
          <div style={{ display: "block" }}>
            Test-writing prompt
            <Input.TextArea
              aria-label="Test-writing prompt"
              disabled={disabled}
              rows={4}
              maxLength={8000}
              value={settings.testWritingPrompt}
              onChange={(event) =>
                setSettings({ ...settings, testWritingPrompt: event.target.value })
              }
            />
          </div>
          <div style={{ display: "block" }}>
            Test types to write and run
            <Select
              aria-label="Test types"
              mode="tags"
              disabled={disabled}
              style={{ width: "100%" }}
              value={[...settings.testTypes]}
              onChange={(testTypes: string[]) => setSettings({ ...settings, testTypes })}
              options={[...new Set(suites.map((suite) => suite.type))].map((value) => ({ value }))}
            />
          </div>
          <Typography.Text type="secondary">
            Suites are the commands that run tests, in the isolated environment. A selected test
            type needs an enabled suite, otherwise verification is blocked.
          </Typography.Text>
          {uncoveredTestTypes(settings).length > 0 && (
            <Alert
              type="warning"
              showIcon
              title={`No enabled suite runs: ${uncoveredTestTypes(settings).join(", ")}.`}
            />
          )}
          <Table
            scroll={{ x: 600 }}
            size="small"
            pagination={false}
            rowKey="id"
            dataSource={[...suites]}
            columns={[
              {
                title: "Name",
                render: (_, suite, index) => (
                  <Input
                    aria-label="Suite name"
                    disabled={disabled}
                    value={suite.name}
                    onChange={(event) => setSuite(index, { name: event.target.value })}
                  />
                ),
              },
              {
                title: "Type",
                render: (_, suite, index) => (
                  <Input
                    aria-label="Suite type"
                    disabled={disabled}
                    value={suite.type}
                    onChange={(event) => setSuite(index, { type: event.target.value })}
                  />
                ),
              },
              {
                title: "Command",
                render: (_, suite, index) => (
                  <Input
                    aria-label="Suite command"
                    disabled={disabled}
                    value={[suite.command, ...suite.args].join(" ")}
                    onChange={(event) => {
                      const [command = "", ...args] = event.target.value.split(" ");
                      setSuite(index, { command, args });
                    }}
                  />
                ),
              },
              {
                title: "On",
                render: (_, suite, index) => (
                  <Switch
                    aria-label="Suite enabled"
                    disabled={disabled}
                    checked={suite.enabled}
                    onChange={(enabled) => setSuite(index, { enabled })}
                  />
                ),
              },
              {
                render: (_, suite) => (
                  <Button
                    disabled={disabled}
                    onClick={() =>
                      setSettings({
                        ...settings,
                        testSuites: suites.filter((item) => item.id !== suite.id),
                      })
                    }
                  >
                    Remove
                  </Button>
                ),
              },
            ]}
          />
          <Button
            disabled={disabled}
            onClick={() =>
              setSettings({
                ...settings,
                testSuites: [
                  ...suites,
                  {
                    id: crypto.randomUUID(),
                    type: "unit",
                    name: "Unit tests",
                    command: "npm",
                    args: ["test"],
                    workingDirectory: ".",
                    timeoutMs: 300_000,
                    enabled: true,
                  },
                ],
              })
            }
          >
            Add suite
          </Button>
        </>
      )}
      {notice && <Alert type={notice.type} showIcon title={notice.text} />}
      <Button type="primary" disabled={disabled} onClick={() => void save()}>
        Save
      </Button>
    </Space>
  );
}
