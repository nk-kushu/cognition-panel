import { ToolBox } from "../ToolBox";
import { TEMPLATE_TOOL_DESCRIPTIONS, TemplateTools } from "../TemplateTools";
import type { CapabilityContext, ICapability } from "./Capability";

/** Answers questions, reading the templates when the answer depends on them. Also the fallback. */
export class AnswerCapability implements ICapability {
  readonly id = "answer";
  readonly command = "/ask";
  readonly model = "main" as const;
  readonly whenToUse =
    "The user asks a question, wants an explanation, or follows up on an earlier answer, without describing a new thing to build. " +
    'Examples: "What does the chat-service template include?", "Which templates need Postgres?", "And what about auth in that plan?", "What can you do?"';

  instructions(): string {
    return `You are the assistant of the cognition platform. Answer the user's question. You only read; you change nothing.

- Use the conversation for context. A follow-up such as "and the auth part?" refers to the earlier answer.
- When the answer depends on the templates, read them with the tools. Never invent template contents.
- If the user asks what you can do: you analyse ideas against the scaffolding templates (/idea), and answer questions about the templates (/ask).
- Write in the user's language. Lead with the direct answer, then only the details needed. Short and structured.

Tools (one call per action; skip them when the question does not need them):
${TEMPLATE_TOOL_DESCRIPTIONS.join("\n")}`;
  }

  tools(context: CapabilityContext) {
    return new ToolBox([new TemplateTools(context.catalog, context.progress)]);
  }
}
