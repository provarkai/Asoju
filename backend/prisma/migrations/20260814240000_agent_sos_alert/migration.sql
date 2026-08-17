-- CreateTable
CREATE TABLE "SosAlert" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "caseId" TEXT,
    "assignmentId" TEXT,
    "alertType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "address" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "acknowledgedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNotes" TEXT,
    "escalationLevel" INTEGER NOT NULL DEFAULT 0,
    "escalatedChannels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "caseHeld" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SosAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SosAlert_agentId_idx" ON "SosAlert"("agentId");

-- CreateIndex
CREATE INDEX "SosAlert_caseId_idx" ON "SosAlert"("caseId");

-- CreateIndex
CREATE INDEX "SosAlert_status_idx" ON "SosAlert"("status");

-- AddForeignKey
ALTER TABLE "SosAlert" ADD CONSTRAINT "SosAlert_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SosAlert" ADD CONSTRAINT "SosAlert_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ServiceCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SosAlert" ADD CONSTRAINT "SosAlert_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
