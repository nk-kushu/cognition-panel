import { expect, it } from "vitest";
import { recorded } from "../../test/debugEvents";
import { executionDetails } from "./executionContent";

it("reassembles out-of-order prompt chunks and preserves Unicode and newlines", () => {
  const raw = JSON.stringify({ instructions: "Провери\nабонамента", messages: [] });
  const events = [1, 0].map((index) =>
    recorded(index + 1, "progress.reported", "debug", {
      operation: "detail.request",
      count: index,
      metrics: { parts: 2 },
      content: index === 0 ? raw.slice(0, 15) : raw.slice(15),
    }),
  );
  const result = executionDetails(
    events.map((item) => ({
      ...item,
      event: { ...item.event, trace: { ...item.event.trace, spanId: "model-call" } },
    })),
  );
  expect(result).toHaveLength(1);
  expect(result[0]?.complete).toBe(true);
  expect(JSON.parse(result[0]!.text)).toEqual(JSON.parse(raw));
});
it("marks missing chunks as incomplete instead of presenting an exact prompt", () => {
  const event = recorded(1, "progress.reported", "debug", {
    operation: "detail.request",
    count: 1,
    metrics: { parts: 3 },
    content: "fragment",
  });
  expect(executionDetails([event])[0]).toMatchObject({ complete: false, text: "fragment" });
});
