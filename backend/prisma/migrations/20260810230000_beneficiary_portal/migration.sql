-- AlterTable
ALTER TABLE "Beneficiary" ADD COLUMN     "userId" TEXT;

-- CreateTable
CREATE TABLE "BeneficiaryInvite" (
    "id" TEXT NOT NULL,
    "beneficiaryId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BeneficiaryInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BeneficiaryInvite_tokenHash_key" ON "BeneficiaryInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "BeneficiaryInvite_beneficiaryId_idx" ON "BeneficiaryInvite"("beneficiaryId");

-- CreateIndex
CREATE UNIQUE INDEX "Beneficiary_userId_key" ON "Beneficiary"("userId");

-- AddForeignKey
ALTER TABLE "Beneficiary" ADD CONSTRAINT "Beneficiary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BeneficiaryInvite" ADD CONSTRAINT "BeneficiaryInvite_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "Beneficiary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

