import type { TargetAgent } from "./AgentDirectory";

export type ConversationTurn = Readonly<{ role: "user" | "agent"; text: string }>;

/** How the agent was chosen; shown in the first progress line. */
export type RouteSource = "command" | "choice" | "fallback";

export const ROUTE_LABELS: Record<RouteSource, string> = { command: "команда", choice: "избор", fallback: "резервен вариант" };

export type DecisionInput = Readonly<{
  message: string;
  conversation: readonly ConversationTurn[];
  previousAgentId: string | null;
  agents: readonly TargetAgent[];
}>;

/** Picks an agent for free text; null when it abstains or cannot decide (no model, bad output). */
export interface IAgentDecider {
  choose(input: DecisionInput): Promise<string | null>;
}

export type Route = Readonly<{ agent: TargetAgent; source: RouteSource }>;

/**
 * A slash command goes to the agent that declares it, without a model. Free text goes to the
 * decider; when it cannot decide, the thread's previous agent keeps the conversation, else the fallback.
 */
export async function routeMessage(
  input: Readonly<{
    message: string;
    conversation: readonly ConversationTurn[];
    previousAgentId: string | null;
    agents: readonly TargetAgent[];
    fallbackId: string;
    decider: IAgentDecider;
  }>,
): Promise<Route> {
  const command = input.message.trim().match(/^(\/[a-z][\w-]*)(?:\s|$)/i)?.[1]?.toLowerCase();
  const owner = command ? input.agents.find((agent) => agent.commands.includes(command)) : undefined;
  if (owner) return { agent: owner, source: "command" };

  const previous = input.agents.find((agent) => agent.id === input.previousAgentId) ?? null;
  const chosenId = await input.decider.choose({
    message: input.message,
    conversation: input.conversation,
    previousAgentId: previous?.id ?? null,
    agents: input.agents,
  });
  const chosen = input.agents.find((agent) => agent.id === chosenId);
  if (chosen) return { agent: chosen, source: "choice" };
  const fallback = previous ?? input.agents.find((agent) => agent.id === input.fallbackId);
  if (!fallback) throw new Error(`The fallback agent ${input.fallbackId} is not among the router's agents.`);
  return { agent: fallback, source: "fallback" };
}
