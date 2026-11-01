import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HttpController } from "../../../transport/http/HttpController.js";
import type { RequestContextFactory } from "../../../transport/http/RequestContextFactory.js";
import type { ProjectMemoryService } from "../application/ProjectMemoryService.js";

export class ProjectMemoryController implements HttpController {
  constructor(
    private readonly memory: ProjectMemoryService,
    private readonly contexts: RequestContextFactory,
  ) {}

  register(routes: FastifyInstance): void {
    const project = z.object({ projectId: z.uuid() });
    const entry = project.extend({ id: z.uuid() });
    const body = z.object({ statement: z.string().trim().min(1).max(1000) }).strict();
    routes.get<{ Params: { projectId: string } }>(
      "/projects/:projectId/memory",
      { schema: { params: project } },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        return this.memory.list(this.contexts.create(request), request.params.projectId);
      },
    );
    routes.post<{ Params: { projectId: string }; Body: { statement: string } }>(
      "/projects/:projectId/memory",
      { schema: { params: project, body } },
      async (request, reply) => {
        reply.code(201).header("Cache-Control", "no-store");
        return this.memory.add(
          this.contexts.create(request),
          request.params.projectId,
          request.body.statement,
        );
      },
    );
    routes.put<{ Params: { projectId: string; id: string }; Body: { statement: string } }>(
      "/projects/:projectId/memory/:id",
      { schema: { params: entry, body } },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        return this.memory.update(
          this.contexts.create(request),
          request.params.projectId,
          request.params.id,
          request.body.statement,
        );
      },
    );
    routes.delete<{ Params: { projectId: string; id: string } }>(
      "/projects/:projectId/memory/:id",
      { schema: { params: entry } },
      async (request, reply) => {
        await this.memory.remove(
          this.contexts.create(request),
          request.params.projectId,
          request.params.id,
        );
        return reply.code(204).header("Cache-Control", "no-store").send();
      },
    );
  }
}
