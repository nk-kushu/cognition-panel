import type {
  AgentConfiguration,
  AgentDefinitionDto,
  AgentDefinitionKind,
  AgentSettingsDto,
  SaveAgentDefinitionRequest,
} from "@kushex/contracts";
import type { z } from "zod";
import { ConflictError } from "../../../errors/ConflictError.js";
import { NotFoundError } from "../../../errors/NotFoundError.js";
import { RequestValidationError } from "../../../errors/RequestValidationError.js";
import type { Prisma, PrismaClient } from "../../../generated/prisma/client.js";
import type { RequestContext } from "../../../shared/application/RequestContext.js";
import type { AgentHostContext } from "../../agent-runs/public.js";
import type { ChatThreads } from "../../chat-threads/ChatThreads.js";
import type { ProjectService } from "../../projects/public.js";
import {
  codingSettingsSchema,
  guardContentSchema,
  skillContentSchema,
} from "../domain/CodingConfigSchemas.js";
import type { ProjectMemoryService } from "./ProjectMemoryService.js";

/** Backend validation per agent type; other agents have no project settings yet. */
const SETTINGS: Readonly<Record<string, z.ZodType>> = { coding: codingSettingsSchema };
const CONTENT: Readonly<Record<AgentDefinitionKind, z.ZodType>> = {
  skill: skillContentSchema,
  guard: guardContentSchema,
};
const MAX_DEFINITIONS = 128;

/** Settings, skills and guards, always scoped by Kushex project ID and agent type. */
export class AgentConfigService implements AgentHostContext {
  constructor(
    private readonly db: PrismaClient,
    private readonly projects: ProjectService,
    private readonly memory: ProjectMemoryService,
    private readonly threads: ChatThreads,
  ) {}

  async settings(
    context: RequestContext,
    projectId: string,
    agentType: string,
  ): Promise<AgentSettingsDto> {
    await this.projects.find(context, projectId);
    const row = await this.db.agentProjectSettings.findUnique({
      where: { projectId_agentType: { projectId, agentType } },
    });
    return {
      settings: (row?.settings ?? {}) as AgentConfiguration,
      revision: row?.revision ?? 0,
    };
  }

  async saveSettings(
    context: RequestContext,
    projectId: string,
    agentType: string,
    settings: AgentConfiguration,
    baseRevision: number,
  ): Promise<AgentSettingsDto> {
    await this.projects.find(context, projectId);
    const value = this.validated(SETTINGS[agentType], settings, "settings");
    if (baseRevision === 0) {
      const created = await this.db.agentProjectSettings.createMany({
        data: { projectId, agentType, settings: value },
        skipDuplicates: true,
      });
      if (created.count === 0) throw new ConflictError("These settings changed; reload them.");
    } else {
      const { count } = await this.db.agentProjectSettings.updateMany({
        where: { projectId, agentType, revision: baseRevision },
        data: { settings: value, revision: { increment: 1 } },
      });
      if (count === 0) throw new ConflictError("These settings changed; reload them.");
    }
    return this.settings(context, projectId, agentType);
  }

  async definitions(
    context: RequestContext,
    projectId: string,
    agentType: string,
  ): Promise<readonly AgentDefinitionDto[]> {
    await this.projects.find(context, projectId);
    const rows = await this.db.agentDefinition.findMany({
      where: { projectId, agentType, deletedAt: null },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.flatMap((row) => {
      const version = row.versions[0];
      return version
        ? [
            {
              id: row.id,
              kind: row.kind,
              enabled: row.enabled,
              versionId: version.id,
              version: version.version,
              content: version.content as AgentConfiguration,
            },
          ]
        : [];
    });
  }

  async createDefinition(
    context: RequestContext,
    projectId: string,
    agentType: string,
    request: SaveAgentDefinitionRequest,
  ): Promise<AgentDefinitionDto> {
    await this.projects.find(context, projectId);
    const content = this.validated(CONTENT[request.kind], request.content, request.kind);
    const existing = await this.db.agentDefinition.count({
      where: { projectId, agentType, kind: request.kind, deletedAt: null },
    });
    if (existing >= MAX_DEFINITIONS)
      throw new ConflictError(`A project can have at most ${MAX_DEFINITIONS} of these.`);
    const row = await this.db.agentDefinition.create({
      data: {
        projectId,
        agentType,
        kind: request.kind,
        enabled: request.enabled,
        versions: { create: { version: 1, content } },
      },
    });
    return this.definition(context, projectId, agentType, row.id);
  }

  async saveDefinition(
    context: RequestContext,
    projectId: string,
    agentType: string,
    id: string,
    request: Omit<SaveAgentDefinitionRequest, "kind">,
  ): Promise<AgentDefinitionDto> {
    const current = await this.definition(context, projectId, agentType, id);
    const content = this.validated(CONTENT[current.kind], request.content, current.kind);
    await this.db.agentDefinition.update({
      where: { id },
      data: {
        enabled: request.enabled,
        // An unchanged definition keeps its version, so toggling does not fork history.
        ...(JSON.stringify(content) === JSON.stringify(current.content)
          ? {}
          : { versions: { create: { version: current.version + 1, content } } }),
      },
    });
    return this.definition(context, projectId, agentType, id);
  }

  /** Hides a definition from new runs; its versions stay for the history of past ones. */
  async deleteDefinition(
    context: RequestContext,
    projectId: string,
    agentType: string,
    id: string,
  ): Promise<void> {
    await this.definition(context, projectId, agentType, id);
    await this.db.agentDefinition.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /** Everything an agent run pins at launch, for this project and agent type only. */
  async load(
    context: RequestContext,
    projectId: string,
    agentName: string,
    threadId: string | undefined,
  ) {
    const [{ settings, revision }, definitions, memory, conversation] = await Promise.all([
      this.settings(context, projectId, agentName),
      this.definitions(context, projectId, agentName),
      this.memory.recall(context, projectId),
      threadId ? this.threads.conversation(context, projectId, threadId) : [],
    ]);
    const enabled = definitions.filter((item) => item.enabled);
    const pinned = (kind: AgentDefinitionKind) =>
      enabled
        .filter((item) => item.kind === kind)
        .map((item) => ({ ...item.content, id: item.id, versionId: item.versionId }));
    return {
      projectId,
      settings: revision === 0 ? null : settings,
      skills: pinned("skill"),
      // Guards saved before phases existed run where they always did.
      guards: pinned("guard").map((guard) => ({ phases: ["guards"], ...guard })),
      memory,
      conversation,
    };
  }

  private async definition(
    context: RequestContext,
    projectId: string,
    agentType: string,
    id: string,
  ): Promise<AgentDefinitionDto> {
    const found = (await this.definitions(context, projectId, agentType)).find(
      (item) => item.id === id,
    );
    if (!found) throw new NotFoundError("Definition not found.");
    return found;
  }

  private validated(
    schema: z.ZodType | undefined,
    value: unknown,
    label: string,
  ): Prisma.InputJsonValue {
    if (!schema)
      throw new RequestValidationError("body", [
        { path: label, message: `This agent has no ${label}.` },
      ]);
    const checked = schema.safeParse(value);
    if (!checked.success)
      throw new RequestValidationError(
        "body",
        checked.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      );
    return checked.data as Prisma.InputJsonValue;
  }
}
