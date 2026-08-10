-- CreateEnum
CREATE TYPE "PartnerType" AS ENUM ('ASSOCIATION', 'BUSINESS', 'AGENT');

-- CreateEnum
CREATE TYPE "PartnerStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'PARTNER';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "referredByPartnerId" TEXT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "amount" DECIMAL(12,2) NOT NULL DEFAULT 15000,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'NGN';

-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "PartnerType" NOT NULL,
    "status" "PartnerStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerContact" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskAssessment" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "factors" JSONB NOT NULL,
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionInvoice" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paystackReference" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Partner_code_key" ON "Partner"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerContact_userId_key" ON "PartnerContact"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionInvoice_paystackReference_key" ON "SubscriptionInvoice"("paystackReference");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_referredByPartnerId_fkey" FOREIGN KEY ("referredByPartnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerContact" ADD CONSTRAINT "PartnerContact_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerContact" ADD CONSTRAINT "PartnerContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ServiceCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionInvoice" ADD CONSTRAINT "SubscriptionInvoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

