import { Alert, AutoComplete, Button, Space, Typography } from "antd";
import { createContext, useContext, useEffect, useState } from "react";
import { OpenRouterApi } from "./OpenRouterApi";
import type { OpenRouterModel } from "./OpenRouterApi";
export type { OpenRouterModel } from "./OpenRouterApi";

export const OpenRouterApiContext = createContext("/api");
export const OpenRouterModelsContext = createContext<readonly OpenRouterModel[]>([]);

/** Loads the account's catalog; credentials are managed in Cognition Panel Settings. */
export function OpenRouterPanel({
  disabled,
  onModels,
}: {
  disabled: boolean;
  onModels(models: readonly OpenRouterModel[]): void;
}) {
  const base = useContext(OpenRouterApiContext);
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  async function catalog() {
    const api = new OpenRouterApi(base);
    const status = await api.status();
    return status.configured ? api.models() : null;
  }
  function loaded(models: OpenRouterModel[] | null) {
    setConfigured(models !== null);
    onModels(models ?? []);
    setError(null);
    setBusy(false);
  }
  function failed(failure: Error) {
    setError(failure.message);
    setBusy(false);
  }
  useEffect(() => {
    let active = true;
    void catalog().then(
      (models) => {
        if (active) loaded(models);
      },
      (failure: Error) => {
        if (active) failed(failure);
      },
    );
    return () => {
      active = false;
    };
    // The API base owns the lifetime of the catalog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);
  return (
    <Space orientation="vertical" style={{ width: "100%" }}>
      <Typography.Paragraph>
        Set up your API key in Cognition Panel Settings → OpenRouter. Then choose an OpenRouter model below
        or enter a Codex model name.
      </Typography.Paragraph>
      <Button
        disabled={disabled || busy}
        loading={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void catalog().then(loaded, failed);
        }}
      >
        Refresh models
      </Button>
      {!busy && !configured && !error && (
        <Alert
          type="info"
          title="No OpenRouter key saved. Open Settings → OpenRouter to connect your account."
        />
      )}
      {error && <Alert type="error" title={error} />}
    </Space>
  );
}

export function OpenRouterModelInput({
  value,
  onChange,
  disabled,
  label,
  placeholder,
}: {
  value: string;
  onChange(value: string): void;
  disabled: boolean;
  label: string;
  placeholder: string;
}) {
  const models = useContext(OpenRouterModelsContext);
  return (
    <AutoComplete
      aria-label={label}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      style={{ width: "100%" }}
      onChange={onChange}
      maxLength={256}
      options={models.map((model) => ({
        value: `openrouter:${model.id}`,
        label: `${model.name} (${model.contextTokens.toLocaleString()} context)`,
      }))}
      filterOption={(input, option) =>
        `${option?.value} ${option?.label}`.toLowerCase().includes(input.toLowerCase())
      }
    />
  );
}
