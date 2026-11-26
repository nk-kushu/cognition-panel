import { RESEARCH_TOOL_DESCRIPTIONS } from "../ResearchTools";
import { ToolBox } from "../ToolBox";
import type { CapabilityContext, ICapability } from "./Capability";
import { extractionRules, FINAL_ANSWER } from "./rules";

const TOOLS = ["research_overview", "list_documents", "read_document", "propose_finding", "link_findings", "set_evidence_type"] as const;

/** Reads one Knowledge document and files its facts into the research sections. */
export class AnalyzeCapability implements ICapability {
  readonly id = "analyze";
  readonly command = "/analyze";
  readonly model = "main" as const;
  readonly whenToUse =
    "The user wants facts extracted from a document already in Knowledge. " +
    'Examples: "analyze the Reddit thread", "/analyze c416ed71-…", "extract the facts from the G2 reviews", "what does the pricing page tell us?"';

  instructions(): string {
    return `You are the research analyst of the cognition platform. You file evidence for a product idea into fixed research sections.

1. The message names one document by id or title. Call list_documents and pick it. If none matches, answer with the list of documents and stop.
2. Call research_overview to see the known findings.
3. Read the document and file its facts.

${extractionRules()}

${FINAL_ANSWER}

Tools (one call per action):
${TOOLS.map((id) => RESEARCH_TOOL_DESCRIPTIONS[id]).join("\n")}`;
  }

  tools(context: CapabilityContext) {
    return new ToolBox([context.research(TOOLS)]);
  }
}
