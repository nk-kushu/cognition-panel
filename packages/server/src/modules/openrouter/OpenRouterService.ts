import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client.js";
import type { RequestContext } from "../../shared/application/RequestContext.js";
import { HttpError } from "../../errors/HttpError.js";
import type { SecretCipher } from "./SecretCipher.js";

const catalog = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1).max(240),
      name: z.string(),
      context_length: z.number().int().positive(),
      architecture: z.object({ output_modalities: z.array(z.string()) }),
      top_provider: z
        .object({ max_completion_tokens: z.number().int().positive().nullable().optional() })
        .optional(),
    }),
  ),
});

export class OpenRouterService {
  constructor(
    private readonly db: PrismaClient,
    private readonly cipher: SecretCipher,
    private readonly http: typeof fetch,
  ) {}

  async status(context: RequestContext) {
    const row = await this.db.openRouterCredential.findUnique({
      where: { actorId: context.actor.id },
      select: { updatedAt: true },
    });
    return { configured: !!row, updatedAt: row?.updatedAt.toISOString() ?? null };
  }

  async save(context: RequestContext, apiKey: string) {
    const encryptedKey = this.cipher.encrypt(apiKey);
    await this.db.openRouterCredential.upsert({
      where: { actorId: context.actor.id },
      create: { actorId: context.actor.id, encryptedKey },
      update: { encryptedKey },
    });
    return this.status(context);
  }

  async remove(context: RequestContext) {
    await this.db.openRouterCredential.deleteMany({ where: { actorId: context.actor.id } });
    return { configured: false, updatedAt: null };
  }

  /** Only used for the private runner IPC payload; never a public DTO or pinned setting. */
  async credentials(context: RequestContext): Promise<Record<string, string>> {
    const row = await this.db.openRouterCredential.findUnique({
      where: { actorId: context.actor.id },
    });
    return row ? { openrouter: this.cipher.decrypt(row.encryptedKey) } : {};
  }

  async models(context: RequestContext) {
    const keys = await this.credentials(context);
    if (!keys.openrouter)
      throw new HttpError(409, "OPENROUTER_KEY_REQUIRED", "Save an OpenRouter API key first.");
    let response: Response;
    try {
      response = await this.http("https://openrouter.ai/api/v1/models", {
        headers: { Authorization: `Bearer ${keys.openrouter}` },
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
    } catch {
      throw new HttpError(502, "OPENROUTER_UNAVAILABLE", "Could not reach OpenRouter. Try again.");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(
        502,
        "OPENROUTER_UNAVAILABLE",
        `OpenRouter model lookup failed (HTTP ${response.status}). Check your API key and try again.`,
      );
    }
    const parsed = catalog.safeParse(await response.json().catch(() => null));
    if (!parsed.success)
      throw new HttpError(
        502,
        "OPENROUTER_INVALID_RESPONSE",
        "OpenRouter returned an invalid model catalog.",
      );
    return parsed.data.data
      .filter(
        (model) =>
          model.architecture.output_modalities.includes("text") &&
          /^[a-zA-Z0-9_.:/-]{1,128}$/.test(model.id),
      )
      .map((model) => ({
        id: model.id,
        name: model.name,
        contextTokens: model.context_length,
        maxOutputTokens:
          model.top_provider?.max_completion_tokens ?? Math.min(4096, model.context_length),
      }));
  }
}
