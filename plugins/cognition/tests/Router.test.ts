import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { assertCommands, loadTargets, routerCommands, type TargetAgent } from "../src/AgentDirectory";
import type { DecisionInput, IAgentDecider } from "../src/Router";
import { routeAndDelegate, type ChatRequest } from "../src/RouterAgent";
import { ThreadMemory } from "../src/ThreadMemory";

const PLUGINS_DIR = path.resolve(import.meta.dirname, "../..");

function pluginsFixture(manifests: Record<string, unknown>): string {
  const root = mkdtempSync(path.join(tmpdir(), "router-plugins-"));
  for (const [folder, manifest] of Object.entries(manifests)) {
    mkdirSync(path.join(root, folder));
    writeFileSync(path.join(root, folder, "kushex-plugin.json"), JSON.stringify(manifest));
  }
  return root;
}

const agent = (id: string, commands: string[]): TargetAgent => ({ id, name: `Agent ${id}`, description: `${id} things`, commands, entry: `/plugins/${id}/agent.ts` });
const IDEA = agent("idea-planner", ["/idea", "/ask", "/clarify"]);
const RESEARCH = agent("research", ["/analyze", "/gaps"]);

class FakeDecider implements IAgentDecider {
  inputs: DecisionInput[] = [];
  constructor(private readonly answer: string | null) {}
  async choose(input: DecisionInput) {
    this.inputs.push(input);
    return this.answer;
  }
}

function setup(options: { decide?: string | null; previous?: string | null } = {}) {
  const decider = new FakeDecider(options.decide ?? null);
  const remembered: Array<[string | undefined, string]> = [];
  const progress: string[] = [];
  const calls: Array<{ entry: string; request: ChatRequest }> = [];
  const deps = {
    agents: [IDEA, RESEARCH],
    fallbackId: "idea-planner",
    decider,
    memory: {
      previousAgent: () => options.previous ?? null,
      remember: (threadId: string | undefined, agentId: string) => void remembered.push([threadId, agentId]),
    },
    importAgent: async (entry: string) => ({
      chat: async (request: ChatRequest) => {
        calls.push({ entry, request });
        return `answer from ${entry}`;
      },
    }),
  };
  const request: ChatRequest = {
    message: "",
    threadId: "thread-1",
    workspace: "/roots/x",
    signal: new AbortController().signal,
    progress: (message) => void progress.push(message),
    configuration: { appId: "app-1" },
    credentials: { openrouter: "key" },
    host: { conversation: [{ role: "user", text: "earlier" }, { role: "agent", text: "reply" }] },
  };
  return { deps, decider, remembered, progress, calls, request };
}

// ── Discovery ────────────────────────────────────────────────────────────

test("finds idea-planner and research in the real plugins folder, with commands and entry paths", () => {
  const [idea, research] = loadTargets(PLUGINS_DIR, ["idea-planner", "research"]);
  assert.equal(idea!.entry, path.join(PLUGINS_DIR, "idea-planner", "agent.ts"));
  assert.deepEqual(idea!.commands, ["/idea", "/ask", "/clarify"]);
  assert.equal(research!.name, "Research Agent");
  assert.deepEqual(research!.commands, ["/analyze", "/discover", "/gaps", "/plan"]);
});

test("the router's own manifest lists exactly the commands of its agents", () => {
  const agents = loadTargets(PLUGINS_DIR, ["idea-planner", "research"]);
  assert.doesNotThrow(() => assertCommands(agents, routerCommands(path.join(PLUGINS_DIR, "cognition", "kushex-plugin.json"))));
});

test("names a missing agent and the folder it searched", () => {
  const root = pluginsFixture({ ideas: { agents: [{ id: "idea-planner", entry: "agent.ts" }] } });
  assert.throws(() => loadTargets(root, ["idea-planner", "research"]), new RegExp(`cannot find agent "research".*${root.replace(/[/\\]/g, ".")}`));
});

test("refuses a command declared by two agents", () => {
  assert.throws(() => assertCommands([IDEA, agent("research", ["/ask"])], ["/idea", "/ask", "/clarify"]), /Both idea-planner and research declare \/ask/);
});

test("says what to add and remove when the router manifest is out of date", () => {
  assert.throws(() => assertCommands([IDEA, RESEARCH], ["/idea", "/ask", "/clarify", "/analyze", "/fill-gap"]), /Add: \/gaps\. Remove: \/fill-gap\./);
});

// ── Routing ──────────────────────────────────────────────────────────────

