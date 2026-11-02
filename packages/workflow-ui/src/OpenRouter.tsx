import { Alert, Select, Button, Space, Typography } from "antd";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { OpenRouterApi } from "./OpenRouterApi";
import type { OpenRouterModel } from "./OpenRouterApi";
export type { OpenRouterModel } from "./OpenRouterApi";

export const OpenRouterApiContext = createContext("/api");
export const OpenRouterModelsContext = createContext<readonly OpenRouterModel[]>([]);

type CatalogState = Readonly<{ loading: boolean; configured: boolean; error: string | null }>;
const CatalogContext = createContext<CatalogState & { retry(): void }>({
  loading: false,
  configured: true,
  error: null,
  retry: () => {},
});

/** One account catalog shared by every step, skill and guard model selector. */
export function OpenRouterCatalogProvider({ children }: { children: ReactNode }) {
  const base = useContext(OpenRouterApiContext);
  const [models, setModels] = useState<readonly OpenRouterModel[]>([]);
  const [state, setState] = useState<CatalogState>({
    loading: true,
    configured: false,
    error: null,
  });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const api = new OpenRouterApi(base);
    void api
      .status(controller.signal)
      .then(async (status) => ({
        configured: status.configured,
        models: status.configured ? await api.models("", controller.signal) : [],
      }))
      .then((catalog) => {
        if (controller.signal.aborted) return;
        setModels(catalog.models);
        setState({ loading: false, configured: catalog.configured, error: null });
      })
      .catch((error: Error) => {
        if (controller.signal.aborted) return;
        setModels([]);
        setState({ loading: false, configured: false, error: error.message });
      });
    return () => controller.abort();
  }, [base, revision]);
  return (
    <CatalogContext.Provider
      value={{
        ...state,
        retry: () => {
          setState({ loading: true, configured: false, error: null });
          setRevision((current) => current + 1);
        },
      }}
    >
      <OpenRouterModelsContext.Provider value={models}>{children}</OpenRouterModelsContext.Provider>
    </CatalogContext.Provider>
  );
}

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
        Set up your API key in Cognition Panel Settings → OpenRouter. Then choose an OpenRouter
        model below or enter a Codex model name.
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
  const catalog = useContext(CatalogContext);
  const options = models.map((model) => ({
    value: `openrouter:${model.id}`,
    label: `${model.name} (${model.id}, ${model.contextTokens.toLocaleString()} context)`,
  }));
  // Preserve an existing Codex selection or a model absent from the current catalog.
  if (value && !options.some((option) => option.value === value)) {
    options.unshift({ value, label: `${value} (current)` });
  }
  return (
    <Space orientation="vertical" size={4} style={{ width: "100%" }}>
      <Select<string>
        aria-label={label}
        value={value || undefined}
        disabled={disabled}
        loading={catalog.loading}
        allowClear
        placeholder={`${placeholder} · search OpenRouter models`}
        style={{ width: "100%" }}
        onChange={(selected) => onChange(selected ?? "")}
        options={options}
        showSearch={{
          filterOption: (input, option) =>
            `${option?.value} ${option?.label}`.toLowerCase().includes(input.trim().toLowerCase()),
        }}
        notFoundContent={
          catalog.loading ? "Loading OpenRouter models…" : "No matching OpenRouter models"
        }
      />
      {catalog.error ? (
        <div role="alert">
          <Typography.Text type="danger">{catalog.error}</Typography.Text>{" "}
          <Button type="link" size="small" disabled={disabled} onClick={catalog.retry}>
            Retry models
          </Button>
        </div>
      ) : !catalog.loading && !catalog.configured ? (
        <Typography.Text type="secondary">
          Connect your API key in Settings → OpenRouter to choose a model.
        </Typography.Text>
      ) : null}
    </Space>
  );
}
