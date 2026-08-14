-- CreateEnum
CREATE TYPE "AgentTier" AS ENUM ('BRONZE', 'SILVER', 'GOLD');

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "qcPassRate" DOUBLE PRECISION,
ADD COLUMN     "tier" "AgentTier" NOT NULL DEFAULT 'BRONZE';

-- CreateTable
CREATE TABLE "QcReview" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "outcome" "QcOutcome" NOT NULL,
    "reviewedById" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QcReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QcReview_caseId_idx" ON "QcReview"("caseId");

-- AddForeignKey
ALTER TABLE "QcReview" ADD CONSTRAINT "QcReview_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ServiceCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
