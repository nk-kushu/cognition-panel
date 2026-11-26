import type { JsonValue } from "kushibot";
import type { CognitionClient } from "./CognitionClient";
import { EVIDENCE_TYPES, sectionOf } from "./sections";
import type { IToolSet } from "./ToolBox";
import { ToolUseError } from "./ToolBox";

export const DOCUMENT_PART_CHARS = 20_000;

/** Per-run caps; a spent cap is reported to the model, which then has to finish. */
export type ResearchLimits = Readonly<{ documentParts: number; findings: number; links: number; planSaves: number }>;
export const DEFAULT_RESEARCH_LIMITS: ResearchLimits = { documentParts: 30, findings: 40, links: 40, planSaves: 3 };

/** What the run did, for the final summary. */
export class RunTally {
  proposed: string[] = [];
  rejected = 0;
  links = 0;
  /** The business plan version this run saved, if any. */
  planVersion: number | null = null;
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
    'set_evidence_type {"documentId":"…","evidenceType":"real_user_quote"|"official_source"|"competitor_data"|"ai_brainstorm"} — classifies a document whose evidenceType is still unknown.',
  read_idea: "read_idea {} — the app's idea: summary, problem, audience, monetization, constraints, assumptions, and whether it is clear.",
  business_plan_overview:
    "business_plan_overview {} — the current business plan version (blocks with statements and support, financial inputs, break-even per scenario) or null, and the nine block definitions with the research sections that feed them.",
  save_business_plan:
    'save_business_plan {"canvas":{…},"financials":{…}} — saves a new plan version. cognition refuses citations of findings that are not accepted and computes every number itself. Answers with readiness and break-even per scenario.',
} as const;

export type ResearchToolId = keyof typeof RESEARCH_TOOL_DESCRIPTIONS;

type Overview = {
  stages: Array<{
    key: string;
    percent: number;
    checks: Array<{ id: string; label: string; passed: boolean; detail: string }>;
    blockers: Array<{ message: string }>;
    sections: Array<{ key: string; findings: Array<{ findingId: string; status: string; evidence: string; statement: string; fact?: Record<string, unknown> }> }>;
  }>;
  featuresToDrop: Array<{ title: string }>;
};

type Document = { id: string; title: string; evidenceType: string; contentMd: string };

/** Research reads and writes for one app, all through the cognition API. */
export class ResearchTools implements IToolSet {
  readonly ids: readonly ResearchToolId[];
  private readonly used = { documentParts: 0, findings: 0, links: 0, planSaves: 0 };
  private readonly limits: ResearchLimits;

  constructor(
    private readonly client: Pick<CognitionClient, "get" | "post" | "patch">,
    private readonly appId: string,
    private readonly progress: (message: string) => void,
    readonly tally: RunTally,
    /** Which tools this capability may use; read-only capabilities leave out the writers. */
    ids: readonly ResearchToolId[],
    limits: Partial<ResearchLimits> = {},
  ) {
    this.ids = ids;
    this.limits = { ...DEFAULT_RESEARCH_LIMITS, ...limits };
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
      case "read_idea":
        return this.readIdea();
      case "business_plan_overview":
        return this.businessPlanOverview();
      case "save_business_plan":
        return this.saveBusinessPlan(args);
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
        .map((finding) => ({
          id: finding.findingId,
          section: finding.section,
          status: finding.status,
          evidence: finding.evidence,
          statement: finding.statement,
          // Structured numbers (prices, costs) the business plan reads; left out when empty.
          ...(finding.fact && Object.keys(finding.fact).length ? { fact: finding.fact as JsonValue } : {}),
        })),
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

  private async readIdea(): Promise<JsonValue> {
    const idea = await this.client.get<{ clear: boolean; missing: string[]; version: number; content: Record<string, unknown> }>(`${this.app}/idea`);
    return { clear: idea.clear, missing: idea.missing, version: idea.version, content: idea.content as JsonValue };
  }

  private async businessPlanOverview(): Promise<JsonValue> {
    this.progress("Reading the business plan");
    const overview = await this.client.get<{ plan: PlanView | null; versions: number; blocks: unknown }>(`${this.app}/business-plan`);
    return { versions: overview.versions, blocks: overview.blocks as JsonValue, plan: overview.plan ? summarizePlan(overview.plan) : null };
  }

  private async saveBusinessPlan(args: Record<string, unknown>): Promise<JsonValue> {
    if (typeof args.canvas !== "object" || args.canvas === null || typeof args.financials !== "object" || args.financials === null)
      throw new ToolUseError("save_business_plan needs canvas and financials objects.");
    this.spend("planSaves");
    const plan = await this.client.post<PlanView>(`${this.app}/business-plan/versions`, { canvas: args.canvas, financials: args.financials });
    this.tally.planVersion = plan.version;
    this.progress(`Saved business plan v${plan.version}: ${plan.readiness.confirmed} of ${plan.blocks.length} blocks confirmed`);
    return summarizePlan(plan);
  }

  private spend(kind: keyof ResearchLimits): void {
    if (this.used[kind] >= this.limits[kind])
      throw new ToolUseError(`The ${kind} limit for this run (${this.limits[kind]}) is used up. Finish with what you have.`);
    this.used[kind] += 1;
  }
}

type PlanView = {
  version: number;
  createdBy: string;
  readiness: { confirmed: number; hypothesis: number; missing: number };
  blocks: Array<{ key: string; status: string; statements: Array<{ text: string; support: string; citations: Array<{ findingId: string }> }>; gap: string | null }>;
  currency: string;
  inputs: Array<{ key: string; value: number; kind: string; source: string | null; note: string }>;
  scenarios: Array<{ key: string; breakEvenMonth: number | null; profitableMonth: number | null; months: Array<{ month: number; revenue: number; profit: number; cumulative: number }> }>;
};

/** The plan without the month-by-month table: what the model needs to judge and report. */
function summarizePlan(plan: PlanView): JsonValue {
  return {
    version: plan.version,
    createdBy: plan.createdBy,
    readiness: plan.readiness,
    blocks: plan.blocks.map((block) => ({
      key: block.key,
      status: block.status,
      gap: block.gap,
      statements: block.statements.map((statement) => ({ text: statement.text, support: statement.support, findingIds: statement.citations.map((citation) => citation.findingId) })),
    })),
    currency: plan.currency,
    inputs: plan.inputs.map(({ key, value, kind, source, note }) => ({ key, value, kind, source, note })),
    scenarios: plan.scenarios.map((scenario) => {
      const month12 = scenario.months[11];
      return { key: scenario.key, breakEvenMonth: scenario.breakEvenMonth, profitableMonth: scenario.profitableMonth, month12Revenue: month12?.revenue ?? null, month24Cumulative: scenario.months.at(-1)?.cumulative ?? null };
    }),
  };
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ToolUseError(`${name} is required.`);
  return value.trim();
}
