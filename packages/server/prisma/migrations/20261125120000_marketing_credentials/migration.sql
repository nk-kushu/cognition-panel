CREATE TABLE "kushex"."MarketingCredential" (
  "actorId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "encryptedValue" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketingCredential_pkey" PRIMARY KEY ("actorId", "name")
);
