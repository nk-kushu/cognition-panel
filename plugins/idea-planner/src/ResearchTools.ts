import type { IAgentToolCall, JsonValue, ToolCallRequest, ToolDispatchOutcome } from "kushibot";
import type { CognitionApi, CognitionApp } from "./CognitionApi";

/** Research notes are app notes whose title starts with this; the research capability saves them so. */
export const RESEARCH_NOTE_PREFIX = "Research:";

const MAX_SEARCHES = 6;
const MAX_READS = 8;
const MAX_NOTE_CHARS = 12_000;

export const RESEARCH_TOOL_DESCRIPTIONS = [
  `web_search {"query":"<search terms>"} — public web search; returns titles, URLs and snippets. At most ${MAX_SEARCHES} per run.`,
  `read_page {"url":"<http(s) URL from a search result>"} — the readable text of one public page. At most ${MAX_READS} per run.`,
];

export const RESEARCH_NOTES_TOOL_DESCRIPTION =
  "read_research_notes {} — earlier research about this app's domain (notes titled \"Research: …\"). Empty outside an app.";

/** A set of tools, each answering a fixed set of tool ids. Unknown ids come back as an error to the model. */
export interface IToolSet {
  readonly ids: readonly string[];
  call(toolId: string, args: Record<string, unknown>): Promise<JsonValue>;
}

/** Bad arguments or a spent budget: reported back to the model so it can adjust. */
export class ToolUseError extends Error {}

/** Dispatches each tool call to the set that owns its id. */
export class ToolBox implements IAgentToolCall {
  constructor(private readonly sets: readonly IToolSet[]) {}

  async dispatch(request: ToolCallRequest): Promise<ToolDispatchOutcome> {
    const args = (typeof request.arguments === "object" && request.arguments !== null ? request.arguments : {}) as Record<string, unknown>;
    const owner = this.sets.find((set) => set.ids.includes(request.toolId));
    let value: JsonValue;
    try {
      if (!owner) throw new ToolUseError(`Unknown tool ${request.toolId}. Available: ${this.sets.flatMap((set) => set.ids).join(", ")}.`);
      value = await owner.call(request.toolId, args);
    } catch (error) {
      if (!(error instanceof ToolUseError)) throw error;
      value = { error: error.message };
    }
    return {
      status: "completed",
      replayed: false,
      observation: { operationId: request.operationId, toolId: request.toolId, toolVersion: "1", value },
    };
  }
}

/** Web search and page reading through the cognition API, with a per-run budget. */
export class WebResearchTools implements IToolSet {
  readonly ids = ["web_search", "read_page"];
  private searches = 0;
  private reads = 0;

  constructor(
    private readonly api: CognitionApi,
    private readonly progress: (message: string) => void,
  ) {}

  async call(toolId: string, args: Record<string, unknown>): Promise<JsonValue> {
    if (toolId === "web_search") {
      if (typeof args.query !== "string" || args.query.trim().length < 2) throw new ToolUseError("query is required.");
      if (++this.searches > MAX_SEARCHES) throw new ToolUseError(`Search budget spent (${MAX_SEARCHES}). Write the answer from what you have.`);
      this.progress(`Searching: ${args.query.trim()}`);
      return (await this.api.search(args.query.trim())) as JsonValue;
    }
    if (typeof args.url !== "string" || !/^https?:\/\//i.test(args.url)) throw new ToolUseError("url must be an http(s) URL.");
    if (++this.reads > MAX_READS) throw new ToolUseError(`Reading budget spent (${MAX_READS}). Write the answer from what you have.`);
    this.progress(`Reading: ${args.url}`);
    return (await this.api.read(args.url)) as JsonValue;
  }
}

/** Earlier research notes of the chat's app, so planning builds on what was learned. */
export class ResearchNotesTools implements IToolSet {
  readonly ids = ["read_research_notes"];

  constructor(
    private readonly api: CognitionApi,
    private readonly app: CognitionApp | null,
  ) {}

  async call(): Promise<JsonValue> {
    if (!this.app) return { notes: [], info: "The chat is not open in an app, so there are no research notes." };
    const notes = (await this.api.notes(this.app.id)).filter((note) => note.title.startsWith(RESEARCH_NOTE_PREFIX));
    return {
      notes: notes.map((note) => ({
        title: note.title,
        updatedAt: note.updatedAt,
        contentMd: note.contentMd.length > MAX_NOTE_CHARS ? `${note.contentMd.slice(0, MAX_NOTE_CHARS)}\n…[truncated]` : note.contentMd,
      })),
    };
  }
}
