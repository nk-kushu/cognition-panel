import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { KushexPanel } from "../../KushexPanel";
import { exampleProject, mockKushexApi } from "../../test/mockApi";

it("switches workspaces, clears open files, and sends the selection to the server", async () => {
  const api = mockKushexApi();
  const workspace = {
    id: "33333333-3333-4333-8333-333333333333",
    path: "second",
    branch: null,
    revision: null,
  };
  api.projects[0] = { ...exampleProject, workspaces: [...exampleProject.workspaces, workspace] };
  const fetcher = globalThis.fetch;
  const requests: Request[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      return fetcher(input, init);
    }),
  );
  const user = userEvent.setup();
  render(<KushexPanel />);
  await user.click(await screen.findByRole("button", { name: "Open Project one" }));
  await user.dblClick(await screen.findByText("src"));
  await user.click(await screen.findByText("index.ts"));
  await screen.findByLabelText("src/index.ts contents");
  await user.click(screen.getByRole("combobox", { name: "Workspace" }));
  await user.click(await screen.findByText("second"));
  await waitFor(() => expect(screen.queryByLabelText("src/index.ts contents")).toBeNull());
  await waitFor(() =>
    expect(
      requests.some(
        (request) =>
          new URL(request.url).pathname.endsWith("/tree") &&
          request.headers.get("X-Workspace-Id") === workspace.id,
      ),
    ).toBe(true),
  );
  expect(screen.getByRole("status")).toHaveTextContent("Project one · second");
});

it("adds and selects a second workspace inside the existing project", async () => {
  const api = mockKushexApi();
  const user = userEvent.setup();
  render(<KushexPanel />);
  await user.click(await screen.findByRole("button", { name: "Open Project one" }));
  await user.click(screen.getByRole("button", { name: "Add workspace" }));
  await user.type(await screen.findByRole("textbox", { name: "Workspace path" }), "root/another");
  await user.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("Project one · root/another"),
  );
  expect(api.projects).toHaveLength(1);
  expect(api.projects[0]!.workspaces).toHaveLength(2);
});
