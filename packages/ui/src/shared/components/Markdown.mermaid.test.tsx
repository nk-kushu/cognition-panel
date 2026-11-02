import { render, screen, waitFor } from "@testing-library/react";
import { vi, expect, it } from "vitest";
import { Markdown } from "./Markdown";

const runtime = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock("mermaid", () => ({ default: runtime }));

it("renders Mermaid fences as diagrams, preserving ordinary code blocks and font size", async () => {
  runtime.render.mockResolvedValue({ svg: '<svg data-testid="diagram"><text>A to B</text></svg>' });
  const { container, rerender } = render(
    <Markdown
      style={{ fontSize: 22 }}
      text={"```mermaid\nflowchart TD\nA --> B\n```\n\n```ts\nconst x = 1;\n```"}
    />,
  );
  await screen.findByTestId("diagram");
  expect(runtime.render).toHaveBeenCalledWith(
    expect.any(String),
    "flowchart TD\nA --> B",
    expect.any(HTMLElement),
  );
  expect(runtime.initialize).toHaveBeenCalledWith(
    expect.objectContaining({ securityLevel: "strict" }),
  );
  expect(container.querySelector("pre code.language-ts")).toHaveTextContent("const x = 1;");
  expect(container.querySelector(".kx-markdown")).toHaveStyle({ fontSize: "22px" });
  rerender(<Markdown text={"```mermaid\nflowchart LR\nB --> C\n```"} />);
  await waitFor(() =>
    expect(runtime.render).toHaveBeenLastCalledWith(
      expect.any(String),
      "flowchart LR\nB --> C",
      expect.any(HTMLElement),
    ),
  );
});

it("shows the source and an error when a diagram is invalid", async () => {
  runtime.render.mockRejectedValueOnce(new Error("Invalid diagram"));
  render(<Markdown text={"```mermaid\nbroken diagram\n```"} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Invalid diagram");
  expect(screen.getByText("broken diagram")).toBeInTheDocument();
});
