import type {
  AgentConfiguration,
  AgentRunDto,
  AgentWaitDto,
  AgentWaitKind,
  AnswerAgentWaitRequest,
} from "@kushex/contracts";
import { z } from "zod";
import { ConflictError } from "../../../errors/ConflictError.js";
import { NotFoundError } from "../../../errors/NotFoundError.js";
import { RequestValidationError } from "../../../errors/RequestValidationError.js";
import type { AgentRunWait, Prisma, PrismaClient } from "../../../generated/prisma/client.js";
import type { Logger } from "../../../shared/application/Logger.js";
import type { RequestContext } from "../../../shared/application/RequestContext.js";
import type { ProjectService } from "../../projects/public.js";
import type { AgentRun } from "./AgentRun.js";
import type { AgentRunService, AgentWaitRecorder } from "./AgentRunService.js";

/** What a run's result carries when it stops to ask; agent output, so it is validated. */
const reportedWait = z.object({
  presentation: z.literal("wait"),
  wait: z.object({
    id: z.string().min(1).max(120),
    kind: z.enum(["clarification", "decision", "skeleton-review"]),
    agentRunRef: z.string().min(1).max(120),
    payload: z.record(z.string(), z.json()),
  }),
});

const choices = z.array(z.object({ label: z.string(), packages: z.array(z.string()) }).loose());
const REVIEW_CHOICES = new Set(["approve", "request-changes", "change-plan"]);

/** Durable human requests: saves them, shows them, and resumes the run with the answer. */
export class AgentWaits implements AgentWaitRecorder {
  private runs: AgentRunService | null = null;
  private readonly saves = new Map<string, Promise<void>>();

  constructor(
    private readonly db: PrismaClient,
    private readonly projects: ProjectService,
    private readonly memory: Readonly<{
      add(context: RequestContext, projectId: string, statement: string): Promise<unknown>;
    }>,
    private readonly logger: Logger,
  ) {}

  /** The two depend on each other: runs report waits, and answers launch runs. */
  attach(runs: AgentRunService): void {
    this.runs = runs;
  }

  capture(run: AgentRun, threadId: string | undefined): void {
    run.subscribe(-1, {
      event: ({ event }) => {
        if (event.type !== "result") return;
        const reported = reportedWait.safeParse(event.value);
        if (!reported.success) return;
        const { wait } = reported.data;
        const save = this.db.agentRunWait
          .create({
            data: {
              id: run.id,
              projectId: run.projectId,
              workspaceId: run.workspaceId ?? null,
              actorId: run.actorId,
              agentName: run.agentName,
              threadId: threadId ?? null,
              agentRunRef: wait.agentRunRef,
              waitRef: wait.id,
              kind: wait.kind,
              payload: wait.payload as Prisma.InputJsonValue,
            },
          })
          .then(() => undefined)
          .catch((error: unknown) => {
            this.logger.error({ err: error, runId: run.id }, "Failed to save an agent wait.");
          })
          .finally(() => this.saves.delete(run.id));
        this.saves.set(run.id, save);
      },
      end: () => undefined,
    });
  }

  async find(context: RequestContext, projectId: string, runId: string): Promise<AgentWaitDto> {
    return this.toDto(await this.row(context, projectId, runId));
  }

  /**
   * Validates against what was actually asked, then claims the wait so that two answers
   * cannot both resume the run. Packages come from the stored choice, never from the client.
   */
  async answer(
    context: RequestContext,
    projectId: string,
    runId: string,
    request: AnswerAgentWaitRequest,
  ): Promise<AgentRunDto> {
    const wait = await this.row(context, projectId, runId);
    if (wait.status !== "pending") throw new ConflictError("This request was already answered.");
    const packages = this.validate(wait, request);
    const answer = {
      waitId: wait.waitRef,
      choice: request.choice,
      text: request.text,
      digest: request.digest ?? "",
      packages,
    };
    const { count } = await this.db.agentRunWait.updateMany({
      where: { id: wait.id, status: "pending" },
      data: { status: "answered", response: answer, answeredAt: new Date() },
    });
    if (count === 0) throw new ConflictError("This request was already answered.");
    if (request.remember) await this.memory.add(context, projectId, request.remember);
    if (!this.runs) throw new Error("Agent runs are unavailable.");
    return this.runs.launch(
      { ...context, ...(wait.workspaceId ? { workspaceId: wait.workspaceId } : {}) },
      projectId,
      {
        agentName: wait.agentName,
        ...(wait.threadId ? { threadId: wait.threadId } : {}),
        message: this.describe(wait, request),
        files: [],
        debug: false,
      },
      { runId: wait.agentRunRef, answer },
    );
  }

  async cancel(context: RequestContext, projectId: string, runId: string): Promise<void> {
    const wait = await this.row(context, projectId, runId);
    const { count } = await this.db.agentRunWait.updateMany({
      where: { id: wait.id, status: "pending" },
      data: { status: "cancelled", answeredAt: new Date() },
    });
    if (count === 0) throw new ConflictError("This request was already answered.");
  }

  private validate(wait: AgentRunWait, request: AnswerAgentWaitRequest): readonly string[] {
    const payload = wait.payload as Record<string, unknown>;
    if (wait.kind === "skeleton-review") {
      if (!REVIEW_CHOICES.has(request.choice))
        throw this.invalid("choice", "Choose approve, request-changes or change-plan.");
      if (request.choice === "approve" && request.digest !== payload.digest)
        throw new ConflictError("This is not the version under review; reload it.");
      if (request.choice !== "approve" && !request.text.trim())
        throw this.invalid("text", "Say what should change.");
      return [];
    }
    const offered = choices.parse(payload.choices ?? []);
    const chosen = offered.find((choice) => choice.label === request.choice);
    if (request.choice && !chosen) throw this.invalid("choice", "Pick one of the options.");
    if (!request.choice && !request.text.trim())
      throw this.invalid("text", "Pick an option or write an answer.");
    return chosen?.packages ?? [];
  }

  private invalid(path: string, message: string): RequestValidationError {
    return new RequestValidationError("body", [{ path, message }]);
  }

  private describe(wait: AgentRunWait, request: AnswerAgentWaitRequest): string {
    if (wait.kind === "skeleton-review")
      return request.choice === "approve"
        ? "Approved the skeleton."
        : `Requested changes: ${request.text}`.slice(0, 8000);
    return [request.choice, request.text].filter(Boolean).join(": ").slice(0, 8000);
  }

  private async row(
    context: RequestContext,
    projectId: string,
    runId: string,
  ): Promise<AgentRunWait> {
    await this.projects.find(context, projectId);
    await this.saves.get(runId);
    const wait = await this.db.agentRunWait.findFirst({
      where: { id: runId, projectId, actorId: context.actor.id },
    });
    if (!wait) throw new NotFoundError("Request not found.");
    return wait;
  }

  private toDto(wait: AgentRunWait): AgentWaitDto {
    return {
      runId: wait.id,
      kind: wait.kind as AgentWaitKind,
      status: wait.status,
      payload: wait.payload as AgentConfiguration,
      response: (wait.response ?? null) as AgentConfiguration | null,
    };
  }
}
