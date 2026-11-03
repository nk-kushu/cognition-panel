import { Alert, Button, Select, Space, Spin } from "antd";
import { useEffect, useState } from "react";
import { KushexProvider } from "./KushexPanel";
import { useAppDispatch, useAppSelector } from "./app/hooks";
import { kushexApi } from "./shared/api/kushexApi";
import { errorMessage } from "./shared/api/errorMessage";
import { ChatPanel } from "./features/chat/ChatPanel";
import { ChatHostContext, PanelLink } from "./features/chat/ChatHostContext";
import { chatAgentSelected } from "./features/runs/runsSlice";
import {
  projectOpened,
  selectProjectId,
  workspaceSelected,
} from "./features/workbench/workbenchSlice";
import type { AgentConfiguration } from "@kushex/contracts";
import type { KushexPanelOptions } from "./types";

export type CognitionChatProps = Pick<
  KushexPanelOptions,
  | "apiBaseUrl"
  | "instanceId"
  | "colorMode"
  | "style"
  | "className"
  | "agentUiPlugins"
  | "styleContainer"
> &
  Readonly<{
    /** Browser URL of the standalone panel connected to this API's runtime. */
    cognitionPanelUrl: string;
    /** Cognition project ID. Omit to let the user select a runtime project. */
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

/** Installable chat with its own store, theme and router; no host Redux setup required. */
export function CognitionChat({
  cognitionPanelUrl,
  configuration,
  getConfiguration,
  draftMessage,
  projectId,
  workspaceId,
  agentName,
  ...options
}: CognitionChatProps) {
  return (
    <KushexProvider {...options} router="memory">
      <ChatHostContext
        value={{
          cognitionPanelUrl,
          pauseOnEntry: true,
          configuration,
          getConfiguration,
          draftMessage,
          agentName,
        }}
      >
        <ChatWorkspace projectId={projectId} workspaceId={workspaceId} agentName={agentName} />
      </ChatHostContext>
    </KushexProvider>
  );
}

function ChatWorkspace({
  projectId,
  workspaceId,
  agentName,
}: Pick<CognitionChatProps, "projectId" | "workspaceId" | "agentName">) {
  const dispatch = useAppDispatch();
  const selected = useAppSelector(selectProjectId);
  const [offset, setOffset] = useState(0);
  const projects = kushexApi.useProjectsQuery(offset, { skip: !!projectId });
  const id = projectId ?? selected;
  const project = kushexApi.useProjectQuery(id ?? "", { skip: !id });
  const workspace = workspaceId ?? project.currentData?.workspace.id;
  useEffect(() => {
    if (!id) return;
    dispatch(projectOpened(id));
    if (workspace) dispatch(workspaceSelected(workspace));
    if (agentName) dispatch(chatAgentSelected({ projectId: id, agentName }));
  }, [dispatch, id, workspace, agentName]);
  return (
    <div className="kx:flex kx:h-full kx:min-h-0 kx:flex-col kx:bg-surface">
      {!projectId && (
        <Space className="kx:p-3" wrap>
          <Select
            aria-label="Cognition project"
            placeholder="Select a Cognition project"
            style={{ minWidth: 240 }}
            value={selected ?? undefined}
            loading={projects.isFetching}
            onChange={(value: string) => dispatch(projectOpened(value))}
            options={projects.currentData?.entries.map((entry) => ({
              value: entry.id,
              label: entry.name,
            }))}
          />
          <Button onClick={() => void projects.refetch()}>Refresh projects</Button>
          {offset > 0 && (
            <Button onClick={() => setOffset(Math.max(0, offset - 100))}>Previous projects</Button>
          )}
          {projects.currentData?.nextOffset != null && (
            <Button onClick={() => setOffset(projects.currentData!.nextOffset!)}>
              Next projects
            </Button>
          )}
          <PanelLink path="/projects">Manage projects</PanelLink>
        </Space>
      )}
      {(projects.error || project.error) && (
        <Alert type="error" showIcon title={errorMessage(projects.error ?? project.error)} />
      )}
      {id && project.isFetching && <Spin aria-label="Loading chat workspace" />}
      <div className="kx:min-h-0 kx:flex-1">
        {(!id || (selected === id && project.currentData)) && <ChatPanel />}
      </div>
    </div>
  );
}
