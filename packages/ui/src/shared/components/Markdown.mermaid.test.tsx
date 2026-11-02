import { MermaidDiagram } from "./MermaidDiagram";
import { ConfigProvider } from "antd";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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

it("opens a diagram in a fullscreen dialog and closes it with Escape", async () => {
  runtime.render.mockResolvedValue({ svg: '<svg data-testid="diagram"><text>A to B</text></svg>' });
  const user = userEvent.setup();
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <Markdown text={"```mermaid\nflowchart TD\nA --> B\n```"} />
    </ConfigProvider>,
  );
  await screen.findByTestId("diagram");
  await user.click(screen.getByRole("button", { name: "View Mermaid diagram fullscreen" }));
  const dialog = await screen.findByRole("dialog", { name: "Mermaid diagram" });
  await waitFor(() => expect(dialog.querySelector("svg")).not.toBeNull());
  expect(screen.getAllByRole("button", { name: "View Mermaid diagram fullscreen" })).toHaveLength(
    1,
  );
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByTestId("diagram")).toBeInTheDocument();
});

it("pans the fullscreen diagram with a mouse drag, stops on release, and resets", async () => {
  runtime.render.mockResolvedValue({ svg: '<svg data-testid="diagram"><text>A to B</text></svg>' });
  const user = userEvent.setup();
  render(<MermaidDiagram source="flowchart TD\nA --> B" expanded />);
  await screen.findByTestId("diagram");
  const viewport = screen.getByRole("region", { name: "Pan Mermaid diagram" });
  viewport.setPointerCapture = vi.fn();
  viewport.releasePointerCapture = vi.fn();
  const diagram = screen.getByRole("img", { name: "Mermaid diagram" });
  await user.pointer([
    { keys: "[MouseLeft>]", target: viewport, coords: { clientX: 100, clientY: 100 } },
    { coords: { clientX: 180, clientY: 140 } },
    { keys: "[/MouseLeft]" },
  ]);
  expect(diagram).toHaveStyle({ transform: "translate(80px, 40px) scale(1)" });
  expect(viewport.setPointerCapture).toHaveBeenCalled();
  expect(viewport.releasePointerCapture).toHaveBeenCalled();
  await user.pointer({ target: viewport, coords: { clientX: 200, clientY: 200 } });
  expect(diagram).toHaveStyle({ transform: "translate(80px, 40px) scale(1)" });
  await user.pointer([
    { keys: "[MouseLeft>]", target: viewport, coords: { clientX: 200, clientY: 200 } },
    { coords: { clientX: 170, clientY: 180 } },
    { keys: "[/MouseLeft]" },
  ]);
  expect(diagram).toHaveStyle({ transform: "translate(50px, 20px) scale(1)" });
  await user.click(screen.getByRole("button", { name: "Reset view" }));
  expect(diagram).toHaveStyle({ transform: "translate(0px, 0px) scale(1)" });
});

it("zooms at the pointer with wheel and touchpad pinch, limits zoom, and resets", async () => {
  runtime.render.mockResolvedValue({ svg: '<svg data-testid="diagram" />' });
  const user = userEvent.setup();
  render(<MermaidDiagram source="flowchart TD\nA --> B" expanded />);
  await screen.findByTestId("diagram");
  const viewport = screen.getByRole("region", { name: "Pan Mermaid diagram" });
  const diagram = screen.getByRole("img", { name: "Mermaid diagram" });
  const wheel = new WheelEvent("wheel", {
    deltaY: -100,
    clientX: 100,
    clientY: 50,
    bubbles: true,
    cancelable: true,
  });
  fireEvent(viewport, wheel);
  expect(wheel.defaultPrevented).toBe(true);
  const scale = Math.exp(0.2);
  expect(diagram.style.transform).toBe(
    `translate(${100 - 100 * scale}px, ${50 - 50 * scale}px) scale(${scale})`,
  );
  fireEvent.wheel(viewport, { deltaY: 100, clientX: 100, clientY: 50 });
  expect(diagram.style.transform).toContain("scale(1)");
  fireEvent.wheel(viewport, { deltaY: -100, ctrlKey: true, clientX: 0, clientY: 0 });
  expect(diagram.style.transform).toContain(`scale(${Math.exp(1)})`);
  for (let i = 0; i < 30; i++) fireEvent.wheel(viewport, { deltaY: -200 });
  expect(diagram.style.transform).toContain("scale(8)");
  for (let i = 0; i < 40; i++) fireEvent.wheel(viewport, { deltaY: 200 });
  expect(diagram.style.transform).toContain("scale(0.1)");
  await user.click(screen.getByRole("button", { name: "Reset view" }));
  expect(diagram).toHaveStyle({ transform: "translate(0px, 0px) scale(1)" });
});

it("supports Safari touchpad pinch gestures", async () => {
  runtime.render.mockResolvedValue({ svg: '<svg data-testid="diagram" />' });
  render(<MermaidDiagram source="flowchart TD\nA --> B" expanded />);
  await screen.findByTestId("diagram");
  const viewport = screen.getByRole("region", { name: "Pan Mermaid diagram" });
  fireEvent(viewport, new Event("gesturestart", { cancelable: true }));
  for (const scale of [1.5, 2]) {
    const gesture = Object.assign(new Event("gesturechange", { cancelable: true }), {
      scale,
      clientX: 100,
      clientY: 50,
    });
    fireEvent(viewport, gesture);
    expect(gesture.defaultPrevented).toBe(true);
  }
  expect(screen.getByRole("img", { name: "Mermaid diagram" })).toHaveStyle({
    transform: "translate(-100px, -50px) scale(2)",
  });
});
