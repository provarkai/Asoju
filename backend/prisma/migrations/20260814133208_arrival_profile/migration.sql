-- AlterEnum
ALTER TYPE "ServiceType" ADD VALUE 'ARRIVAL_SUPPORT';

-- CreateTable
CREATE TABLE "ArrivalProfile" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "arrivalDate" TIMESTAMP(3),
    "flightNumber" TEXT,
    "departureAirport" TEXT,
    "arrivalAirport" TEXT,
    "accommodationAddress" TEXT,
    "accommodationType" TEXT,
    "numberOfTravelers" INTEGER,
    "pickupRequired" BOOLEAN NOT NULL DEFAULT false,
    "groceriesRequired" BOOLEAN NOT NULL DEFAULT false,
    "specialRequests" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArrivalProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArrivalProfile_caseId_key" ON "ArrivalProfile"("caseId");

-- CreateIndex
CREATE INDEX "ArrivalProfile_caseId_idx" ON "ArrivalProfile"("caseId");

-- AddForeignKey
ALTER TABLE "ArrivalProfile" ADD CONSTRAINT "ArrivalProfile_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ServiceCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
