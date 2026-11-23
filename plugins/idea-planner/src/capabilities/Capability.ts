import type { IAgentToolCall } from "kushibot";
import type { TemplateCatalog } from "../TemplateCatalog";

/** Which configured model a capability's session runs on. */
export type CapabilityModel = "main" | "fast";

/** What a capability needs to build its tools for one run. */
export type CapabilityContext = Readonly<{
  catalog: TemplateCatalog;
  progress(message: string): void;
}>;

/**
 * One thing the assistant can do. The router chooses a capability by its `whenToUse`, or by
 * `command` when the user types it; adding a capability means adding a class to the registry.
 */
export interface ICapability {
  readonly id: string;
  /** Slash command that selects this capability without asking the router, e.g. `/idea`. */
  readonly command: string;
  /** Shown to the router: when to choose this, with a few example requests. One line, under 1 KB. */
  readonly whenToUse: string;
  readonly model: CapabilityModel;
  /** Session instructions; the final value is always {"answer": "<markdown>"}. */
  instructions(): string;
  tools(context: CapabilityContext): IAgentToolCall;
}
