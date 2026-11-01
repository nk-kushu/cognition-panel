import type { ProjectMemory as ProjectMemoryDto } from "./types";
import { Alert, Button, Input, List, Popconfirm, Space, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import type { AgentSettingsApi } from "./types";

/** The selected project's preferences. Other projects never see them. */
export function MemoryPanel({
  api,
  disabled,
}: Readonly<{ api: AgentSettingsApi; disabled: boolean }>) {
  const [items, setItems] = useState<readonly ProjectMemoryDto[]>([]);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError((failure as Error).message);
    }
  }, []);
  const reload = useCallback(() => run(async () => setItems(await api.memory())), [api, run]);
  useEffect(() => {
    void api.memory().then(setItems, (failure: Error) => setError(failure.message));
  }, [api]);
  return (
    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      <Typography.Text type="secondary">
        Remembered for this project only. A preference guides the agent; tool checks, such as asking
        before adding a dependency, are enforced separately.
      </Typography.Text>
      {error && <Alert type="error" showIcon title={error} />}
      <Space.Compact style={{ width: "100%" }}>
        <Input
          aria-label="New memory"
          placeholder="Prefer maintained npm packages."
          disabled={disabled}
          maxLength={1000}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button
          disabled={disabled || !draft.trim()}
          onClick={() =>
            void run(async () => {
              await api.addMemory(draft.trim());
              setDraft("");
            }).then(reload)
          }
        >
          Add
        </Button>
      </Space.Compact>
      <List
        dataSource={[...items]}
        locale={{ emptyText: "Nothing remembered yet." }}
        renderItem={(item) => {
          const draftEdit = editing?.id === item.id ? editing : null;
          return (
            <List.Item
              actions={[
                <Button
                  key="edit"
                  size="small"
                  disabled={disabled}
                  onClick={() => setEditing({ id: item.id, text: item.statement })}
                >
                  Edit
                </Button>,
                <Popconfirm
                  key="delete"
                  title="Forget this?"
                  onConfirm={() => void run(() => api.deleteMemory(item.id)).then(reload)}
                >
                  <Button size="small" danger disabled={disabled}>
                    Delete
                  </Button>
                </Popconfirm>,
              ]}
            >
              {draftEdit ? (
                <Space.Compact style={{ width: "100%" }}>
                  <Input
                    aria-label="Edit memory"
                    disabled={disabled}
                    maxLength={1000}
                    value={draftEdit.text}
                    onChange={(event) => setEditing({ ...draftEdit, text: event.target.value })}
                  />
                  <Button
                    disabled={disabled || !draftEdit.text.trim()}
                    onClick={() =>
                      void run(async () => {
                        await api.updateMemory(item.id, draftEdit.text.trim());
                        setEditing(null);
                      }).then(reload)
                    }
                  >
                    Save
                  </Button>
                </Space.Compact>
              ) : (
                item.statement
              )}
            </List.Item>
          );
        }}
      />
    </Space>
  );
}
