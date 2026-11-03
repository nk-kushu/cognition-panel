import type { ComponentType, CSSProperties, ReactElement } from "react";

export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type AgentConfiguration = Readonly<Record<string, JsonValue>>;
export type AgentConfigurationProps = Readonly<{
  agentName: string;
  workspaceId?: string;
  projectId: string;
  apiBaseUrl: string;
  value: AgentConfiguration;
  onChange: (value: AgentConfiguration) => void;
  disabled: boolean;
}>;
export type AgentUiPlugin = Readonly<{
  id: string;
  agents: Readonly<Record<string, ComponentType<AgentConfigurationProps>>>;
}>;
export type CognitionChatProps = Readonly<{
  apiBaseUrl?: string;
  instanceId?: string;
  colorMode?: "light" | "dark" | "system";
  style?: CSSProperties;
  className?: string;
  styleContainer?: ShadowRoot | HTMLElement;
  agentUiPlugins?: readonly AgentUiPlugin[];
  cognitionPanelUrl: string;
  projectId?: string;
  workspaceId?: string;
  agentName?: string;
  configuration?: AgentConfiguration;
  getConfiguration?: () => Promise<AgentConfiguration>;
  draftMessage?: Readonly<{
    id: string | number;
    text: string;
    autoSend?: boolean;
    resetConversation?: boolean;
  }>;
}>;
export declare function CognitionChat(props: CognitionChatProps): ReactElement;
