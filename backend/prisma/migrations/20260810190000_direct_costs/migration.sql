-- CreateEnum
CREATE TYPE "DirectCostCategory" AS ENUM ('REPRESENTATIVE', 'TRAVEL', 'THIRD_PARTY', 'OTHER');

-- CreateTable
CREATE TABLE "DirectCost" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "category" "DirectCostCategory" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "note" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DirectCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DirectCost_caseId_idx" ON "DirectCost"("caseId");

-- AddForeignKey
ALTER TABLE "DirectCost" ADD CONSTRAINT "DirectCost_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ServiceCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectCost" ADD CONSTRAINT "DirectCost_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

