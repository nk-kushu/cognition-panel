import type { JsonValue } from "kushibot";
import type { CognitionClient } from "./CognitionClient";
import { EVIDENCE_TYPES, sectionOf } from "./sections";
import type { IToolSet } from "./ToolBox";
import { ToolUseError } from "./ToolBox";

export const DOCUMENT_PART_CHARS = 20_000;

/** Per-run caps; a spent cap is reported to the model, which then has to finish. */
export type ResearchLimits = Readonly<{ documentParts: number; findings: number; links: number }>;
export const DEFAULT_RESEARCH_LIMITS: ResearchLimits = { documentParts: 30, findings: 40, links: 40 };

/** What the run did, for the final summary. */
export class RunTally {
  proposed: string[] = [];
  rejected = 0;
  links = 0;
}

/** Told to the model in the instructions; the ids must match `call`. */
export const RESEARCH_TOOL_DESCRIPTIONS = {
  research_overview: "research_overview {} — stage percents, failed checks, blockers and every finding (id, section, status, evidence, statement).",
  list_documents: "list_documents {} — the app's Knowledge documents: id, title, evidenceType, size.",
  read_document: 'read_document {"id":"<document id>","offset"?:0} — up to 20000 characters of the text from offset, with nextOffset (null at the end).',
  propose_finding:
    'propose_finding {"documentId":"…","section":"<section key>","statement":"…","quote":"<exact excerpt, 12-400 chars>","fact"?:{…},"headingPath"?:"…"} — files one fact for review. The quote must be copied exactly from the document.',
  link_findings: 'link_findings {"fromId":"<new finding id>","toId":"<known finding id>","kind":"supports"|"conflicts"} — relates two findings.',
  set_evidence_type:
    'set_evidence_type {"documentId":"…","evidenceType":"real_user_quote"|"competitor_data"|"ai_brainstorm"} — classifies a document whose evidenceType is still unknown.',
} as const;

export type ResearchToolId = keyof typeof RESEARCH_TOOL_DESCRIPTIONS;

type Overview = {
  stages: Array<{
    key: string;
    percent: number;
    checks: Array<{ id: string; label: string; passed: boolean; detail: string }>;
    blockers: Array<{ message: string }>;
    sections: Array<{ key: string; findings: Array<{ findingId: string; status: string; evidence: string; statement: string }> }>;
  }>;
  featuresToDrop: Array<{ title: string }>;
};

type Document = { id: string; title: string; evidenceType: string; contentMd: string };

/** Research reads and writes for one app, all through the cognition API. */
export class ResearchTools implements IToolSet {
  readonly ids: readonly ResearchToolId[];
  private readonly used = { documentParts: 0, findings: 0, links: 0 };

  constructor(
    private readonly client: Pick<CognitionClient, "get" | "post" | "patch">,
    private readonly appId: string,
    private readonly progress: (message: string) => void,
    readonly tally: RunTally,
    /** Which tools this capability may use; read-only capabilities leave out the writers. */
    ids: readonly ResearchToolId[],
    private readonly limits: ResearchLimits = DEFAULT_RESEARCH_LIMITS,
  ) {
    this.ids = ids;
  }

  async call(toolId: string, args: Record<string, unknown>): Promise<JsonValue> {
    switch (toolId as ResearchToolId) {
      case "research_overview":
        return this.overview();
      case "list_documents":
        return this.listDocuments();
      case "read_document":
        return this.readDocument(args);
      case "propose_finding":
        return this.proposeFinding(args);
      case "link_findings":
        return this.linkFindings(args);
      case "set_evidence_type":
        return this.setEvidenceType(args);
      default:
        throw new ToolUseError(`Unknown tool ${toolId}.`);
    }
  }

  private get app(): string {
    return `/local-apps/${encodeURIComponent(this.appId)}`;
  }

  async overview(): Promise<JsonValue> {
    this.progress("Reading the research stages");
    const overview = await this.client.get<Overview>(`${this.app}/research`);
    return {
      stages: overview.stages.map((stage) => ({
        stage: stage.key,
        percent: stage.percent,
        failedChecks: stage.checks.filter((check) => !check.passed).map((check) => ({ id: check.id, label: check.label, now: check.detail })),
        blockers: stage.blockers.map((blocker) => blocker.message),
      })),
      featuresToDrop: overview.featuresToDrop.map((feature) => feature.title),
      findings: overview.stages
        .flatMap((stage) => stage.sections.flatMap((section) => section.findings.map((finding) => ({ ...finding, section: section.key }))))
        .slice(0, 200)
        .map((finding) => ({ id: finding.findingId, section: finding.section, status: finding.status, evidence: finding.evidence, statement: finding.statement })),
    };
  }

