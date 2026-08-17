-- CreateEnum
CREATE TYPE "EscalationReasonCategory" AS ENUM ('MISSING_INFORMATION', 'PRICING_UNAVAILABLE', 'NON_STANDARD_SCOPE', 'PROVIDER_AVAILABILITY', 'POLICY_RISK', 'TECHNICAL_FAILURE', 'MANUAL');

-- CreateEnum
CREATE TYPE "EscalationStatus" AS ENUM ('REQUIRED', 'REVIEWING', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IdempotencyOperation" AS ENUM ('SERVICE_REQUEST_CREATE', 'PAYMENT_INITIATE');

-- CreateEnum
CREATE TYPE "IdempotencyRecordStatus" AS ENUM ('PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "Escalation" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "serviceRequestId" TEXT,
    "reasonCategory" "EscalationReasonCategory" NOT NULL,
    "internalReason" TEXT,
    "handoffSummary" JSONB,
    "customerMessage" TEXT NOT NULL,
    "status" "EscalationStatus" NOT NULL DEFAULT 'REQUIRED',
    "assignedToId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Escalation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "operation" "IdempotencyOperation" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "resultReference" TEXT,
    "status" "IdempotencyRecordStatus" NOT NULL DEFAULT 'PROCESSING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Escalation_caseId_idx" ON "Escalation"("caseId");

-- CreateIndex
CREATE INDEX "Escalation_status_idx" ON "Escalation"("status");

-- CreateIndex
CREATE INDEX "Escalation_assignedToId_status_idx" ON "Escalation"("assignedToId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_operation_idempotencyKey_actorId_key" ON "IdempotencyRecord"("operation", "idempotencyKey", "actorId");

-- AddForeignKey
ALTER TABLE "Escalation" ADD CONSTRAINT "Escalation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ServiceCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escalation" ADD CONSTRAINT "Escalation_serviceRequestId_fkey" FOREIGN KEY ("serviceRequestId") REFERENCES "ServiceRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escalation" ADD CONSTRAINT "Escalation_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
