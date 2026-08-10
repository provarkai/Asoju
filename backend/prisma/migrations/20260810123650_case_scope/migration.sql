-- CreateTable
CREATE TABLE "CaseScope" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "objective" TEXT NOT NULL,
    "tasks" JSONB NOT NULL,
    "deliverables" JSONB NOT NULL,
    "exclusions" JSONB NOT NULL,
    "evidenceRequirements" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "CaseScope_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaseScope_caseId_idx" ON "CaseScope"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "CaseScope_caseId_version_key" ON "CaseScope"("caseId", "version");

-- AddForeignKey
ALTER TABLE "CaseScope" ADD CONSTRAINT "CaseScope_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ServiceCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseScope" ADD CONSTRAINT "CaseScope_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseScope" ADD CONSTRAINT "CaseScope_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
