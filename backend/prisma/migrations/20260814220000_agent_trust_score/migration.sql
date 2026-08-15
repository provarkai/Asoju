-- CreateTable
CREATE TABLE "AgentTrustScore" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "completionScore" DOUBLE PRECISION NOT NULL,
    "gpsComplianceScore" DOUBLE PRECISION NOT NULL,
    "evidenceScore" DOUBLE PRECISION NOT NULL,
    "ratingScore" DOUBLE PRECISION NOT NULL,
    "responseScore" DOUBLE PRECISION NOT NULL,
    "compositeScore" DOUBLE PRECISION NOT NULL,
    "trustTier" TEXT NOT NULL,
    "trustBadge" TEXT,
    "totalAssignments" INTEGER NOT NULL,
    "completedAssignments" INTEGER NOT NULL,
    "previousScore" DOUBLE PRECISION,
    "scoreTrend" TEXT NOT NULL DEFAULT 'STABLE',
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentTrustScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentTrustScore_agentId_key" ON "AgentTrustScore"("agentId");

-- AddForeignKey
ALTER TABLE "AgentTrustScore" ADD CONSTRAINT "AgentTrustScore_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
