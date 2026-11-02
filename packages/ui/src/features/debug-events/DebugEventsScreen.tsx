import { DebugEventsViewer } from "@kushex/debug-events";
import "@kushex/debug-events/style.css";
import { useNavigate } from "react-router";
import { paths } from "../workbench/navigation";
import { useRunDebugEvents } from "./useRunDebugEvents";

export function DebugEventsScreen({
  projectId,
  runId,
}: Readonly<{ projectId: string; runId: string }>) {
  const navigate = useNavigate();
  const { refresh, ...state } = useRunDebugEvents(runId);
  return (
    <DebugEventsViewer
      key={runId}
      {...state}
      onRefresh={refresh}
      onBack={() => void navigate(paths.files(projectId))}
      backLabel="Back to files"
      recordingHelp="The server needs kushibot to record them: set KUSHEX_KUSHIBOT_DIR to a built kushibot checkout."
    />
  );
}
