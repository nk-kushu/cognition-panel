import { Alert, Spin } from "antd";
import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useAppDispatch } from "../../app/hooks";
import { errorMessage } from "../../shared/api/errorMessage";
import { useOpenProjectMutation } from "../../shared/api/kushexApi";
import type { ProjectDto } from "@kushex/contracts";
import type { KushexPanelContext } from "../../types";
import { paths } from "./navigation";
import { fileTabOpened, projectOpened, workspaceSelected } from "./workbenchSlice";

/**
 * Opens the host's project, its workspace and file before the workbench renders, so the
 * panel starts on the host's code instead of flashing the Projects page.
 */
export function HostContext({
  context,
  children,
}: Readonly<{ context?: KushexPanelContext; children: ReactNode }>) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [openProject] = useOpenProjectMutation();
  // Read once at mount, like the router options; a new context needs a new panel.
  const [initial] = useState(context);
  const [state, setState] = useState<"opening" | "ready" | { error: string }>(
    initial ? "opening" : "ready",
  );

  // An effect event: `navigate` changes with every route, and re-running the effect on it
  // would send the user back to these files whenever they open another page.
  const show = useEffectEvent(
    (project: ProjectDto, { workspace, openFile }: KushexPanelContext) => {
      // Open the project first: opening it later would close the file tab.
      dispatch(projectOpened(project.id));
      const selected = project.workspaces.find((item) => item.path === workspace.path);
      if (selected && selected.id !== project.workspace.id)
        dispatch(workspaceSelected(selected.id));
      if (openFile)
        dispatch(
          fileTabOpened({
            key: `file:${openFile}`,
            path: openFile,
            title: openFile.split("/").at(-1) ?? openFile,
            kind: "file",
          }),
        );
      void navigate(paths.files(project.id), { replace: true });
      setState("ready");
    },
  );

  useEffect(() => {
    if (!initial) return;
    let active = true;
    const { workspace } = initial;
    openProject({ name: workspace.name, path: workspace.path, description: workspace.description })
      .unwrap()
      .then(
        (project) => {
          if (active) show(project, initial);
        },
        (error: unknown) => {
          if (active) setState({ error: errorMessage(error) });
        },
      );
    return () => {
      active = false;
    };
  }, [initial, openProject]);

  if (state === "opening")
    return (
      <div className="kx:flex kx:h-full kx:items-center kx:justify-center">
        <Spin aria-label={`Opening ${initial?.workspace.name ?? "project"}`} />
      </div>
    );
  if (state === "ready") return children;
  return (
    <div className="kx:flex kx:h-full kx:flex-col">
      <Alert
        type="error"
        showIcon
        title={`Could not open ${initial?.workspace.path ?? "the project"}`}
        description={state.error}
      />
      <div className="kx:min-h-0 kx:flex-1">{children}</div>
    </div>
  );
}
