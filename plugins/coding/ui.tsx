import type { AgentConfigurationProps, AgentUiPlugin } from "@kushex/ui";
import { AgentSettingsHost, type AgentSettingsConfiguration } from "@kushex/workflow-ui";
import settings from "./ui/settings.json";

const config = settings as AgentSettingsConfiguration;

/** Coding supplies JSON; workflow-ui owns the complete configuration experience. */
export function CodingConfiguration(props: AgentConfigurationProps) {
  return <AgentSettingsHost {...props} config={config} />;
}
export default { id: "coding", agents: { coding: CodingConfiguration } } satisfies AgentUiPlugin;
