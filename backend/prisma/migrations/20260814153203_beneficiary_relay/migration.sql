-- CreateEnum
CREATE TYPE "BeneficiaryRelayMessageType" AS ENUM ('MESSAGE', 'OBJECTION');

-- CreateTable
CREATE TABLE "BeneficiaryRelayMessage" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "fromBeneficiary" BOOLEAN NOT NULL,
    "type" "BeneficiaryRelayMessageType" NOT NULL DEFAULT 'MESSAGE',
    "body" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BeneficiaryRelayMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BeneficiaryRelayMessage_caseId_idx" ON "BeneficiaryRelayMessage"("caseId");

-- AddForeignKey
ALTER TABLE "BeneficiaryRelayMessage" ADD CONSTRAINT "BeneficiaryRelayMessage_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ServiceCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BeneficiaryRelayMessage" ADD CONSTRAINT "BeneficiaryRelayMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BeneficiaryRelayMessage" ADD CONSTRAINT "BeneficiaryRelayMessage_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
