import type { IScopedDebugRecorderFactory } from "kushibot";
import { resolveAppId } from "./src/AppResolver";
import { CognitionClient, cognitionApiUrl } from "./src/CognitionClient";
import { CapabilityRegistry } from "./src/capabilities/CapabilityRegistry";
import { Http } from "./src/marketing/Http";
import { MarketingTools } from "./src/marketing/MarketingTools";
import { createProviders } from "./src/marketing/providers";
import { DEFAULT_FAST_MODEL, DEFAULT_MAIN_MODEL, OpenRouterModels } from "./src/OpenRouterModel";
import { createResearchAgent } from "./src/ResearchAgent";
import type { ConversationTurn } from "./src/ResearchRequest";
import { ResearchTools, RunTally } from "./src/ResearchTools";

/** The parts of the runner's chat request this agent uses (see plugins/README.md). */
type ChatRequest = Readonly<{
  message: string;
  workspace: string;
  signal: AbortSignal;
  progress(message: string): void;
  /** Set by cognition when it starts the run: `appId`, optionally `appName` and `cognitionApiUrl`. */
  configuration?: Readonly<Record<string, unknown>>;
  /** Present because the server lists this agent in AGENTS_WITH_PROVIDER_CREDENTIALS: `openrouter` and the market-source keys saved in cognition. */
  credentials?: Readonly<Record<string, string>>;
  debug?: IScopedDebugRecorderFactory;
  /** Loaded by the server; `conversation` holds the thread's earlier turns. */
  host?: Readonly<{ conversation?: readonly ConversationTurn[] }>;
}>;

/**
 * The research agent: fills cognition's Research stages for one app. /analyze extracts cited facts
 * from a Knowledge document, /gaps explains what is missing.
 * Every write goes through the cognition API, which verifies quotes and facts.
 */
export async function chat(request: ChatRequest): Promise<string> {
  const configuration = request.configuration ?? {};
  const client = new CognitionClient(cognitionApiUrl(configuration, process.env), request.signal);
  const { appId, appName } = await resolveAppId(configuration, request.workspace, client);
  request.progress(`App: ${appName}`);

  const apiKey = request.credentials?.openrouter || process.env.OPENROUTER_API_KEY;
  const models = await OpenRouterModels.load(apiKey, request.signal);
  const main = process.env.RESEARCH_MODEL || DEFAULT_MAIN_MODEL;
  const fast = process.env.RESEARCH_FAST_MODEL || DEFAULT_FAST_MODEL;
  request.progress(`Models: ${main} (main), ${fast} (routing)`);

  const tally = new RunTally();
  const shared = new ResearchTools(client, appId, request.progress, tally, []);
  // Keys saved in cognition's Settings → AI reach the run as credentials; the environment is the fallback.
  // A source without its key is reported to the model, not fatal.
  const sourceKeys = { ...process.env, ...request.credentials };
  const marketing = new MarketingTools(client, appId, createProviders(sourceKeys, new Http(request.signal), request.signal), request.progress, []);
  const agent = createResearchAgent({
    registry: CapabilityRegistry.default(),
    models: {
      main: models.bind("main", main, "RESEARCH_MODEL"),
      fast: models.bind("fast", fast, "RESEARCH_FAST_MODEL"),
    },
    environment: {
      // One tool set per run, so the limits hold across every tool box a capability builds.
      research: (ids) => ({ ids, call: (toolId, args) => shared.call(toolId, args) }),
      marketing: (ids) => ({ ids, call: (toolId, args) => marketing.call(toolId, args) }),
      progress: request.progress,
    },
    ...(request.debug ? { debug: request.debug } : {}),
  });
  const run = await agent.run(
    { message: request.message, conversation: earlierTurns(request.host?.conversation ?? [], request.message) },
    { signal: request.signal, onProgress: request.progress },
  );
  if (run.result) return run.result.answer;
  const saved = marketing.saved.length ? ` It saved ${marketing.saved.length} source document(s) to Knowledge.` : "";
  const planSaved = tally.planVersion ? ` It saved business plan v${tally.planVersion}; see Work → Бизнес план.` : "";
  const done = (tally.proposed.length ? ` Before stopping it proposed ${tally.proposed.length} findings; review them in Research.` : "") + saved + planSaved;
  throw new Error(`The research agent stopped without an answer (${JSON.stringify(run.outcome).slice(0, 500)}).${done}`);
}

/** The thread may already hold the current message as its last turn; the request carries it separately. */
function earlierTurns(conversation: readonly ConversationTurn[], message: string): ConversationTurn[] {
  const turns = conversation.filter((turn) => (turn.role === "user" || turn.role === "agent") && typeof turn.text === "string");
  const last = turns.at(-1);
  return last?.role === "user" && last.text.trim() === message.trim() ? turns.slice(0, -1) : turns;
}
