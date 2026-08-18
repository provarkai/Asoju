-- CreateEnum
CREATE TYPE "ArrivalArrangementType" AS ENUM ('AIRPORT_TRANSPORT', 'ACCOMMODATION');

-- CreateEnum
CREATE TYPE "ArrivalArrangementStatus" AS ENUM ('REQUESTED', 'BEING_SOURCED', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'CHANGED', 'CANCELLED', 'COMPLETED');

-- CreateTable
CREATE TABLE "ArrivalArrangement" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" "ArrivalArrangementType" NOT NULL,
    "status" "ArrivalArrangementStatus" NOT NULL DEFAULT 'REQUESTED',
    "detail" TEXT,
    "note" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArrivalArrangement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArrivalArrangement_caseId_idx" ON "ArrivalArrangement"("caseId");

-- AddForeignKey
ALTER TABLE "ArrivalArrangement" ADD CONSTRAINT "ArrivalArrangement_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ServiceCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArrivalArrangement" ADD CONSTRAINT "ArrivalArrangement_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
