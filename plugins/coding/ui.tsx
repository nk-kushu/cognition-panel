import { useMemo } from "react";
import type { AgentConfigurationProps, AgentUiPlugin } from "@kushex/ui";
import { AgentSettingsPanel, useAgentDefinitions, useAgentSettings } from "@kushex/workflow-ui";
import { defaultCodingSettings, type CodingSettings } from "./src/engineering/types";
import { CodingApi } from "./ui/api";
import { codingWorkflowGraph } from "./ui/codingWorkflowGraph";
import { codingSettingsSchema } from "./ui/settingsSchema";

/** Coding contributes data and persistence; Cognition Panel renders the complete settings panel. */
export function CodingConfiguration({
  value,
  onChange,
  disabled,
  projectId,
  apiBaseUrl,
}: AgentConfigurationProps) {
  const api = useMemo(() => new CodingApi(apiBaseUrl, projectId), [apiBaseUrl, projectId]);
  const store = useAgentSettings(api, defaultCodingSettings);
  const definitions = useAgentDefinitions(api);
  const settings = (store.settings ?? defaultCodingSettings) as CodingSettings;
  return (
    <AgentSettingsPanel
      schema={codingSettingsSchema}
      graph={codingWorkflowGraph(settings, definitions.items)}
      api={api}
      store={store}
      definitions={definitions}
      disabled={disabled}
      apiBaseUrl={apiBaseUrl}
      requestMode={typeof value.mode === "string" ? value.mode : ""}
      onRequestModeChange={(mode) => onChange({ ...value, mode })}
    />
  );
}
export default { id: "coding", agents: { coding: CodingConfiguration } } satisfies AgentUiPlugin;
