-- CreateEnum
CREATE TYPE "AutomationDecisionOutcome" AS ENUM ('AUTO', 'CUSTOMER_INPUT', 'ESCALATE', 'UNSUPPORTED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "AutomationRuleKind" AS ENUM ('REQUIRED_FIELDS', 'BLOCKED_KEYWORDS');

-- AlterEnum
ALTER TYPE "EscalationReasonCategory" ADD VALUE 'AUTOMATION_UNAVAILABLE';

-- AlterTable
ALTER TABLE "Escalation" ALTER COLUMN "caseId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ServiceRequest" ADD COLUMN     "objective" TEXT,
ADD COLUMN     "requirements" JSONB,
ADD COLUMN     "subject" TEXT,
ADD COLUMN     "timing" TEXT;

-- CreateTable
CREATE TABLE "AutomationCapability" (
    "id" TEXT NOT NULL,
    "serviceType" "ServiceType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "kind" "AutomationRuleKind" NOT NULL,
    "config" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationDecision" (
    "id" TEXT NOT NULL,
    "serviceRequestId" TEXT NOT NULL,
    "outcome" "AutomationDecisionOutcome" NOT NULL,
    "reason" TEXT NOT NULL,
    "ruleResults" JSONB NOT NULL,
    "capabilityEnabled" BOOLEAN NOT NULL,
    "escalationId" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AutomationCapability_serviceType_key" ON "AutomationCapability"("serviceType");

-- CreateIndex
CREATE INDEX "AutomationRule_capabilityId_idx" ON "AutomationRule"("capabilityId");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationDecision_serviceRequestId_key" ON "AutomationDecision"("serviceRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationDecision_escalationId_key" ON "AutomationDecision"("escalationId");

-- CreateIndex
CREATE INDEX "AutomationDecision_outcome_idx" ON "AutomationDecision"("outcome");

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "AutomationCapability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationDecision" ADD CONSTRAINT "AutomationDecision_serviceRequestId_fkey" FOREIGN KEY ("serviceRequestId") REFERENCES "ServiceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationDecision" ADD CONSTRAINT "AutomationDecision_escalationId_fkey" FOREIGN KEY ("escalationId") REFERENCES "Escalation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
