import type { TargetAgent } from "./AgentDirectory";
import { ROUTE_LABELS, routeMessage, type ConversationTurn, type IAgentDecider } from "./Router";
import type { ThreadMemory } from "./ThreadMemory";

/** The runner's chat request; passed to the chosen agent unchanged. */
export type ChatRequest = Readonly<{
  message: string;
  threadId?: string;
  workspace: string;
  signal: AbortSignal;
  progress(message: string): void;
  configuration?: Readonly<Record<string, unknown>>;
  credentials?: Readonly<Record<string, string>>;
  host?: unknown;
  debug?: unknown;
  files?: readonly string[];
  resume?: unknown;
}>;

type AgentModule = { chat?: unknown };

export type RouterDeps = Readonly<{
  agents: readonly TargetAgent[];
  fallbackId: string;
  memory: Pick<ThreadMemory, "previousAgent" | "remember">;
  decider: IAgentDecider;
  importAgent(entry: string): Promise<AgentModule>;
}>;

/** Chooses the agent for this message, remembers it for the thread, and returns that agent's answer. */
export async function routeAndDelegate(request: ChatRequest, deps: RouterDeps): Promise<unknown> {
  const route = await routeMessage({
    message: request.message,
    conversation: conversationOf(request.host),
    previousAgentId: deps.memory.previousAgent(request.threadId),
    agents: deps.agents,
    fallbackId: deps.fallbackId,
    decider: deps.decider,
  });
  request.progress(`→ ${route.agent.name} (${ROUTE_LABELS[route.source]})`);
  deps.memory.remember(request.threadId, route.agent.id);
  const module = await deps.importAgent(route.agent.entry);
  if (typeof module.chat !== "function") throw new Error(`${route.agent.id} (${route.agent.entry}) does not export a chat function.`);
  return (module.chat as (request: ChatRequest) => unknown)(request);
}

function conversationOf(host: unknown): ConversationTurn[] {
  const turns = (host as { conversation?: unknown } | undefined)?.conversation;
  if (!Array.isArray(turns)) return [];
  return turns.filter(
    (turn): turn is ConversationTurn =>
      !!turn && (turn.role === "user" || turn.role === "agent") && typeof (turn as { text?: unknown }).text === "string",
  );
}
