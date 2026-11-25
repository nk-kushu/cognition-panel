import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { IScopedDebugRecorderFactory } from "kushibot";
import { assertCommands, loadTargets, routerCommands } from "./src/AgentDirectory";
import { ModelDecider } from "./src/ModelDecider";
import { DEFAULT_FAST_MODEL } from "./src/OpenRouterModel";
import { routeAndDelegate, type ChatRequest } from "./src/RouterAgent";
import { ThreadMemory } from "./src/ThreadMemory";

/** The agents this router chooses between; the first is the fallback. */
export const TARGET_AGENTS = ["idea-planner", "research"] as const;

const ROUTER_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * The general cognition chat: sends each message to the agent that should answer it. A slash command
 * picks its agent directly; free text goes through one kushibot decision on the fast model. The chosen
 * agent's `chat` runs in this process with the same request, so its progress, debug events and answer
 * appear as this run's.
 */
export async function chat(request: ChatRequest): Promise<unknown> {
  const agents = loadTargets(process.env.KUSHEX_PLUGINS_DIR || path.dirname(ROUTER_DIR), TARGET_AGENTS);
  assertCommands(agents, routerCommands(path.join(ROUTER_DIR, "kushex-plugin.json")));
  return routeAndDelegate(request, {
    agents,
    fallbackId: TARGET_AGENTS[0],
    memory: new ThreadMemory(),
    decider: new ModelDecider({
      apiKey: request.credentials?.openrouter || process.env.OPENROUTER_API_KEY,
      model: process.env.COGNITION_ROUTER_MODEL || DEFAULT_FAST_MODEL,
      signal: request.signal,
      progress: request.progress,
      ...(request.debug ? { debug: request.debug as IScopedDebugRecorderFactory } : {}),
    }),
    importAgent: (entry) => import(pathToFileURL(entry).href),
  });
}
