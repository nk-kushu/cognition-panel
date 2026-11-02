import { z } from "zod";
import { RequestValidationError } from "../../errors/RequestValidationError.js";
import type { FastifyRequest } from "fastify";
import type { RequestContext } from "../../shared/application/RequestContext.js";
import type { ActorResolver } from "./ActorResolver.js";

export class RequestContextFactory {
  constructor(private readonly actors: ActorResolver) {}
  create(request: FastifyRequest): RequestContext {
    const workspaceId = request.headers["x-workspace-id"];
    if (workspaceId !== undefined && !z.uuid().safeParse(workspaceId).success)
      throw new RequestValidationError("headers", [
        { path: "x-workspace-id", message: "Must be a workspace UUID." },
      ]);
    return {
      ...(typeof workspaceId === "string" ? { workspaceId } : {}),
      requestId: request.id,
      actor: this.actors.resolve(request),
    };
  }
}
