import { Alert, Button, Spin } from "antd";
import { useEffect, useRef } from "react";
import { useParams } from "react-router";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { kushexApi } from "../../shared/api/kushexApi";
import { errorMessage } from "../../shared/api/errorMessage";
import { isFinished, runStarted, selectDebugRun } from "../runs/runsSlice";
import { projectOpened, workspaceSelected } from "../workbench/workbenchSlice";
import { Panes } from "../workbench/Panes";
import { DebugEventsScreen } from "../debug-events/DebugEventsScreen";
import { AgentEditor } from "./AgentEditor";

/** Resolves a runtime run ID; works across origins without browser storage or broadcasts. */
export function RunDebuggerPage() {
  const { runId = "" } = useParams();
  const dispatch = useAppDispatch();
  const selected = useAppSelector(selectDebugRun);
  const connected = useAppSelector((state) => Boolean(state.runs.runs[runId]));
  const attached = useRef<string | null>(null);
  const query = kushexApi.useAgentRunQuery(runId, { refetchOnMountOrArgChange: true });
  const stored = kushexApi.useAgentRunDebugEventsQuery({ runId }, { skip: !query.error });
  const run = query.currentData;
  useEffect(() => {
    if (!run || !run.debug || isFinished(run.status) || attached.current === run.id) return;
    attached.current = run.id;
    dispatch(projectOpened(run.projectId));
    if (run.workspaceId) dispatch(workspaceSelected(run.workspaceId));
    if (selected?.id !== run.id) dispatch(runStarted(run));
  }, [dispatch, run, selected?.id]);

  if (query.error && stored.currentData)
    return (
      <Panes
        main={<DebugEventsScreen projectId={stored.currentData.run.projectId} runId={runId} />}
      />
    );
  if (query.error && stored.isFetching) return <Spin aria-label="Loading recorded run" />;
  if (query.error)
    return (
      <Alert
        type="error"
        showIcon
        title={errorMessage(query.error)}
        description="The live run may have expired or the runtime restarted. Recorded events are available from its chat thread."
        action={<Button onClick={() => void query.refetch()}>Retry</Button>}
      />
    );
  if (!run) return <Spin aria-label="Loading debug run" />;
  if (!run.debug || (isFinished(run.status) && !connected))
    return <Panes main={<DebugEventsScreen projectId={run.projectId} runId={run.id} />} />;
  if (!connected) return <Spin aria-label="Connecting debugger" />;
  return <Panes main={<AgentEditor key={run.agentName} name={run.agentName} />} />;
}
