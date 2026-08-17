-- AlterEnum
ALTER TYPE "CaseStatus" ADD VALUE 'DISPUTED';

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "VaultCategory" AS ENUM ('TITLE_DEED', 'CAC_CERT', 'POWER_OF_ATTORNEY', 'IDENTITY', 'OTHER');

-- CreateEnum
CREATE TYPE "ConciergeFeedbackRating" AS ENUM ('UP', 'DOWN');

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "reasons" TEXT[],
    "notes" TEXT,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultDocument" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "VaultCategory" NOT NULL DEFAULT 'OTHER',
    "notes" TEXT,
    "storageKey" TEXT,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerifiedAsset" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "VaultCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerifiedAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConciergeFeedback" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "rating" "ConciergeFeedbackRating" NOT NULL,
    "userMessage" TEXT NOT NULL,
    "aiReply" TEXT NOT NULL,
    "hadQuote" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConciergeFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Dispute_caseId_idx" ON "Dispute"("caseId");

-- CreateIndex
CREATE INDEX "VaultDocument_customerId_idx" ON "VaultDocument"("customerId");

-- CreateIndex
CREATE INDEX "VerifiedAsset_customerId_idx" ON "VerifiedAsset"("customerId");

-- CreateIndex
CREATE INDEX "ConciergeFeedback_customerId_idx" ON "ConciergeFeedback"("customerId");

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ServiceCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultDocument" ADD CONSTRAINT "VaultDocument_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerifiedAsset" ADD CONSTRAINT "VerifiedAsset_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConciergeFeedback" ADD CONSTRAINT "ConciergeFeedback_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
