import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HttpController } from "../../transport/http/HttpController.js";
import type { RequestContextFactory } from "../../transport/http/RequestContextFactory.js";
import type { OpenRouterService } from "./OpenRouterService.js";

export class OpenRouterController implements HttpController {
  constructor(
    private readonly service: OpenRouterService,
    private readonly contexts: RequestContextFactory,
  ) {}
  register(routes: FastifyInstance): void {
    routes.get("/integrations/openrouter", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      return this.service.status(this.contexts.create(request));
    });
    routes.put<{ Body: { apiKey: string } }>(
      "/integrations/openrouter",
      {
        schema: {
          body: z
            .object({
              apiKey: z
                .string()
                .trim()
                .min(1)
                .max(512)
                .regex(/^[\x21-\x7e]+$/),
            })
            .strict(),
        },
      },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        return this.service.save(this.contexts.create(request), request.body.apiKey);
      },
    );
    routes.delete("/integrations/openrouter", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      return this.service.remove(this.contexts.create(request));
    });
    routes.get("/integrations/openrouter/models", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      return this.service.models(this.contexts.create(request));
    });
  }
}
