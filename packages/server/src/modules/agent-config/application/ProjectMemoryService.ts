import { randomUUID } from "node:crypto";
import type { ProjectMemoryDto } from "@kushex/contracts";
import {
  JsonRecordCodec,
  JsonValueContract,
  MemoryEvidenceVerifier,
  MemoryProposalContract,
  MemoryRecordContract,
  MemoryRetrievalService,
  SqlAgentMemoryStore,
  postgresqlMemoryStatements,
  type IExecutionContext,
  type ISqlDatabase,
  type MemoryRecord,
} from "kushibot";
import { NotFoundError } from "../../../errors/NotFoundError.js";
import type { RequestContext } from "../../../shared/application/RequestContext.js";
import type { ProjectService } from "../../projects/public.js";

const TOPIC = "preferences";
const PAGE = 32;
const MAX_MEMORIES = 512;
/** Preferences last until removed; the library requires an expiry. */
const LIFETIME_MS = 100 * 365 * 24 * 60 * 60_000;
const clock = { nowEpochMs: () => Date.now() };

/**
 * Long-term preferences in kushibot's memory store, in PostgreSQL. The authorized project ID
 * is the memory scope, so a project can only ever read its own records. A memory exists only
 * because a user saved it, so its text is its own source.
 */
export class ProjectMemoryService {
  private readonly initialized = new Set<string>();

  constructor(
    private readonly database: ISqlDatabase,
    private readonly projects: ProjectService,
  ) {}

  async list(context: RequestContext, projectId: string): Promise<readonly ProjectMemoryDto[]> {
    const store = await this.store(context, projectId);
    return (await this.accepted(store)).map((record) => this.toDto(record));
  }

  /** What recall returns to a run: verified, current records of this project only. */
  async recall(context: RequestContext, projectId: string) {
    const store = await this.store(context, projectId);
    const json = new JsonValueContract();
    const retrieval = new MemoryRetrievalService(
      store,
      new MemoryEvidenceVerifier(
        store,
        {
          read: async (source) => {
            const record = await store.get(source.sourceRef.replace(/^user:/, ""));
            return record
              ? {
                  status: "current",
                  source,
                  text: record.proposal.statement,
                  verificationRef: `user-saved:${record.proposal.id}`,
                  validUntilEpochMs: record.proposal.expiresAtEpochMs,
                }
              : { status: "unavailable" };
          },
        },
        json,
        clock,
      ),
      clock,
    );
    const execution: IExecutionContext = {
      identity: { operationId: randomUUID() },
      scope: store.scope,
      signal: new AbortController().signal,
      deadlineEpochMs: null,
      reporter: { progress: async () => undefined },
    };
    const memories: { id: string; statement: string }[] = [];
    let after: string | null = null;
    do {
      const outcome = await retrieval.retrieve(TOPIC, after, PAGE, execution);
      memories.push(
        ...outcome.items.map(({ record }) => ({
          id: record.proposal.id,
          statement: record.proposal.statement,
        })),
      );
      after = outcome.nextAfterId;
    } while (after !== null && memories.length < MAX_MEMORIES);
    return memories;
  }

  async add(
    context: RequestContext,
    projectId: string,
    statement: string,
  ): Promise<ProjectMemoryDto> {
    const store = await this.store(context, projectId);
    const id = randomUUID();
    const now = clock.nowEpochMs();
    const proposed = await store.propose({
      id,
      scope: store.scope,
      topic: TOPIC,
      statement,
      source: { sourceRef: `user:${id}`, revisionRef: "saved-by-user" },
      createdAtEpochMs: now,
      expiresAtEpochMs: now + LIFETIME_MS,
    });
    return this.toDto(
      await store.decide(id, proposed.revision, {
        status: "accepted",
        verificationRef: `user-saved:${id}`,
        validatedAtEpochMs: now,
        validUntilEpochMs: now + LIFETIME_MS,
      }),
    );
  }

  /** Records are immutable, so an edit replaces one with another. */
  async update(
    context: RequestContext,
    projectId: string,
    id: string,
    statement: string,
  ): Promise<ProjectMemoryDto> {
    await this.remove(context, projectId, id, "SUPERSEDED");
    return this.add(context, projectId, statement);
  }

  async remove(
    context: RequestContext,
    projectId: string,
    id: string,
    code: "SUPERSEDED" | "USER_REVOKED" = "USER_REVOKED",
  ): Promise<void> {
    const store = await this.store(context, projectId);
    const record = await store.get(id);
    if (!record || record.invalidation) throw new NotFoundError("Memory not found.");
    await store.invalidate(id, record.revision, {
      commandId: randomUUID(),
      code,
      atEpochMs: clock.nowEpochMs(),
    });
  }

  private async accepted(store: SqlAgentMemoryStore): Promise<readonly MemoryRecord[]> {
    const records: MemoryRecord[] = [];
    let after: string | null = null;
    for (;;) {
      const page: readonly MemoryRecord[] = await store.listAccepted(TOPIC, after, PAGE);
      records.push(...page);
      if (page.length < PAGE || records.length >= MAX_MEMORIES) return records;
      after = page.at(-1)!.proposal.id;
    }
  }

  /** The project lookup is what enforces access; it throws for another actor's project. */
  private async store(context: RequestContext, projectId: string): Promise<SqlAgentMemoryStore> {
    await this.projects.find(context, projectId);
    const json = new JsonValueContract();
    const store = new SqlAgentMemoryStore(
      this.database,
      postgresqlMemoryStatements,
      new JsonRecordCodec(
        new MemoryRecordContract(json, new MemoryProposalContract(json, LIFETIME_MS)),
        json,
        16_384,
      ),
      { scopeId: projectId, projectId },
    );
    if (!this.initialized.has(projectId)) {
      await store.initialize();
      this.initialized.add(projectId);
    }
    return store;
  }

  private toDto(record: MemoryRecord): ProjectMemoryDto {
    return {
      id: record.proposal.id,
      statement: record.proposal.statement,
      createdAt: new Date(record.proposal.createdAtEpochMs).toISOString(),
    };
  }
}
