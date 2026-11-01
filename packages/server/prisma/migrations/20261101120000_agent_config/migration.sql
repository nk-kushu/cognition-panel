-- CreateEnum
CREATE TYPE "kushex"."AgentDefinitionKind" AS ENUM ('skill', 'guard');

-- CreateEnum
CREATE TYPE "kushex"."AgentWaitStatus" AS ENUM ('pending', 'answered', 'cancelled');

-- CreateTable
CREATE TABLE "kushex"."AgentProjectSettings" (
    "projectId" UUID NOT NULL,
    "agentType" VARCHAR(63) NOT NULL,
    "settings" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentProjectSettings_pkey" PRIMARY KEY ("projectId","agentType")
);

-- CreateTable
CREATE TABLE "kushex"."AgentDefinition" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "agentType" VARCHAR(63) NOT NULL,
    "kind" "kushex"."AgentDefinitionKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kushex"."AgentDefinitionVersion" (
    "id" UUID NOT NULL,
    "definitionId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentDefinitionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kushex"."AgentRunWait" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "actorId" TEXT NOT NULL,
    "agentName" VARCHAR(63) NOT NULL,
    "threadId" UUID,
    "agentRunRef" VARCHAR(120) NOT NULL,
    "waitRef" VARCHAR(120) NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "kushex"."AgentWaitStatus" NOT NULL DEFAULT 'pending',
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "AgentRunWait_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentDefinition_projectId_agentType_kind_idx" ON "kushex"."AgentDefinition"("projectId", "agentType", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "AgentDefinitionVersion_definitionId_version_key" ON "kushex"."AgentDefinitionVersion"("definitionId", "version");

-- CreateIndex
CREATE INDEX "AgentRunWait_projectId_status_idx" ON "kushex"."AgentRunWait"("projectId", "status");

-- AddForeignKey
ALTER TABLE "kushex"."AgentProjectSettings" ADD CONSTRAINT "AgentProjectSettings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "kushex"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kushex"."AgentDefinition" ADD CONSTRAINT "AgentDefinition_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "kushex"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kushex"."AgentDefinitionVersion" ADD CONSTRAINT "AgentDefinitionVersion_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "kushex"."AgentDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kushex"."AgentRunWait" ADD CONSTRAINT "AgentRunWait_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "kushex"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
