-- AlterTable
ALTER TABLE "ServiceCase" ADD COLUMN     "nextAction" TEXT,
ADD COLUMN     "nextActionDueAt" TIMESTAMP(3),
ADD COLUMN     "ownerUserId" TEXT,
ADD COLUMN     "slaTargetAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ServiceCase_ownerUserId_idx" ON "ServiceCase"("ownerUserId");

-- CreateIndex
CREATE INDEX "ServiceCase_slaTargetAt_idx" ON "ServiceCase"("slaTargetAt");

-- AddForeignKey
ALTER TABLE "ServiceCase" ADD CONSTRAINT "ServiceCase_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

