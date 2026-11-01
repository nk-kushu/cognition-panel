import { Alert, Button, Modal } from "antd";
import { IconSettings } from "@tabler/icons-react";
import { Component, createContext, useContext, useState, type ReactNode } from "react";
import type { AgentSummaryDto } from "@kushex/contracts";
import type { AgentConfigurationProps, AgentUiPlugin } from "../../types";

export const AgentUiPluginsContext = createContext<readonly AgentUiPlugin[]>([]);
export const AgentApiContext = createContext({ apiBaseUrl: "/api" });

/** Resolves both owner and agent ID so unrelated plugins cannot claim an agent's panel. */
export function AgentConfigurationPanel({
  agent,
  ...props
}: Omit<AgentConfigurationProps, "agentName" | "apiBaseUrl"> & { agent: AgentSummaryDto }) {
  const [open, setOpen] = useState(false);
  const plugins = useContext(AgentUiPluginsContext);
  const { apiBaseUrl } = useContext(AgentApiContext);
  const Configuration = plugins.find((plugin) => plugin.id === agent.plugin?.id)?.agents[
    agent.name
  ];
  if (!Configuration) return null;
  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        type="text"
        size="small"
        aria-label="Configure agent"
        title="Configure agent"
        icon={<IconSettings size={16} />}
      >
        Configure
      </Button>
      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        title={`${agent.displayName ?? agent.name} settings`}
        footer={null}
        width="100vw"
        style={{ top: 0, maxWidth: "100vw", margin: 0, paddingBottom: 0 }}
        styles={{
          container: {
            height: "100dvh",
            borderRadius: 0,
            display: "flex",
            flexDirection: "column",
          },
          body: { flex: 1, minHeight: 0, overflow: "auto" },
        }}
      >
        <ConfigurationBoundary>
          <Configuration {...props} agentName={agent.name} apiBaseUrl={apiBaseUrl} />
        </ConfigurationBoundary>
      </Modal>
    </>
  );
}

class ConfigurationBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? (
      <Alert type="error" title="Agent settings could not be displayed." />
    ) : (
      this.props.children
    );
  }
}
