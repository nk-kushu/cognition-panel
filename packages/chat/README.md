# @kushex/chat

Reusable React chat for a shared Cognition runtime. Includes agent selection, threads,
attachments, results and coding reviews. Debugger and trace links open the standalone
Cognition Panel on the same runtime. React 19.2+ and antd 6.3+ are peers; all other runtime
dependencies are bundled. It does not start a backend or execute agents in the browser.

```tsx
import { CognitionChat } from "@kushex/chat";
import "@kushex/chat/style.css";

<CognitionChat
  apiBaseUrl="/api/cognition"
  cognitionPanelUrl="http://localhost:3050"
  instanceId="my-app"
  style={{ height: "100%" }}
/>;
```

Omit `projectId` to select a project registered in Cognition, or supply its Cognition UUID.
The optional `workspaceId` selects a workspace of that project. Host filesystem paths
are not project IDs. The agent operates on the backend's selected workspace.

The host must proxy `/api/cognition/*` to Cognition's `/api/*`, including unbuffered SSE.
No browser cross-origin API access is required. `cognitionPanelUrl` is the browser URL,
which can differ from the server-to-server proxy target.

Enable debugging before sending. Embedded debug runs pause at agent entry; **Open
debugger** opens `/debug/runs/:id` and loads that exact live run over the backend API.
Use **Debug events** for recorded model/tool calls and failures, including completed
runs. Live stepping ends when the run finishes or the runtime restarts. Instrumented
agents and enabled Kushibot logging are required for model/tool event recording.

Build with `pnpm --filter @kushex/chat build` from cognition-panel. Install the built
folder with `pnpm add /path/to/cognition-panel/packages/chat`, or run `pnpm pack` inside
this package to create a transferable npm archive. No workspace dependencies are needed
by a consumer. Rebuild and reinstall after source changes.

Custom browser configuration components can be supplied using `agentUiPlugins`, just
as with `KushexPanel`. Server-side agents continue to be installed in Cognition's plugins
directory. Creating a plugin still means adding its manifest and restarting that runtime.

Hosts can pin an agent with `agentName`, supply a JSON `configuration`, or provide
`getConfiguration: async () => configuration` to synchronize host context immediately
before each send. `draftMessage: { id, text, autoSend?, resetConversation? }` accepts
context actions from the host; each ID is consumed once. `autoSend` defaults to true.
Active thread selection is restored on remount; live runs reconnect through the API.
