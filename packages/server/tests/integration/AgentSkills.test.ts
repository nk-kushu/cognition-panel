import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SaveAgentDefinitionRequest } from "@kushex/contracts";
import { NotFoundError } from "../../src/errors/NotFoundError.js";
import { PrismaDatabase } from "../../src/infrastructure/database/PrismaDatabase.js";
import { AgentConfigService } from "../../src/modules/agent-config/public.js";
import { PrismaProjectRepository, ProjectService } from "../../src/modules/projects/public.js";
import {
  LocalWorkspaceFileSystem,
  PrismaWorkspaceRepository,
  WorkspacePathResolver,
  WorkspaceService,
} from "../../src/modules/workspaces/public.js";
import type { RequestContext } from "../../src/shared/application/RequestContext.js";
import { PrismaMigrator } from "../support/PrismaMigrator.js";
import { TemporaryDatabase } from "../support/TemporaryDatabase.js";

let temporary: TemporaryDatabase;
let migrator: PrismaMigrator;
let database: PrismaDatabase;
const logger = pino({ level: "silent" });
const operator: RequestContext = { requestId: "test", actor: { id: "operator" } };
const skill: SaveAgentDefinitionRequest = {
  kind: "skill",
  enabled: true,
  content: {
    name: "Project conventions",
    purpose: "Keep implementation consistent with this workspace.",
    instructions: "Read the existing code before changing it.",
    phases: ["implementation"],
    dependencies: [],
    requiredInputs: [],
    expectedResult: "",
    selection: "automatic",
    model: "",
  },
};

function connect(): PrismaDatabase {
  return new PrismaDatabase(
    { url: temporary.url, maxConnections: 2, connectionTimeoutMs: 1000 },
    logger,
  );
}

function configuration(): AgentConfigService {
  const projects = new ProjectService(
    new PrismaProjectRepository(database.client),
    new WorkspaceService(
      new PrismaWorkspaceRepository(database.client),
      new LocalWorkspaceFileSystem(new WorkspacePathResolver([tmpdir()])),
    ),
  );
  return new AgentConfigService(
    database.client,
    projects,
    { recall: async () => [] },
    { conversation: async () => [] },
  );
}

beforeEach(async () => {
  temporary = await TemporaryDatabase.create();
  migrator = await PrismaMigrator.create();
  for (const migration of [
    "20261023000000_projects_and_workspaces",
    "20261101120000_agent_config",
  ]) {
    await migrator.add(
      migration,
      await readFile(
        new URL(`../../prisma/migrations/${migration}/migration.sql`, import.meta.url),
        "utf8",
      ),
    );
  }
  await migrator.deploy(temporary.url);
  database = connect();
  await database.start();
});
afterEach(async () => {
  await database?.stop();
  await temporary?.drop();
  await migrator?.remove();
});

describe("project workspace skills in PostgreSQL", () => {
  it("persists skills and versions across connections and pins only current enabled skills", async () => {
    const project = await new PrismaProjectRepository(database.client).create(operator.actor.id, {
      name: "Example",
      path: "root/example",
    });
    const service = configuration();
    const created = await service.createDefinition(operator, project.id, "coding", skill);
    const updated = await service.saveDefinition(operator, project.id, "coding", created.id, {
      enabled: true,
      content: { ...skill.content, instructions: "Follow this project's architecture." },
    });
    expect(updated.version).toBe(2);

    await database.stop();
    database = connect();
    await database.start();
    const reloaded = configuration();
    expect(await reloaded.definitions(operator, project.id, "coding")).toEqual([updated]);
    expect((await reloaded.load(operator, project.id, "coding", undefined)).skills).toEqual([
      { ...updated.content, id: updated.id, versionId: updated.versionId },
    ]);
    const disabled = await reloaded.saveDefinition(operator, project.id, "coding", created.id, {
      enabled: false,
      content: updated.content,
    });
    expect(disabled.versionId).toBe(updated.versionId);
    expect((await reloaded.load(operator, project.id, "coding", undefined)).skills).toEqual([]);

    await reloaded.deleteDefinition(operator, project.id, "coding", created.id);
    expect(await reloaded.definitions(operator, project.id, "coding")).toEqual([]);
    const versions = await database.client.agentDefinitionVersion.findMany({
      where: { definitionId: created.id },
      orderBy: { version: "asc" },
    });
    expect(versions.map((row) => row.id)).toEqual([created.versionId, updated.versionId]);
    expect(versions[0]?.content).toEqual(skill.content);
  });

  it("isolates projects, workspaces, plugin agent types and actors for reads and writes", async () => {
    const projects = new PrismaProjectRepository(database.client);
    const first = await projects.create(operator.actor.id, { name: "First", path: "root/first" });
    const second = await projects.create(operator.actor.id, {
      name: "Second",
      path: "root/second",
    });
    const samePath = await projects.create(operator.actor.id, {
      name: "Same path",
      path: "root/first",
    });
    expect(first.workspace.id).not.toBe(second.workspace.id);
    expect(first.workspace.id).not.toBe(samePath.workspace.id);
    const service = configuration();
    const saved = await service.createDefinition(operator, first.id, "coding", skill);
    const anotherType = await service.createDefinition(operator, first.id, "writer", {
      ...skill,
      content: { ...skill.content, name: "Writer conventions" },
    });
    expect(await service.definitions(operator, first.id, "coding")).toEqual([saved]);
    expect(await service.definitions(operator, first.id, "writer")).toEqual([anotherType]);
    expect(await service.definitions(operator, second.id, "coding")).toEqual([]);
    expect(await service.definitions(operator, samePath.id, "coding")).toEqual([]);
    for (const [projectId, agentType] of [
      [second.id, "coding"],
      [first.id, "writer"],
    ]) {
      await expect(
        service.saveDefinition(operator, projectId!, agentType!, saved.id, {
          enabled: false,
          content: skill.content,
        }),
      ).rejects.toThrow(NotFoundError);
      await expect(
        service.deleteDefinition(operator, projectId!, agentType!, saved.id),
      ).rejects.toThrow(NotFoundError);
    }
    const outsider: RequestContext = { requestId: "other", actor: { id: "other-actor" } };
    await expect(service.definitions(outsider, first.id, "coding")).rejects.toThrow(NotFoundError);
    await expect(service.createDefinition(outsider, first.id, "coding", skill)).rejects.toThrow(
      NotFoundError,
    );
    await expect(
      service.saveDefinition(outsider, first.id, "coding", saved.id, {
        enabled: false,
        content: skill.content,
      }),
    ).rejects.toThrow(NotFoundError);
    await expect(service.deleteDefinition(outsider, first.id, "coding", saved.id)).rejects.toThrow(
      NotFoundError,
    );
    expect(await service.definitions(operator, first.id, "coding")).toEqual([saved]);
  });
});
