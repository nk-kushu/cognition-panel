import type {
  AgentConfiguration,
  SaveAgentDefinitionRequest,
  UpdateAgentSettingsRequest,
} from "@kushex/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HttpController } from "../../../transport/http/HttpController.js";
import type { RequestContextFactory } from "../../../transport/http/RequestContextFactory.js";
import { AgentName } from "../../agents/public.js";
import type { AgentConfigService } from "../application/AgentConfigService.js";

type AgentParams = { projectId: string; agentType: string };
type DefinitionParams = AgentParams & { id: string };

export class AgentConfigController implements HttpController {
  constructor(
    private readonly config: AgentConfigService,
    private readonly contexts: RequestContextFactory,
  ) {}

  register(routes: FastifyInstance): void {
    const agent = z.object({ projectId: z.uuid(), agentType: z.string().regex(AgentName.pattern) });
    const definition = agent.extend({ id: z.uuid() });
    const content = z.record(z.string(), z.json());
    const base = "/projects/:projectId/agents/:agentType";

    routes.get<{ Params: AgentParams }>(
      `${base}/settings`,
      { schema: { params: agent } },
      async (request, reply) => {
        const { projectId, agentType } = request.params;
        reply.header("Cache-Control", "no-store");
        return this.config.settings(this.contexts.create(request), projectId, agentType);
      },
    );
    routes.put<{ Params: AgentParams; Body: UpdateAgentSettingsRequest }>(
      `${base}/settings`,
      {
        schema: {
          params: agent,
          body: z.object({ settings: content, baseRevision: z.number().int().min(0) }).strict(),
        },
      },
      async (request, reply) => {
        const { projectId, agentType } = request.params;
        reply.header("Cache-Control", "no-store");
        return this.config.saveSettings(
          this.contexts.create(request),
          projectId,
          agentType,
          request.body.settings as AgentConfiguration,
          request.body.baseRevision,
        );
      },
    );
    routes.get<{ Params: AgentParams }>(
      `${base}/definitions`,
      { schema: { params: agent } },
      async (request, reply) => {
        const { projectId, agentType } = request.params;
        reply.header("Cache-Control", "no-store");
        return this.config.definitions(this.contexts.create(request), projectId, agentType);
      },
    );
    routes.post<{ Params: AgentParams; Body: SaveAgentDefinitionRequest }>(
      `${base}/definitions`,
      {
        schema: {
          params: agent,
          body: z
            .object({ kind: z.enum(["skill", "guard"]), enabled: z.boolean(), content })
            .strict(),
        },
      },
      async (request, reply) => {
        const { projectId, agentType } = request.params;
        reply.code(201).header("Cache-Control", "no-store");
        return this.config.createDefinition(
          this.contexts.create(request),
          projectId,
          agentType,
          request.body,
        );
      },
    );
    routes.put<{ Params: DefinitionParams; Body: Omit<SaveAgentDefinitionRequest, "kind"> }>(
      `${base}/definitions/:id`,
      {
        schema: {
          params: definition,
          body: z.object({ enabled: z.boolean(), content }).strict(),
        },
      },
      async (request, reply) => {
        const { projectId, agentType, id } = request.params;
        reply.header("Cache-Control", "no-store");
        return this.config.saveDefinition(
          this.contexts.create(request),
          projectId,
          agentType,
          id,
          request.body,
        );
      },
    );
    routes.delete<{ Params: DefinitionParams }>(
      `${base}/definitions/:id`,
      { schema: { params: definition } },
      async (request, reply) => {
        const { projectId, agentType, id } = request.params;
        await this.config.deleteDefinition(this.contexts.create(request), projectId, agentType, id);
        return reply.code(204).header("Cache-Control", "no-store").send();
      },
    );
  }
}
