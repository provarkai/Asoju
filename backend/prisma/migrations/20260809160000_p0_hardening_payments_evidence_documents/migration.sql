-- CreateEnum
CREATE TYPE "DocumentVisibility" AS ENUM ('ALL', 'STAFF_ONLY', 'ASSIGNEE');

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'FAILED';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "restrictedToAssignmentId" TEXT,
ADD COLUMN     "visibility" "DocumentVisibility" NOT NULL DEFAULT 'ALL';

-- AlterTable
ALTER TABLE "Evidence" ADD COLUMN     "clientRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Evidence_caseId_clientRequestId_key" ON "Evidence"("caseId", "clientRequestId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_restrictedToAssignmentId_fkey" FOREIGN KEY ("restrictedToAssignmentId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

