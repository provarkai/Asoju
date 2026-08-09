-- AlterTable
ALTER TABLE "ServiceCase" ADD COLUMN     "spawnedFromScheduleId" TEXT;

-- CreateTable
CREATE TABLE "RecurringSchedule" (
    "id" TEXT NOT NULL,
    "originCaseId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "serviceType" "ServiceType" NOT NULL,
    "description" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "beneficiaryId" TEXT,
    "propertyId" TEXT,
    "assetId" TEXT,
    "cadenceDays" INTEGER NOT NULL,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecurringSchedule_originCaseId_key" ON "RecurringSchedule"("originCaseId");

-- AddForeignKey
ALTER TABLE "ServiceCase" ADD CONSTRAINT "ServiceCase_spawnedFromScheduleId_fkey" FOREIGN KEY ("spawnedFromScheduleId") REFERENCES "RecurringSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringSchedule" ADD CONSTRAINT "RecurringSchedule_originCaseId_fkey" FOREIGN KEY ("originCaseId") REFERENCES "ServiceCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringSchedule" ADD CONSTRAINT "RecurringSchedule_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

