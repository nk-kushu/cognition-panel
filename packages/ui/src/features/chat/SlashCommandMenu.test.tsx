import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { KushexPanel } from "../../KushexPanel";
import { exampleAgent, exampleProject, FakeEventSource, mockKushexApi } from "../../test/mockApi";
import { matchSlashCommands } from "./SlashCommandMenu";

const commands = [
  { name: "/research", description: "Research an unfamiliar domain", argument: "<topic>" },
  { name: "/idea", description: "Analyse an idea against the templates" },
  { name: "/ask", description: "Ask a question" },
];
const assistant = { ...exampleAgent, name: "assistant", displayName: "Assistant", commands };

beforeEach(() => {
  FakeEventSource.instances.length = 0;
  vi.stubGlobal("EventSource", FakeEventSource);
});

it("offers commands only while the message is a bare command token", () => {
  expect(matchSlashCommands("/", commands).map((command) => command.name)).toEqual(["/research", "/idea", "/ask"]);
  expect(matchSlashCommands("/i", commands).map((command) => command.name)).toEqual(["/idea"]);
  // From two letters on, description matches follow the prefix matches.
  expect(matchSlashCommands("/a", commands).map((command) => command.name)).toEqual(["/ask"]);
  expect(matchSlashCommands("/temp", commands).map((command) => command.name)).toEqual(["/idea"]);
  expect(matchSlashCommands("/as", commands).map((command) => command.name)).toEqual(["/ask"]);
  expect(matchSlashCommands("/research salons", commands)).toEqual([]);
  expect(matchSlashCommands("see https://x.io/a", commands)).toEqual([]);
  expect(matchSlashCommands("/zzz", commands)).toEqual([]);
});

async function openAssistantChat() {
  const api = mockKushexApi([exampleProject], [exampleAgent, assistant]);
  const user = userEvent.setup();
  render(<KushexPanel />);
  await user.click(await screen.findByRole("button", { name: "Open Project one" }));
  await user.click(screen.getByLabelText("Agent"));
  await user.click(await screen.findByTitle("Assistant"));
  return { api, user, message: screen.getByLabelText("Message") };
}

it("completes a command from the agent's manifest with the keyboard instead of sending", async () => {
  const { api, user, message } = await openAssistantChat();

  await user.type(message, "/");
  const menu = await screen.findByRole("listbox", { name: "Commands" });
  expect(within(menu).getAllByRole("option").map((option) => option.textContent)).toEqual([
    "/research<topic>Research an unfamiliar domain",
    "/ideaAnalyse an idea against the templates",
    "/askAsk a question",
  ]);

  await user.keyboard("{ArrowDown}{Enter}");
  expect(message).toHaveValue("/idea ");
  expect(screen.queryByRole("listbox", { name: "Commands" })).not.toBeInTheDocument();
  expect(api.runs).toHaveLength(0);

  await user.type(message, "a booking app{Enter}");
  await waitFor(() => expect(api.runs).toHaveLength(1));
  expect(api.runs[0]).toMatchObject({ agentName: "assistant", message: "/idea a booking app" });
  FakeEventSource.of("run-1").emit({ type: "status", status: "completed" });
});

it("filters as you type, completes with Tab or a click, and closes on Escape", async () => {
  const { user, message } = await openAssistantChat();

  await user.type(message, "/re");
  expect(within(screen.getByRole("listbox", { name: "Commands" })).getAllByRole("option")).toHaveLength(1);
  await user.keyboard("{Tab}");
  expect(message).toHaveValue("/research ");

  await user.clear(message);
  await user.type(message, "/");
  await user.click(screen.getByRole("option", { name: /\/ask/ }));
  expect(message).toHaveValue("/ask ");

  await user.clear(message);
  await user.type(message, "/");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("listbox", { name: "Commands" })).not.toBeInTheDocument();
  await user.type(message, "a");
  expect(screen.getByRole("listbox", { name: "Commands" })).toBeInTheDocument();
});

it("shows no menu for an agent without commands", async () => {
  mockKushexApi([exampleProject], [exampleAgent]);
  const user = userEvent.setup();
  render(<KushexPanel />);
  await user.click(await screen.findByRole("button", { name: "Open Project one" }));
  await user.click(screen.getByLabelText("Agent"));
  await user.click(await screen.findByTitle("reviewer"));
  await user.type(screen.getByLabelText("Message"), "/");
  expect(screen.queryByRole("listbox", { name: "Commands" })).not.toBeInTheDocument();
});