  private async listDocuments(): Promise<JsonValue> {
    const documents = await this.client.get<Array<{ id: string; title: string; evidenceType: string; sourceKind: string; sizeBytes: number }>>(
      `${this.app}/knowledge/documents`,
    );
    return { documents: documents.map(({ id, title, evidenceType, sourceKind, sizeBytes }) => ({ id, title, evidenceType, sourceKind, sizeBytes })) };
  }

  private async readDocument(args: Record<string, unknown>): Promise<JsonValue> {
    const id = requiredString(args.id, "id");
    const offset = args.offset === undefined ? 0 : Number(args.offset);
    if (!Number.isInteger(offset) || offset < 0) throw new ToolUseError("offset must be a whole number ≥ 0.");
    this.spend("documentParts");
    const document = await this.client.get<Document>(`${this.app}/knowledge/documents/${encodeURIComponent(id)}`);
    const end = Math.min(document.contentMd.length, offset + DOCUMENT_PART_CHARS);
    this.progress(`Reading "${document.title}" (${offset}–${end} of ${document.contentMd.length})`);
    return {
      id: document.id,
      title: document.title,
      evidenceType: document.evidenceType,
      totalChars: document.contentMd.length,
      offset,
      text: document.contentMd.slice(offset, end),
      nextOffset: end < document.contentMd.length ? end : null,
    };
  }

  private async proposeFinding(args: Record<string, unknown>): Promise<JsonValue> {
    const section = sectionOf(args.section);
    if (!section) throw new ToolUseError(`Unknown section ${String(args.section)}. Use one of the section keys from the instructions.`);
    const documentId = requiredString(args.documentId, "documentId");
    const statement = requiredString(args.statement, "statement");
    const quote = requiredString(args.quote, "quote");
    if (statement.length > 500) throw new ToolUseError("statement must be 500 characters or less.");
    if (quote.length < 12 || quote.length > 500) throw new ToolUseError("quote must be 12–500 characters, copied exactly from the document.");
    const fact = args.fact === undefined || args.fact === null ? {} : args.fact;
    if (typeof fact !== "object" || Array.isArray(fact)) throw new ToolUseError("fact must be an object.");
    const headingPath = typeof args.headingPath === "string" ? args.headingPath.trim().slice(0, 300) : "";
    this.spend("findings");
    try {
      const finding = await this.client.post<{ id: string; status: string }>("/harness/findings", {
        appId: this.appId,
        statement,
        category: section.category,
        origin: "agent",
        researchSection: section.key,
        fact,
        citations: [{ documentId, quote, ...(headingPath ? { headingPath } : {}) }],
      });
      this.tally.proposed.push(finding.id);
      this.progress(`Proposed (${section.key}): ${statement.slice(0, 80)}`);
      return { id: finding.id, status: finding.status };
    } catch (error) {
      if (error instanceof ToolUseError) this.tally.rejected += 1;
      throw error;
    }
  }

  private async linkFindings(args: Record<string, unknown>): Promise<JsonValue> {
    const fromId = requiredString(args.fromId, "fromId");
    const toId = requiredString(args.toId, "toId");
    if (args.kind !== "supports" && args.kind !== "conflicts") throw new ToolUseError("kind must be supports or conflicts.");
    this.spend("links");
    await this.client.post(`/harness/findings/${encodeURIComponent(fromId)}/links`, { findingId: toId, kind: args.kind });
    this.tally.links += 1;
    return { linked: true };
  }

  private async setEvidenceType(args: Record<string, unknown>): Promise<JsonValue> {
    const documentId = requiredString(args.documentId, "documentId");
    if (!(EVIDENCE_TYPES as readonly unknown[]).includes(args.evidenceType))
      throw new ToolUseError(`evidenceType must be one of: ${EVIDENCE_TYPES.join(", ")}.`);
    const document = await this.client.get<Document>(`${this.app}/knowledge/documents/${encodeURIComponent(documentId)}`);
    if (document.evidenceType !== "unknown")
      throw new ToolUseError(`"${document.title}" is already ${document.evidenceType}; a person set it, so leave it.`);
    await this.client.patch(`${this.app}/research/documents/${encodeURIComponent(documentId)}/evidence-type`, { evidenceType: args.evidenceType });
    this.progress(`"${document.title}" is ${String(args.evidenceType)}`);
    return { evidenceType: args.evidenceType as string };
  }

  private spend(kind: keyof ResearchLimits): void {
    if (this.used[kind] >= this.limits[kind])
      throw new ToolUseError(`The ${kind} limit for this run (${this.limits[kind]}) is used up. Finish with what you have.`);
    this.used[kind] += 1;
  }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ToolUseError(`${name} is required.`);
  return value.trim();
}
