import { describe, expect, it } from "vitest";
import { pino } from "pino";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { HttpServer } from "../../transport/http/HttpServer.js";
import { ErrorResponder } from "../../transport/http/ErrorResponder.js";
import { RequestContextFactory } from "../../transport/http/RequestContextFactory.js";
import { LocalOperatorActorResolver } from "../../transport/http/LocalOperatorActorResolver.js";
import { LocalRequestGuard } from "../../transport/http/LocalRequestGuard.js";
import { OpenRouterController } from "./OpenRouterController.js";
import { OpenRouterService } from "./OpenRouterService.js";
import { SecretCipher } from "./SecretCipher.js";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");

describe("OpenRouter credentials", () => {
  it("encrypts with fresh nonces and rejects tampering or a wrong master key", () => {
    const cipher = new SecretCipher(encryptionKey);
    const encrypted = cipher.encrypt("sk-or-secret");
    expect(encrypted).not.toContain("sk-or-secret");
    expect(cipher.encrypt("sk-or-secret")).not.toBe(encrypted);
    expect(cipher.decrypt(encrypted)).toBe("sk-or-secret");
    expect(() =>
      new SecretCipher(Buffer.alloc(32, 8).toString("base64")).decrypt(encrypted),
    ).toThrow();
    expect(() => cipher.decrypt(encrypted.slice(0, -4) + "AAAA")).toThrow();
    expect(() => new SecretCipher(undefined).encrypt("secret")).toThrow(
      /KUSHEX_CREDENTIAL_ENCRYPTION_KEY/,
    );
  });

  it("stores encrypted keys, exposes only status, validates input and removes the credential over HTTP", async () => {
    const rows = new Map<string, { actorId: string; encryptedKey: string; updatedAt: Date }>();
    const db = {
      openRouterCredential: {
        findUnique: async ({ where }: { where: { actorId: string } }) =>
          rows.get(where.actorId) ?? null,
        upsert: async ({ create }: { create: { actorId: string; encryptedKey: string } }) =>
          rows.set(create.actorId, { ...create, updatedAt: new Date() }),
        deleteMany: async ({ where }: { where: { actorId: string } }) => rows.delete(where.actorId),
      },
    } as unknown as PrismaClient;
    const service = new OpenRouterService(
      db,
      new SecretCipher(encryptionKey),
      async (_url, init) => {
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-or-secret");
        return Response.json({
          data: [
            {
              id: "vendor/code",
              name: "Code",
              context_length: 32000,
              architecture: { output_modalities: ["text"] },
            },
            {
              id: "vendor/image",
              name: "Image",
              context_length: 1000,
              architecture: { output_modalities: ["image"] },
            },
          ],
        });
      },
    );
    const logger = pino({ level: "silent" });
    const server = new HttpServer(
      { host: "127.0.0.1", port: 0 },
      logger,
      new ErrorResponder(logger),
      [
        new OpenRouterController(
          service,
          new RequestContextFactory(new LocalOperatorActorResolver()),
        ),
      ],
      new LocalRequestGuard([]),
    );
    await server.start();
    const base = `http://127.0.0.1:${server.port}/integrations/openrouter`;
    const mutate = (method: string, body: object) =>
      fetch(base, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    try {
      expect(await (await fetch(base)).json()).toEqual({ configured: false, updatedAt: null });
      expect((await mutate("PUT", { apiKey: "" })).status).toBe(400);
      const saved = await mutate("PUT", { apiKey: "sk-or-secret" });
      expect(saved.status).toBe(200);
      expect(await saved.json()).toMatchObject({ configured: true });
      expect(JSON.stringify([...rows.values()])).not.toContain("sk-or-secret");
      expect(
        await service.credentials({ actor: { id: "other" } } as Parameters<
          typeof service.credentials
        >[0]),
      ).toEqual({});
      const models = await fetch(`${base}/models`);
      expect(await models.json()).toEqual([
        { id: "vendor/code", name: "Code", contextTokens: 32000, maxOutputTokens: 4096 },
      ]);
      expect(await (await mutate("DELETE", {})).json()).toEqual({
        configured: false,
        updatedAt: null,
      });
      expect((await fetch(`${base}/models`)).status).toBe(409);
    } finally {
      await server.stop(new AbortController().signal);
    }
  });
});
