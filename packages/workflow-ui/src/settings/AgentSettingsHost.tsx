import { AgentSettingsPanel } from "./AgentSettingsPanel";
import type { AgentSettingsConfiguration, JsonValue } from "./types";

import { RequestModeContext } from "./RequestModeContext";

/** Bridges the host application's event contract; the panel itself receives only JSON. */
export function AgentSettingsHost({
  config,
  projectId,
  apiBaseUrl,
  disabled,
  value,
  onChange,
}: Readonly<{
  config: AgentSettingsConfiguration;
  projectId: string;
  apiBaseUrl: string;
  disabled: boolean;
  value: Readonly<Record<string, JsonValue>>;
  onChange(value: Record<string, JsonValue>): void;
}>) {
  return (
    <RequestModeContext.Provider
      value={{
        mode: typeof value.mode === "string" ? value.mode : "",
        change: (mode) => onChange({ ...value, mode }),
      }}
    >
      <AgentSettingsPanel config={{ ...config, projectId, apiBaseUrl, disabled }} />
    </RequestModeContext.Provider>
  );
}
