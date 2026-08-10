/*
  Warnings:

  - You are about to drop the `Membership` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "MembershipPlan" AS ENUM ('PRIORITY', 'PREMIUM');

-- CreateEnum
CREATE TYPE "ScTransactionType" AS ENUM ('GRANT', 'DEBIT', 'REVERSAL', 'ADJUSTMENT', 'EXPIRY');

-- DropForeignKey
ALTER TABLE "Membership" DROP CONSTRAINT "Membership_subscriptionId_fkey";

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "baseAmount" DECIMAL(12,2),
ADD COLUMN     "discountAmount" DECIMAL(12,2),
ADD COLUMN     "discountPercent" DECIMAL(5,2),
ADD COLUMN     "scAppliedNgn" DECIMAL(12,2),
ADD COLUMN     "subscriptionId" TEXT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "fxRate" DECIMAL(12,4) NOT NULL DEFAULT 1600,
ADD COLUMN     "plan" "MembershipPlan" NOT NULL DEFAULT 'PRIORITY',
ADD COLUMN     "priceUsd" DECIMAL(12,2) NOT NULL DEFAULT 99,
ALTER COLUMN "amount" SET DEFAULT 158400;

-- DropTable
DROP TABLE "Membership";

-- CreateTable
CREATE TABLE "ScLedgerEntry" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "type" "ScTransactionType" NOT NULL,
    "amountUsd" DECIMAL(12,2) NOT NULL,
    "caseId" TEXT,
    "quoteId" TEXT,
    "fxRateApplied" DECIMAL(12,4),
    "amountNgn" DECIMAL(12,2),
    "reason" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScLedgerEntry_subscriptionId_idx" ON "ScLedgerEntry"("subscriptionId");

-- CreateIndex
CREATE INDEX "ScLedgerEntry_caseId_idx" ON "ScLedgerEntry"("caseId");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScLedgerEntry" ADD CONSTRAINT "ScLedgerEntry_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScLedgerEntry" ADD CONSTRAINT "ScLedgerEntry_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ServiceCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScLedgerEntry" ADD CONSTRAINT "ScLedgerEntry_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
