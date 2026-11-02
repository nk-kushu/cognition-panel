import { useAppSelector } from "../../app/hooks";
import { selectWorkspaceId } from "./workbenchSlice";
import { ActivityBar } from "./ActivityBar";
import { useNarrow } from "./Panes";
import { SectionsBar } from "./SectionsBar";
import { StatusBar } from "./StatusBar";
import { TopBar } from "./TopBar";
import { WorkbenchRoutes } from "./WorkbenchRoutes";

/** The panel's frame stays mounted; only the current page's panes change with the route. */
export function Workbench() {
  const workspaceId = useAppSelector(selectWorkspaceId);
  const narrow = useNarrow();
  return (
    <div className="kx:flex kx:h-full kx:flex-col">
      <TopBar compact={narrow} />
      <div className="kx:flex kx:min-h-0 kx:flex-1">
        {!narrow && <ActivityBar />}
        <WorkbenchRoutes key={workspaceId ?? "default"} />
      </div>
      {narrow ? <SectionsBar /> : <StatusBar />}
    </div>
  );
}
