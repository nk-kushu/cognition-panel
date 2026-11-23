import type { AssistantAnswer } from "../AssistantRequest";
import { RESEARCH_NOTE_PREFIX, RESEARCH_TOOL_DESCRIPTIONS, ToolBox, WebResearchTools } from "../ResearchTools";
import type { CapabilityContext, ICapability } from "./Capability";

/** Explains an unfamiliar domain from web sources, and saves the result as a note of the chat's app. */
export class ResearchCapability implements ICapability {
  readonly id = "research";
  readonly command = "/research";
  readonly model = "main" as const;
  readonly whenToUse =
    "The user wants to understand a domain, market or topic they do not know well before building, or asks to research or look something up. " +
    "Prefer this over idea-analysis when the user says they do not understand the domain. " +
    'Examples: "Research how hair salons handle bookings", "I don\'t know how pharmacy inventory works, help me understand it", "What do competitors in pet insurance offer?"';

  instructions(): string {
    return `You are the research analyst of the cognition platform. The user is about to build something in a domain they do not know well.
Your job: teach them the most important things about that domain, so they can make good decisions. You only read the public web; you change nothing.

1. Plan 3-6 searches that together cover: how the domain/business works, existing products and competitors, must-have features, rules and risks (law, privacy, payments, safety), and the vocabulary.
2. Search, then read the 4-8 most useful pages. Prefer primary, official and well-known sources over SEO listicles. Search in English as well as in the user's language when that finds better sources.
3. Write only what the pages you read support. Cite every factual claim with [n] pointing to Sources. If something rests only on a search snippet, mark it "(snippet)"; if sources disagree or are thin, say so. Never invent a source, product, number or law.

Write in the user's language, plainly, for someone new to the field. Start with "# ${RESEARCH_NOTE_PREFIX} <topic>" and use exactly these sections:
- The domain in plain words: 4-6 sentences on how it works and who the actors are.
- Glossary: the 6-12 terms they will meet, one line each.
- How others do it: a table of 3-6 existing products: name | for whom | notable features | price model if known.
- Must-have features: what users expect from any product here.
- Risks and rules: legal, privacy, payment and operational pitfalls.
- Questions for you: 4-8 decisions only the user can make before building, each with why it matters.
- Sources: a numbered list "[n] title — URL" of the pages you used.

Tools (one call per action):
${RESEARCH_TOOL_DESCRIPTIONS.join("\n")}`;
  }

  tools(context: CapabilityContext) {
    return new ToolBox([new WebResearchTools(context.api, context.progress)]);
  }

  /** Saves the research as an app note, so later idea analysis can build on it. */
  async complete(answer: AssistantAnswer, context: CapabilityContext): Promise<AssistantAnswer> {
    if (!context.app)
      return { answer: `${answer.answer}\n\n---\n_Не е записано като бележка: чатът не е отворен в апп._` };
    const title = noteTitle(answer.answer, context.message);
    try {
      await context.api.createNote(context.app.id, title, answer.answer, `research-${context.runKey}`);
      return { answer: `${answer.answer}\n\n---\n_Записано като бележка „${title}“ в апп ${context.app.name}._` };
    } catch (error) {
      return { answer: `${answer.answer}\n\n---\n_Бележката не беше записана: ${(error as Error).message}_` };
    }
  }
}

/** The answer's "# Research: …" heading, else one built from the request; at most 200 characters. */
function noteTitle(answer: string, message: string): string {
  const heading = answer.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const title = heading?.startsWith(RESEARCH_NOTE_PREFIX) ? heading : `${RESEARCH_NOTE_PREFIX} ${heading || message.replace(/\s+/g, " ").trim()}`;
  return title.length > 200 ? `${title.slice(0, 197)}…` : title;
}
