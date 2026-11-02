import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DebugEventsViewer } from "./DebugEventsViewer";
import { recorded } from "./test/debugEvents";

it("renders without a router or application store and accepts externally updated events", () => {
  const events = [recorded(1, "progress.reported", "info", { summary: "Investigating files" })];
  const { rerender } = render(<DebugEventsViewer events={events} />);
  expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("All events"));
  expect(screen.getByText("Investigating files")).toBeInTheDocument();
  rerender(
    <DebugEventsViewer
      events={[
        ...events,
        recorded(2, "progress.reported", "info", { summary: "Finished reading" }),
      ]}
    />,
  );
  expect(screen.getByText("Finished reading")).toBeInTheDocument();
});

it("delegates navigation and refresh to the host", () => {
  const onBack = vi.fn();
  const onRefresh = vi.fn();
  render(
    <DebugEventsViewer
      events={[]}
      onBack={onBack}
      backLabel="Return to task"
      onRefresh={onRefresh}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Return to task" }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(onBack).toHaveBeenCalledOnce();
  expect(onRefresh).toHaveBeenCalledOnce();
});