test("a slash command goes to its agent without asking the model", async () => {
  const { deps, decider, calls, request, progress } = setup({ decide: "idea-planner" });
  const answer = await routeAndDelegate({ ...request, message: "/gaps какво липсва" }, deps);
  assert.equal(answer, "answer from /plugins/research/agent.ts");
  assert.equal(decider.inputs.length, 0);
  assert.equal(progress[0], "→ Agent research (команда)");
  assert.equal(calls[0]!.request.message, "/gaps какво липсва");
});

test("/idea goes to idea-planner by command", async () => {
  const { deps, calls, request } = setup();
  await routeAndDelegate({ ...request, message: "/idea booking app" }, deps);
  assert.equal(calls[0]!.entry, IDEA.entry);
});

test("free text goes to the agent the model chooses, with the previous agent as evidence", async () => {
  const { deps, decider, calls, request, progress } = setup({ decide: "research", previous: "idea-planner" });
  await routeAndDelegate({ ...request, message: "какво ми липсва в проучването?" }, deps);
  assert.equal(calls[0]!.entry, RESEARCH.entry);
  assert.equal(progress[0], "→ Agent research (избор)");
  assert.equal(decider.inputs[0]!.previousAgentId, "idea-planner");
  assert.deepEqual(decider.inputs[0]!.conversation, [{ role: "user", text: "earlier" }, { role: "agent", text: "reply" }]);
});

test("when the model cannot decide, the thread's previous agent answers", async () => {
  const { deps, calls, request, progress } = setup({ decide: null, previous: "research" });
  await routeAndDelegate({ ...request, message: "а за етап 2?" }, deps);
  assert.equal(calls[0]!.entry, RESEARCH.entry);
  assert.equal(progress[0], "→ Agent research (резервен вариант)");
});

test("without a previous agent, an undecided message goes to idea-planner", async () => {
  const { deps, calls, request } = setup({ decide: null });
  await routeAndDelegate({ ...request, message: "здравей" }, deps);
  assert.equal(calls[0]!.entry, IDEA.entry);
});

test("a choice that is not one of the agents counts as undecided", async () => {
  const { deps, calls, request } = setup({ decide: "coding" });
  await routeAndDelegate({ ...request, message: "fix the bug" }, deps);
  assert.equal(calls[0]!.entry, IDEA.entry);
});

// ── Delegation ───────────────────────────────────────────────────────────

test("passes the request unchanged and remembers the agent for the thread", async () => {
  const { deps, calls, request, remembered } = setup();
  await routeAndDelegate({ ...request, message: "/analyze doc-1" }, deps);
  assert.equal(calls[0]!.request.configuration, request.configuration);
  assert.equal(calls[0]!.request.credentials, request.credentials);
  assert.equal(calls[0]!.request.host, request.host);
  assert.equal(calls[0]!.request.signal, request.signal);
  assert.deepEqual(remembered, [["thread-1", "research"]]);
});

test("returns the agent's value as is and lets its error through", async () => {
  const { deps, request } = setup();
  const value = { schemaVersion: 1, message: "hi" };
  assert.equal(await routeAndDelegate({ ...request, message: "/ask x" }, { ...deps, importAgent: async () => ({ chat: async () => value }) }), value);
  await assert.rejects(
    routeAndDelegate({ ...request, message: "/ask x" }, { ...deps, importAgent: async () => ({ chat: async () => { throw new Error("key rejected"); } }) }),
    /key rejected/,
  );
});

test("refuses an agent module without chat", async () => {
  const { deps, request } = setup();
  await assert.rejects(routeAndDelegate({ ...request, message: "/ask x" }, { ...deps, importAgent: async () => ({}) }), /does not export a chat function/);
});

// ── Thread memory ────────────────────────────────────────────────────────

test("remembers the last agent per thread across instances", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "router-memory-"));
  new ThreadMemory(directory).remember("3f2a-thread", "research");
  assert.equal(new ThreadMemory(directory).previousAgent("3f2a-thread"), "research");
  assert.equal(new ThreadMemory(directory).previousAgent("other-thread"), null);
});

test("does nothing without a thread id", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "router-memory-"));
  const memory = new ThreadMemory(directory);
  memory.remember(undefined, "research");
  assert.equal(memory.previousAgent(undefined), null);
  assert.deepEqual(readdirSync(directory), []);
});

test("never writes outside its folder for an unsafe thread id", () => {
  const root = mkdtempSync(path.join(tmpdir(), "router-memory-"));
  const directory = path.join(root, "memory");
  new ThreadMemory(directory).remember("../escape", "research");
  new ThreadMemory(directory).remember("a/b", "research");
  assert.deepEqual(readdirSync(root), []);
  assert.equal(new ThreadMemory(directory).previousAgent("../escape"), null);
});
