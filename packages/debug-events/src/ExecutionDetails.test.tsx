import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { recorded } from "./test/debugEvents";
import { ExecutionDetails } from "./ExecutionDetails";
it("shows the execution stages and the readable request", () => {
  render(
    <ExecutionDetails
      events={[
        recorded(1, "progress.reported", "debug", {
          operation: "detail.request",
          count: 0,
          metrics: { parts: 1 },
          content: JSON.stringify({ instructions: "Провери абонамента", messages: [] }),
        }),
      ]}
    />,
  );
  expect(screen.getByText("1 · LLM input — exact request")).toBeInTheDocument();
  expect(screen.getByText(/Провери абонамента/)).toBeInTheDocument();
});
it("explains missing content on older runs", () => {
  render(<ExecutionDetails events={[]} />);
  expect(screen.getByText(/Execution content was not recorded/)).toBeInTheDocument();
});
it("opens a stage full screen without toggling its panel", async () => {
  render(
    <ExecutionDetails
      events={[
        recorded(1, "progress.reported", "debug", {
          operation: "detail.request",
          count: 0,
          metrics: { parts: 1 },
          content: JSON.stringify({ instructions: "Провери абонамента", messages: [] }),
        }),
      ]}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Open 1 · LLM input — exact request full screen" }),
  );
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("1 · LLM input — exact request")).toBeInTheDocument();
  expect(within(dialog).getByText(/Провери абонамента/)).toBeInTheDocument();
  expect(screen.getByRole("group")).not.toHaveAttribute("open");
});
