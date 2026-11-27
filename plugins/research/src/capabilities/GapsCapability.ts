import { RESEARCH_TOOL_DESCRIPTIONS } from "../ResearchTools";
import { ToolBox } from "../ToolBox";
import type { CapabilityContext, ICapability } from "./Capability";

const TOOLS = ["research_overview", "list_documents"] as const;

/** Explains the blind spots of the research and what to do next. Read-only. */
export class GapsCapability implements ICapability {
  readonly id = "gaps";
  readonly command = "/gaps";
  readonly model = "main" as const;
  readonly whenToUse =
    "The user asks what is missing, how far the research is, or what to research next; also any general question about the research. " +
    'Examples: "what should I research next?", "where are the blind spots?", "how complete is stage 2?", "/gaps"';

  instructions(): string {
    return `You guide product research on the cognition platform. You only read; you change nothing.

1. Call research_overview, and list_documents to know which sources exist.
2. Pick the most important blind spot: prefer earlier stages, blockers and failed checks that block later stages.
3. Answer in English with {"answer": "<markdown>"}:
   - **Status:** one line per stage with its percent.
   - **Blind spot:** 1–3 sentences on what is missing and why it matters.
   - **Next tasks:** 2–5 concrete tasks: a Google search to run, a ready-to-paste prompt for ChatGPT/Perplexity,
     or a source to collect and upload into Knowledge. Name real competitors, roles or communities when the findings mention them.
   When the person wants to search by hand, point to /sources: it gives a search plan per site.

Tools (one call per action):
${TOOLS.map((id) => RESEARCH_TOOL_DESCRIPTIONS[id]).join("\n")}`;
  }

  tools(context: CapabilityContext) {
    return new ToolBox([context.research(TOOLS)]);
  }
}
