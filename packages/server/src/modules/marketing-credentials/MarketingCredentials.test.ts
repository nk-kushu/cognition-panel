import { describe, expect, it } from "vitest";
import { pino } from "pino";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { HttpServer } from "../../transport/http/HttpServer.js";
import { ErrorResponder } from "../../transport/http/ErrorResponder.js";
import { RequestContextFactory } from "../../transport/http/RequestContextFactory.js";
import { LocalOperatorActorResolver } from "../../transport/http/LocalOperatorActorResolver.js";
import { LocalRequestGuard } from "../../transport/http/LocalRequestGuard.js";
import { SecretCipher } from "../openrouter/SecretCipher.js";
import { MarketingCredentialController } from "./MarketingCredentialController.js";
import { MARKETING_CREDENTIAL_NAMES, MarketingCredentialService } from "./MarketingCredentialService.js";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");

type Row = { actorId: string; name: string; encryptedValue: string; updatedAt: Date };

/** The three Prisma calls the service makes, over a map keyed like the table's primary key. */
function fakeDb(rows = new Map<string, Row>()) {
  const key = (actorId: string, name: string) => `${actorId}\u0000${name}`;
  const db = {
    marketingCredential: {
      findMany: async ({ where }: { where: { actorId: string } }) => [...rows.values()].filter((row) => row.actorId === where.actorId),
      upsert: async ({ where, create, update }: { where: { actorId_name: { actorId: string; name: string } }; create: Omit<Row, "updatedAt">; update: { encryptedValue: string } }) => {
        const id = key(where.actorId_name.actorId, where.actorId_name.name);
        rows.set(id, { ...(rows.get(id) ?? create), ...update, updatedAt: new Date() });
      },
      deleteMany: async ({ where }: { where: { actorId: string; name: string } }) => rows.delete(key(where.actorId, where.name)),
    },
  } as unknown as PrismaClient;
  return { rows, db };
}

const asActor = (id: string) => ({ actor: { id } }) as Parameters<MarketingCredentialService["credentials"]>[0];

describe("marketing credentials", () => {
  it("encrypts each value, keeps operators apart and hands only known names to the agents", async () => {
    const { rows, db } = fakeDb();
    const service = new MarketingCredentialService(db, new SecretCipher(encryptionKey));
    await service.save(asActor("me"), "TAVILY_API_KEY", "tvly-secret");
    await service.save(asActor("me"), "DATAFORSEO_LOGIN", "me@example.com");
    await service.save(asActor("me"), "TAVILY_API_KEY", "tvly-replaced");

    expect(JSON.stringify([...rows.values()])).not.toContain("tvly");
    expect(await service.credentials(asActor("me"))).toEqual({ TAVILY_API_KEY: "tvly-replaced", DATAFORSEO_LOGIN: "me@example.com" });
    expect(await service.credentials(asActor("someone-else"))).toEqual({});

    // A row for a name that is no longer on the list is never passed on.
    rows.set("x", { actorId: "me", name: "SOMETHING_ELSE", encryptedValue: new SecretCipher(encryptionKey).encrypt("nope"), updatedAt: new Date() });
    expect(Object.keys(await service.credentials(asActor("me"))).sort()).toEqual(["DATAFORSEO_LOGIN", "TAVILY_API_KEY"]);
  });

  it("refuses names that are not market-source settings", async () => {
    const service = new MarketingCredentialService(fakeDb().db, new SecretCipher(encryptionKey));
    await expect(service.save(asActor("me"), "AWS_SECRET_ACCESS_KEY", "x")).rejects.toThrow(/Unknown setting/);
    await expect(service.remove(asActor("me"), "constructor")).rejects.toThrow(/Unknown setting/);
  });

  it("serves status without values, validates input and removes a value over HTTP", async () => {
    const { rows, db } = fakeDb();
    const service = new MarketingCredentialService(db, new SecretCipher(encryptionKey));
    const logger = pino({ level: "silent" });
    const server = new HttpServer(
      { host: "127.0.0.1", port: 0 },
      logger,
      new ErrorResponder(logger),
      [new MarketingCredentialController(service, new RequestContextFactory(new LocalOperatorActorResolver()))],
      new LocalRequestGuard([]),
    );
    await server.start();
    const base = `http://127.0.0.1:${server.port}/integrations/marketing`;
    const send = (method: string, name: string, body?: object) =>
      fetch(`${base}/${name}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
    try {
      const empty = (await (await fetch(base)).json()) as { credentials: Array<{ name: string; configured: boolean }> };
      expect(empty.credentials.map((entry) => entry.name)).toEqual([...MARKETING_CREDENTIAL_NAMES]);
      expect(empty.credentials.every((entry) => !entry.configured)).toBe(true);

      expect((await send("PUT", "TAVILY_API_KEY", { value: "" })).status).toBe(400);
      expect((await send("PUT", "TAVILY_API_KEY", { value: "has space" })).status).toBe(400);
      expect((await send("PUT", "NOT_A_SETTING", { value: "x" })).status).toBe(400);

      const saved = await send("PUT", "TAVILY_API_KEY", { value: "tvly-secret" });
      expect(saved.status).toBe(200);
      const status = await saved.text();
      expect(status).not.toContain("tvly-secret");
      expect(JSON.parse(status).credentials.find((entry: { name: string }) => entry.name === "TAVILY_API_KEY")).toMatchObject({ configured: true });
      expect(JSON.stringify([...rows.values()])).not.toContain("tvly-secret");

      const removed = (await (await send("DELETE", "TAVILY_API_KEY", {})).json()) as { credentials: Array<{ name: string; configured: boolean }> };
      expect(removed.credentials.find((entry) => entry.name === "TAVILY_API_KEY")?.configured).toBe(false);
    } finally {
      await server.stop(new AbortController().signal);
    }
  });
});
