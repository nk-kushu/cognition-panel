import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KushexPanel } from "../../KushexPanel";
import { mockKushexApi } from "../../test/mockApi";

const context = {
  workspace: { name: "agentic-service", path: "templates/agentic-service" },
  openFile: "src/index.ts",
};

describe("HostContext", () => {
  it("opens the host's workspace and file instead of the Projects page", async () => {
    const api = mockKushexApi([]);
    render(<KushexPanel context={context} />);

    expect(await screen.findByLabelText("src/index.ts contents")).toHaveTextContent(
      "export const answer = 42;",
    );
    expect(screen.queryByRole("heading", { name: "Projects" })).not.toBeInTheDocument();
    expect(api.projects).toHaveLength(1);
    expect(api.projects[0]).toMatchObject({
      name: "agentic-service",
      workspace: { path: "templates/agentic-service" },
    });
  });

  it("lets the user leave the host's files for other pages", async () => {
    const user = userEvent.setup();
    const api = mockKushexApi([]);
    render(<KushexPanel context={context} />);
    await screen.findByLabelText("src/index.ts contents");

    const activities = screen.getByRole("navigation", { name: "Activities" });
    await user.click(within(activities).getByRole("button", { name: "Settings" }));

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    const opens = api.fetch.mock.calls.filter(
      ([input]) => input instanceof Request && input.url.endsWith("/projects/open"),
    );
    expect(opens).toHaveLength(1);
  });

  it("reuses the project already opened at the same path", async () => {
    const api = mockKushexApi([]);
    const { unmount } = render(<KushexPanel context={context} />);
    await screen.findByLabelText("src/index.ts contents");
    unmount();

    render(<KushexPanel context={context} />);
    await screen.findByLabelText("src/index.ts contents");
    expect(api.projects).toHaveLength(1);
  });

  it("shows why the workspace could not be opened", async () => {
    const api = mockKushexApi([]);
    const respond = api.fetch.getMockImplementation()!;
    api.fetch.mockImplementation(async (input) =>
      input instanceof Request && new URL(input.url).pathname.endsWith("/projects/open")
        ? Response.json(
            { code: "NOT_FOUND", message: "Workspace root is not configured." },
            { status: 404 },
          )
        : respond(input),
    );
    render(<KushexPanel context={context} />);

    await waitFor(() =>
      expect(screen.getByText("Workspace root is not configured.")).toBeInTheDocument(),
    );
    expect(screen.getByText("Could not open templates/agentic-service")).toBeInTheDocument();
  });
});
