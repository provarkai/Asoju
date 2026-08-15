-- CreateEnum
CREATE TYPE "MultiplierType" AS ENUM ('URGENCY');

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "priceBookId" TEXT;

-- CreateTable
CREATE TABLE "PriceBook" (
    "id" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "version" SERIAL NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceBook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceRule" (
    "id" TEXT NOT NULL,
    "priceBookId" TEXT NOT NULL,
    "serviceType" "ServiceType" NOT NULL,
    "zone" "PricingZone" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "label" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MultiplierRule" (
    "id" TEXT NOT NULL,
    "priceBookId" TEXT NOT NULL,
    "type" "MultiplierType" NOT NULL,
    "casePriority" "CasePriority",
    "multiplier" DECIMAL(5,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MultiplierRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PriceBook_version_key" ON "PriceBook"("version");

-- CreateIndex
CREATE INDEX "PriceBook_active_idx" ON "PriceBook"("active");

-- CreateIndex
CREATE INDEX "PriceRule_priceBookId_serviceType_zone_active_idx" ON "PriceRule"("priceBookId", "serviceType", "zone", "active");

-- CreateIndex
CREATE INDEX "MultiplierRule_priceBookId_type_active_idx" ON "MultiplierRule"("priceBookId", "type", "active");

-- AddForeignKey
ALTER TABLE "PriceRule" ADD CONSTRAINT "PriceRule_priceBookId_fkey" FOREIGN KEY ("priceBookId") REFERENCES "PriceBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MultiplierRule" ADD CONSTRAINT "MultiplierRule_priceBookId_fkey" FOREIGN KEY ("priceBookId") REFERENCES "PriceBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_priceBookId_fkey" FOREIGN KEY ("priceBookId") REFERENCES "PriceBook"("id") ON DELETE SET NULL ON UPDATE CASCADE;
