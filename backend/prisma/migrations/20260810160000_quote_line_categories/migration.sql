-- CreateEnum
CREATE TYPE "QuoteLineCategory" AS ENUM ('ASOJU_SERVICE_FEE', 'EXTERNAL_COST', 'THIRD_PARTY_PROFESSIONAL', 'TAX_STATUTORY');

-- AlterTable
ALTER TABLE "Quote" DROP COLUMN "breakdown",
ADD COLUMN     "nonServiceFeeAmount" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "category" "QuoteLineCategory" NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuoteLine_quoteId_idx" ON "QuoteLine"("quoteId");

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

