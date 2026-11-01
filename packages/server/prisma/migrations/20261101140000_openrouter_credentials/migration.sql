CREATE TABLE "kushex"."OpenRouterCredential" (
  "actorId" TEXT NOT NULL,
  "encryptedKey" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpenRouterCredential_pkey" PRIMARY KEY ("actorId")
);
