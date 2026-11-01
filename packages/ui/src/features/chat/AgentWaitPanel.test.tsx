import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfigProvider } from "antd";
import { Provider } from "react-redux";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentWaitDto } from "@kushex/contracts";
import { makeStore } from "../../app/store";
import { AgentWaitPanel, isWaitResult } from "./AgentWaitPanel";

const decision: AgentWaitDto = {
  runId: "run-1",
  kind: "decision",
  status: "pending",
  response: null,
  payload: {
    question: "Which package?",
    findings: "Package A has fewer dependencies.",
    recommendation: "Package A",
    choices: [
      { label: "Package A", packages: ["a"] },
      { label: "Package B", packages: ["b"] },
    ],
  },
};

const review: AgentWaitDto = {
  ...decision,
  kind: "skeleton-review",
  payload: {
    goal: "Add validation",
    plan: "Add validateToken.",
    digest: "revision:abc",
    files: ["src/token.ts"],
    declared: [{ file: "src/token.ts", signatures: ["validateToken(): boolean"], symbols: [] }],
    tests: [{ behavior: "Empty tokens fail", files: ["src/token.test.ts"] }],
    changes: [],
    notLanguageChecked: ["main.py"],
  },
};

function serve(initial: AgentWaitDto) {
  const answers: unknown[] = [];
  let wait = initial;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Request) => {
      if (input.method === "POST") {
        answers.push(await input.json());
        wait = { ...wait, status: "answered" };
        return Response.json(
          { id: "run-2", status: "starting", projectId: "p", agentName: "coding" },
          { status: 201 },
        );
      }
      return Response.json(wait);
    }),
  );
  return answers;
}

const show = () =>
  render(
    <Provider store={makeStore({ instanceId: "test", apiBaseUrl: "/api" })}>
      <ConfigProvider>
        <AgentWaitPanel projectId="p" runId="run-1" />
      </ConfigProvider>
    </Provider>,
  );

afterEach(() => vi.unstubAllGlobals());

it("recognizes a result that waits for the user", () => {
  expect(isWaitResult({ presentation: "wait" })).toBe(true);
  expect(isWaitResult("text")).toBe(false);
});

it("shows evidence and choices, and says what will be remembered", async () => {
  const answers = serve(decision);
  const user = userEvent.setup();
  show();
  await screen.findByText("Which package?");
  expect(screen.getByText("Recommended: Package A")).toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: "Package A" }));
  await user.click(screen.getByRole("checkbox", { name: "Remember for this project" }));
  expect(screen.getByText("Will remember: Which package? Package A")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Answer and remember" }));
  await waitFor(() => expect(answers).toHaveLength(1));
  expect(answers[0]).toEqual({
    choice: "Package A",
    text: "",
    remember: "Which package? Package A",
  });
  await screen.findByText("Answered.");
});

it("binds approval to the digest under review and requires reasons for changes", async () => {
  const answers = serve(review);
  const user = userEvent.setup();
  show();
  await screen.findByText("Review the skeleton");
  expect(screen.getByText("main.py")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Request changes" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Approve" }));
  await waitFor(() => expect(answers).toHaveLength(1));
  expect(answers[0]).toEqual({ choice: "approve", text: "", digest: "revision:abc" });
});
