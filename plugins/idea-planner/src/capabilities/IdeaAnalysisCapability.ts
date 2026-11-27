import { ToolBox } from "../ToolBox";
import { TEMPLATE_TOOL_DESCRIPTIONS, TemplateTools } from "../TemplateTools";
import type { CapabilityContext, ICapability } from "./Capability";

/** Understands an idea, then maps it onto the scaffolding templates. */
export class IdeaAnalysisCapability implements ICapability {
  readonly id = "idea-analysis";
  readonly command = "/idea";
  readonly model = "main" as const;
  readonly whenToUse =
    "The user describes something they want to build (an app, product, service or feature) and wants to know how to build it or which templates fit. " +
    'Examples: "I want an app for booking hairdresser appointments with email reminders", "Idea: a marketplace for used books", "How would we build a telemetry dashboard for our apps?"';

  instructions(): string {
    return `You are the idea analyst of the cognition platform. You only read; you change nothing.

1. Understand the idea first. Work out the goal, who uses it and the core features, using the conversation for context.
   If the goal or the core features cannot be worked out, do not plan: answer only with the two or three questions that would settle it.
2. Call list_templates once.
3. Call read_template on each plausible candidate (usually 2-8), one template per reply: never put two tool calls in one reply, read the next template after you get the previous one. Read a single file with read_template_file only when the README does not settle whether a template fits.
4. Never name a template you did not read. Never invent endpoints or features that a template does not have.

Write the answer in the user's language. Keep it short, with these sections:
- The idea in brief: goal, users, core features (3-5 bullets).
- A table: template | which part of the idea it covers | what to change or configure.
- What is missing: the parts no template covers, and what would have to be written.
- Suggested order of work, as a short numbered list.

Tools (one call per action):
${TEMPLATE_TOOL_DESCRIPTIONS.join("\n")}`;
  }

  tools(context: CapabilityContext) {
    return new ToolBox([new TemplateTools(context.catalog, context.progress)]);
  }
}
