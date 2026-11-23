import type { IScopedDebugRecorderFactory } from "kushibot";
import { createAssistantAgent } from "./src/AssistantAgent";
import type { ConversationTurn } from "./src/AssistantRequest";
import { CapabilityRegistry } from "./src/capabilities/CapabilityRegistry";
import { DEFAULT_FAST_MODEL, DEFAULT_MAIN_MODEL, OpenRouterModels } from "./src/OpenRouterModel";
import { TemplateCatalog } from "./src/TemplateCatalog";

/** The parts of the runner's chat request this agent uses (see plugins/README.md). */
type ChatRequest = Readonly<{
  message: string;
  workspace: string;
  signal: AbortSignal;
  progress(message: string): void;
  /** Present because the server lists this agent in AGENTS_WITH_PROVIDER_CREDENTIALS. */
  credentials?: Readonly<Record<string, string>>;
  debug?: IScopedDebugRecorderFactory;
  /** Loaded by the server; `conversation` holds the thread's earlier turns. */
  host?: Readonly<{ conversation?: readonly ConversationTurn[] }>;
}>;

/**
 * The cognition assistant: picks a capability for each message (idea analysis, answering a
 * question, or asking for clarification) and runs it. A leading /idea, /ask or /clarify picks it directly.
 */
export async function chat(request: ChatRequest): Promise<string> {
  const catalog = TemplateCatalog.locate(request.workspace);
  const models = await OpenRouterModels.load(request.credentials?.openrouter || process.env.OPENROUTER_API_KEY, request.signal);
  const main = process.env.IDEA_PLANNER_MODEL || DEFAULT_MAIN_MODEL;
  const fast = process.env.IDEA_PLANNER_FAST_MODEL || DEFAULT_FAST_MODEL;
  request.progress(`Models: ${main} (main), ${fast} (routing)`);
  const agent = createAssistantAgent({
    registry: CapabilityRegistry.default(),
    models: {
      main: models.bind("main", main, "IDEA_PLANNER_MODEL"),
      fast: models.bind("fast", fast, "IDEA_PLANNER_FAST_MODEL"),
    },
    environment: { catalog, progress: request.progress },
    ...(request.debug ? { debug: request.debug } : {}),
  });
  const run = await agent.run(
    { message: request.message, conversation: earlierTurns(request.host?.conversation ?? [], request.message) },
    { signal: request.signal, onProgress: request.progress },
  );
  if (run.result) return run.result.answer;
  throw new Error(`The assistant stopped without an answer (${JSON.stringify(run.outcome).slice(0, 500)}).`);
}

/** The thread may already hold the current message as its last turn; the request carries it separately. */
function earlierTurns(conversation: readonly ConversationTurn[], message: string): ConversationTurn[] {
  const turns = conversation.filter((turn) => (turn.role === "user" || turn.role === "agent") && typeof turn.text === "string");
  const last = turns.at(-1);
  return last?.role === "user" && last.text.trim() === message.trim() ? turns.slice(0, -1) : turns;
}
