import {
  useProjectQuery,
  useProjectsQuery,
  useAddWorkspaceMutation,
} from "../../shared/api/kushexApi";
import { Alert, Avatar, Button, Input, Modal, Select, Tooltip, Typography } from "antd";
import { IconMoon, IconSun, IconSunMoon } from "@tabler/icons-react";
import { useNavigate } from "react-router";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { AppIcon } from "../../shared/components/AppIcon";
import { SearchIcon, SettingsIcon, UserIcon } from "../../shared/lib/icons";
import { borderB } from "../../shared/lib/styles";
import { colorModeChanged, selectColorMode, type ColorMode } from "../settings/settingsSlice";
import { paths, useOpenProject } from "./navigation";
import { useState } from "react";
import { errorMessage } from "../../shared/api/errorMessage";
import { selectProjectId, selectWorkspaceId, workspaceSelected } from "./workbenchSlice";

const nextColorMode: Readonly<Record<ColorMode, ColorMode>> = {
  light: "dark",
  dark: "system",
  system: "light",
};
const colorModeIcon = { light: IconSun, dark: IconMoon, system: IconSunMoon } as const;

export function TopBar({ compact }: Readonly<{ compact?: boolean }>) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const openProject = useOpenProject();
  const project = useAppSelector(selectProjectId);
  const workspaceId = useAppSelector(selectWorkspaceId);
  const [addingWorkspace, setAddingWorkspace] = useState(false);
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [addWorkspace, savingWorkspace] = useAddWorkspaceMutation();
  const projects = useProjectsQuery(0);
  const selected = useProjectQuery(project ?? "", { skip: !project });
  const choices = [...(projects.data?.entries ?? [])];
  const selectedProject = selected.currentData;
  if (selectedProject && !choices.some((entry) => entry.id === selectedProject.id))
    choices.push(selectedProject);
  const colorMode = useAppSelector(selectColorMode);

  return (
    <header
      className={`kx:flex kx:h-12 kx:shrink-0 kx:items-center kx:gap-3 kx:bg-surface kx:px-3 ${borderB}`}
    >
      <Typography.Text strong className="kx:shrink-0">
        Cognition Panel
      </Typography.Text>
      <Select
        aria-label="Project"
        size="small"
        placeholder="Project"
        value={project ?? undefined}
        onChange={openProject}
        options={choices.map((project) => ({ value: project.id, label: project.name }))}
        className="kx:w-44"
      />
      {selectedProject && (
        <>
          <Select
            aria-label="Workspace"
            size="small"
            value={workspaceId ?? selectedProject.workspace.id}
            options={selectedProject.workspaces.map((workspace) => ({
              value: workspace.id,
              label: workspace.path,
            }))}
            onChange={(id: string) => dispatch(workspaceSelected(id))}
            className="kx:w-52"
          />
          <Button size="small" onClick={() => setAddingWorkspace(true)}>
            Add workspace
          </Button>
          <Modal
            title="Add workspace"
            open={addingWorkspace}
            confirmLoading={savingWorkspace.isLoading}
            onCancel={() => setAddingWorkspace(false)}
            onOk={async () => {
              try {
                const updated = await addWorkspace({
                  projectId: selectedProject.id,
                  path: workspacePath,
                }).unwrap();
                const added = updated.workspaces.find(
                  (workspace) => !selectedProject.workspaces.some((old) => old.id === workspace.id),
                );
                if (added) dispatch(workspaceSelected(added.id));
                setAddingWorkspace(false);
                setWorkspacePath("");
                setWorkspaceError(null);
              } catch (error) {
                setWorkspaceError(errorMessage(error));
              }
            }}
          >
            <Input
              aria-label="Workspace path"
              placeholder="Root-relative directory path"
              value={workspacePath}
              onChange={(event) => setWorkspacePath(event.target.value)}
            />
            {workspaceError && <Alert type="error" title={workspaceError} />}
          </Modal>
        </>
      )}
      {!compact && (
        <Input
          aria-label="Search"
          size="small"
          placeholder="Search"
          prefix={<AppIcon icon={SearchIcon} size="sm" />}
          className="kx:mx-auto kx:max-w-sm"
        />
      )}
      <div className="kx:ml-auto kx:flex kx:items-center kx:gap-1">
        <Tooltip title={`Color mode: ${colorMode}`}>
          <Button
            type="text"
            onClick={() => dispatch(colorModeChanged(nextColorMode[colorMode]))}
            icon={<AppIcon icon={colorModeIcon[colorMode]} label={`Color mode: ${colorMode}`} />}
          />
        </Tooltip>
        <Button
          type="text"
          onClick={() => void navigate(paths.settings())}
          icon={<AppIcon icon={SettingsIcon} label="Settings" />}
        />
        <Avatar size="small" icon={<AppIcon icon={UserIcon} size="sm" />} />
      </div>
    </header>
  );
}
