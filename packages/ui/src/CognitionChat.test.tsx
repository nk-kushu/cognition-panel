import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { CognitionChat } from "./CognitionChat";
import { KushexPanel } from "./KushexPanel";
import { exampleAgent, exampleProject, FakeEventSource, mockKushexApi } from "./test/mockApi";

beforeEach(() => {
  FakeEventSource.instances.length = 0;
  vi.stubGlobal("EventSource", FakeEventSource);
});

it("restores the selected conversation and reconnects an unfinished run once after remount", async () => {
  const api = mockKushexApi([exampleProject], [exampleAgent]);
  const time = "2026-11-02T12:00:00Z";
  api.liveRuns.resumed = {
    id: "resumed",
    projectId: exampleProject.id,
    agentName: "reviewer",
    debug: true,
    status: "paused",
    startedAt: time,
  };
  api.threads.push({
    id: "saved-thread",
    projectId: exampleProject.id,
    title: "Saved conversation",
    createdAt: time,
    updatedAt: time,
    turns: [
      {
        id: "resumed",
        agentName: "reviewer",
        message: "Inspect this",
        files: [],
        debug: true,
        createdAt: time,
        events: [{ type: "status", status: "running" }],
      },
    ],
  });
  localStorage.setItem(
    "kushex:restored:runs",
    JSON.stringify({
      agents: { [exampleProject.id]: "reviewer" },
      threads: { [exampleProject.id]: "saved-thread" },
      breakpoints: {},
      watches: [],
    }),
  );
  render(
    <CognitionChat
      instanceId="restored"
      projectId={exampleProject.id}
      cognitionPanelUrl="http://localhost:3050"
    />,
  );
  await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
  expect(screen.getAllByLabelText("reviewer run")).toHaveLength(1);
  expect(screen.getByText("Inspect this")).toBeInTheDocument();
  act(() => {
    FakeEventSource.of("resumed").emit({
      type: "result",
      value: "Restored result",
      truncated: false,
    });
    FakeEventSource.of("resumed").emit({ type: "status", status: "completed" });
  });
  expect(await screen.findByText("Restored result")).toBeInTheDocument();
});

it("uses the host's latest configuration and sends an incoming context draft once with the fixed agent", async () => {
  const api = mockKushexApi([exampleProject], [exampleAgent]);
  const getConfiguration = vi.fn(async () => ({ bridgeId: "updated-host-session" }));
  const props = {
    projectId: exampleProject.id,
    cognitionPanelUrl: "http://localhost:3050",
    agentName: exampleAgent.name,
    getConfiguration,
    draftMessage: { id: 42, text: "Explain this selected code", resetConversation: true },
  };
  const view = render(<CognitionChat {...props} />);
  await waitFor(() => expect(api.runs).toHaveLength(1));
  expect(api.runs[0]).toMatchObject({
    agentName: "reviewer",
    message: "Explain this selected code",
    configuration: { bridgeId: "updated-host-session" },
  });
  expect(getConfiguration).toHaveBeenCalledTimes(1);
  view.rerender(<CognitionChat {...props} />);
  expect(api.runs).toHaveLength(1);
  act(() => FakeEventSource.of("run-1").emit({ type: "status", status: "completed" }));
});

it("runs standalone chat on a selected runtime project and links to the exact remote debugger and traces", async () => {
  const api = mockKushexApi([exampleProject], [exampleAgent]);
  const user = userEvent.setup();
  render(<CognitionChat projectId={exampleProject.id} cognitionPanelUrl="http://localhost:3050" />);
  await user.click(await screen.findByLabelText("Agent"));
  await user.click(await screen.findByTitle("reviewer"));
  await user.click(screen.getByRole("button", { name: "Start debugging" }));
  await user.type(screen.getByLabelText("Message"), "Debug this agent");
  await user.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(api.runs).toHaveLength(1));
  expect(api.runs[0]).toMatchObject({ debug: true, pauseOnEntry: true, agentName: "reviewer" });
  expect(screen.getByRole("link", { name: "Open debugger" })).toHaveAttribute(
    "href",
    "http://localhost:3050/debug/runs/run-1",
  );
  expect(screen.getByRole("link", { name: "Debug events" })).toHaveAttribute(
    "href",
    `http://localhost:3050/projects/${exampleProject.id}/runs/run-1/debug-events`,
  );
  expect(screen.getByRole("link", { name: "Open debugger" })).toHaveAttribute("target", "_blank");
  const request = api.fetch.mock.calls
    .map(([input]) => (input instanceof Request ? input : new Request(input)))
    .find((entry) => entry.method === "POST" && entry.url.endsWith("/agent-runs"));
  expect(request?.headers.get("x-workspace-id")).toBe(exampleProject.workspace.id);
  act(() => FakeEventSource.of("run-1").emit({ type: "status", status: "completed" }));
});

it("offers the runtime projects when the host has not supplied a Cognition project ID", async () => {
  mockKushexApi([exampleProject], [exampleAgent]);
  const user = userEvent.setup();
  render(<CognitionChat cognitionPanelUrl="http://localhost:3050" />);
  expect(screen.getByText("Open a project to chat with its agents.")).toBeInTheDocument();
  await user.click(screen.getByLabelText("Cognition project"));
  await user.click(await screen.findByTitle("Project one"));
  expect(await screen.findByLabelText("Agent")).toBeInTheDocument();
});

it("loads a debug run by ID in a fresh panel without shared browser state and streams its pauses", async () => {
  const api = mockKushexApi([exampleProject], [exampleAgent]);
  api.liveRuns.external = {
    id: "external",
    projectId: exampleProject.id,
    agentName: "reviewer",
    debug: true,
    status: "paused",
    startedAt: "2026-11-02T12:00:00Z",
    workspaceId: exampleProject.workspace.id,
  };
  render(<KushexPanel instanceId="fresh-debugger" initialPath="/debug/runs/external" />);
  await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
  act(() => FakeEventSource.of("external").emit({ type: "paused", reason: "entry", frames: [] }));
  const debug = await screen.findByRole("region", { name: "Debugger" });
  expect(await within(debug).findByText("paused on entry")).toBeInTheDocument();
  expect(api.runs).toHaveLength(0); // Connecting did not launch a second execution.
  act(() => FakeEventSource.of("external").emit({ type: "status", status: "completed" }));
  expect(await within(debug).findByText("completed")).toBeInTheDocument();
});
