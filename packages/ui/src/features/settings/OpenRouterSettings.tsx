import { Alert, Button, Form, Input, Space, Typography } from "antd";
import { useState } from "react";
import {
  useOpenRouterStatusQuery,
  useSaveOpenRouterKeyMutation,
  useRemoveOpenRouterKeyMutation,
  useLazyOpenRouterModelsQuery,
} from "../../shared/api/kushexApi";

/** Account-level provider setup, independent of projects and agent plugins. */
export function OpenRouterSettings() {
  const status = useOpenRouterStatusQuery();
  const [save, saving] = useSaveOpenRouterKeyMutation();
  const [remove, removing] = useRemoveOpenRouterKeyMutation();
  const [check, checking] = useLazyOpenRouterModelsQuery();
  const [apiKey, setApiKey] = useState("");
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const busy = saving.isLoading || removing.isLoading || checking.isFetching;
  const message = (error: unknown) => {
    const data = (error as { data?: { message?: string } })?.data;
    return data?.message ?? "Could not reach OpenRouter. Try again.";
  };
  async function saveKey() {
    setNotice(null);
    try {
      await save(apiKey.trim()).unwrap();
      setApiKey("");
      setNotice({
        type: "success",
        text: "API key saved securely. You can now test the connection and choose models in your coding agent.",
      });
    } catch (error) {
      setNotice({ type: "error", text: message(error) });
    } finally {
      saving.reset();
    }
  }
  async function removeKey() {
    setNotice(null);
    try {
      await remove().unwrap();
      setApiKey("");
      checking.reset();
      setNotice({ type: "success", text: "API key removed." });
    } catch (error) {
      setNotice({ type: "error", text: message(error) });
    } finally {
      removing.reset();
    }
  }
  async function testConnection() {
    setNotice(null);
    try {
      const models = await check().unwrap();
      setNotice({
        type: "success",
        text: `Connected to OpenRouter. ${models.length} text models available.`,
      });
    } catch (error) {
      setNotice({ type: "error", text: message(error) });
    }
  }
  return (
    <Space orientation="vertical" style={{ width: "100%" }}>
      <Typography.Paragraph>
        Connect OpenRouter to use its models in the coding agent. This API key belongs to your
        Cognition Panel user and is shared across projects.{" "}
        <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">
          Get an API key
        </a>
      </Typography.Paragraph>
      {status.error ? (
        <Alert
          type="error"
          title="Could not load OpenRouter settings."
          action={<Button onClick={() => void status.refetch()}>Retry</Button>}
        />
      ) : (
        <Typography.Text>
          {status.isLoading
            ? "Loading connection…"
            : status.data?.configured
              ? "API key saved (encrypted)."
              : "No API key saved."}
        </Typography.Text>
      )}
      <Form.Item
        label="OpenRouter API key"
        htmlFor="openrouter-api-key"
        extra="Stored encrypted in the database. Your saved key is never displayed."
      >
        <Input.Password
          id="openrouter-api-key"
          autoComplete="new-password"
          value={apiKey}
          disabled={busy || status.isLoading || !!status.error}
          placeholder={
            status.data?.configured ? "Enter a replacement key" : "Enter your OpenRouter API key"
          }
          onChange={(event) => setApiKey(event.target.value)}
          onPressEnter={() => {
            if (apiKey.trim() && !busy) void saveKey();
          }}
        />
      </Form.Item>
      <Space wrap>
        <Button
          type="primary"
          loading={saving.isLoading}
          disabled={busy || !apiKey.trim() || !status.data}
          onClick={() => void saveKey()}
        >
          Save API key
        </Button>
        <Button
          disabled={busy || !status.data?.configured}
          loading={checking.isFetching}
          onClick={() => void testConnection()}
        >
          Test connection
        </Button>
        <Button danger disabled={busy || !status.data?.configured} onClick={() => void removeKey()}>
          Remove API key
        </Button>
      </Space>
      {notice && <Alert showIcon type={notice.type} title={notice.text} />}
      <Typography.Paragraph type="secondary">
        After setup, open a project’s coding agent and choose Configure → Models to select a default
        model or models for individual roles.{" "}
        <a href="https://openrouter.ai/models" target="_blank" rel="noreferrer">
          Browse models
        </a>
      </Typography.Paragraph>
    </Space>
  );
}
