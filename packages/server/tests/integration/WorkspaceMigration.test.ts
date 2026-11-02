import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { afterEach, expect, it } from "vitest";
import { TemporaryDatabase } from "../support/TemporaryDatabase.js";
import { PrismaMigrator } from "../support/PrismaMigrator.js";

let temporary: TemporaryDatabase | undefined;
let migrator: PrismaMigrator | undefined;
afterEach(async () => {
  await temporary?.drop();
  await migrator?.remove();
});

it("migrates existing settings, definitions and waiting runs into their original workspace", async () => {
  temporary = await TemporaryDatabase.create();
  migrator = await PrismaMigrator.create();
  for (const name of [
    "20261023000000_projects_and_workspaces",
    "20261028160000_chat_threads",
    "20261101120000_agent_config",
  ]) {
    await migrator.add(
      name,
      await readFile(
        new URL(`../../prisma/migrations/${name}/migration.sql`, import.meta.url),
        "utf8",
      ),
    );
  }
  await migrator.deploy(temporary.url);
  const client = new pg.Client({ connectionString: temporary.url });
  await client.connect();
  try {
    const projectId = randomUUID();
    const workspaceId = randomUUID();
    const definitionId = randomUUID();
    const threadId = randomUUID();
    const runId = randomUUID();
    await client.query('INSERT INTO kushex."Project" (id, "actorId", name) VALUES ($1, $2, $3)', [
      projectId,
      "operator",
      "Existing",
    ]);
    await client.query(
      'INSERT INTO kushex."Workspace" (id, "projectId", path) VALUES ($1, $2, $3)',
      [workspaceId, projectId, "root/existing"],
    );
    await client.query(
      'INSERT INTO kushex."AgentProjectSettings" ("projectId", "agentType", settings, revision, "updatedAt") VALUES ($1, $2, $3, 7, NOW())',
      [projectId, "coding", { testWritingPrompt: "Preserve me" }],
    );
    await client.query(
      'INSERT INTO kushex."AgentDefinition" (id, "projectId", "agentType", kind) VALUES ($1, $2, $3, $4)',
      [definitionId, projectId, "coding", "skill"],
    );
    await client.query(
      'INSERT INTO kushex."ChatThread" (id, "projectId", "actorId", title, "updatedAt") VALUES ($1, $2, $3, $4, NOW())',
      [threadId, projectId, "operator", "Existing chat"],
    );
    await client.query(
      'INSERT INTO kushex."ChatTurn" (id, "threadId", "agentName", message, files, debug, events) VALUES ($1, $2, $3, $4, $5, false, $5)',
      [runId, threadId, "coding", "Existing turn", []],
    );
    await client.query(
      'INSERT INTO kushex."AgentRunWait" (id, "projectId", "actorId", "agentName", "agentRunRef", "waitRef", kind, payload) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [runId, projectId, "operator", "coding", "agent-run", "wait-one", "clarification", {}],
    );
    const migration = "20261101150000_multiple_workspaces";
    await migrator.add(
      migration,
      await readFile(
        new URL(`../../prisma/migrations/${migration}/migration.sql`, import.meta.url),
        "utf8",
      ),
    );
    await migrator.deploy(temporary.url);
    expect(
      (
        await client.query(
          'SELECT "workspaceId", settings, revision FROM kushex."AgentProjectSettings"',
        )
      ).rows,
    ).toEqual([{ workspaceId, settings: { testWritingPrompt: "Preserve me" }, revision: 7 }]);
    expect(
      (await client.query('SELECT id, "workspaceId" FROM kushex."AgentDefinition"')).rows,
    ).toEqual([{ id: definitionId, workspaceId }]);
    expect((await client.query('SELECT "workspaceId" FROM kushex."ChatTurn"')).rows).toEqual([
      { workspaceId },
    ]);
    expect((await client.query('SELECT "workspaceId" FROM kushex."AgentRunWait"')).rows).toEqual([
      { workspaceId },
    ]);
    await client.query(
      'INSERT INTO kushex."Workspace" (id, "projectId", path) VALUES ($1, $2, $3)',
      [randomUUID(), projectId, "root/second"],
    );
    expect((await client.query('SELECT count(*) FROM kushex."Workspace"')).rows[0].count).toBe("2");
  } finally {
    await client.end();
  }
});
