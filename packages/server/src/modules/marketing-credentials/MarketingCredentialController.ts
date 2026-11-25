import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HttpController } from "../../transport/http/HttpController.js";
import type { RequestContextFactory } from "../../transport/http/RequestContextFactory.js";
import type { MarketingCredentialService } from "./MarketingCredentialService.js";

export class MarketingCredentialController implements HttpController {
  constructor(
    private readonly service: MarketingCredentialService,
    private readonly contexts: RequestContextFactory,
  ) {}
  register(routes: FastifyInstance): void {
    routes.get("/integrations/marketing", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      return this.service.status(this.contexts.create(request));
    });
    routes.put<{ Params: { name: string }; Body: { value: string } }>(
      "/integrations/marketing/:name",
      {
        schema: {
          body: z
            .object({
              value: z
                .string()
                .trim()
                .min(1)
                .max(2048)
                .regex(/^[\x21-\x7e]+$/),
            })
            .strict(),
        },
      },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        return this.service.save(this.contexts.create(request), request.params.name, request.body.value);
      },
    );
    routes.delete<{ Params: { name: string } }>("/integrations/marketing/:name", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      return this.service.remove(this.contexts.create(request), request.params.name);
    });
  }
}
