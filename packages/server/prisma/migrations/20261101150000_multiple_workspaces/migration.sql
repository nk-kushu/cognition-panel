BEGIN;

ALTER TABLE "kushex"."Workspace" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Preserve existing settings and definitions in their original workspace.
DROP INDEX "kushex"."Workspace_projectId_key";
CREATE UNIQUE INDEX "Workspace_projectId_id_key" ON "kushex"."Workspace"("projectId", "id");
CREATE INDEX "Workspace_projectId_idx" ON "kushex"."Workspace"("projectId");
ALTER TABLE "kushex"."AgentProjectSettings" ADD COLUMN "workspaceId" UUID;
ALTER TABLE "kushex"."AgentDefinition" ADD COLUMN "workspaceId" UUID;
UPDATE "kushex"."AgentProjectSettings" s SET "workspaceId" = w.id FROM "kushex"."Workspace" w WHERE w."projectId" = s."projectId";
UPDATE "kushex"."AgentDefinition" s SET "workspaceId" = w.id FROM "kushex"."Workspace" w WHERE w."projectId" = s."projectId";
ALTER TABLE "kushex"."AgentProjectSettings" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "kushex"."AgentDefinition" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "kushex"."AgentProjectSettings" DROP CONSTRAINT "AgentProjectSettings_pkey";
ALTER TABLE "kushex"."AgentProjectSettings" ADD PRIMARY KEY ("projectId", "workspaceId", "agentType");
ALTER TABLE "kushex"."AgentProjectSettings" ADD CONSTRAINT "AgentProjectSettings_projectId_workspaceId_fkey" FOREIGN KEY ("projectId", "workspaceId") REFERENCES "kushex"."Workspace"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kushex"."AgentDefinition" ADD CONSTRAINT "AgentDefinition_projectId_workspaceId_fkey" FOREIGN KEY ("projectId", "workspaceId") REFERENCES "kushex"."Workspace"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX "kushex"."AgentDefinition_projectId_agentType_kind_idx";
CREATE INDEX "AgentDefinition_projectId_workspaceId_agentType_kind_idx" ON "kushex"."AgentDefinition"("projectId", "workspaceId", "agentType", "kind");
ALTER TABLE "kushex"."ChatTurn" ADD COLUMN "workspaceId" UUID;
UPDATE "kushex"."ChatTurn" t SET "workspaceId" = w.id FROM "kushex"."ChatThread" c, "kushex"."Workspace" w WHERE t."threadId" = c.id AND c."projectId" = w."projectId";
ALTER TABLE "kushex"."AgentRunWait" ADD COLUMN "workspaceId" UUID;
UPDATE "kushex"."AgentRunWait" t SET "workspaceId" = w.id FROM "kushex"."Workspace" w WHERE t."projectId" = w."projectId";

COMMIT;
