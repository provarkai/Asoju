-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "scopeId" TEXT;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "CaseScope"("id") ON DELETE SET NULL ON UPDATE CASCADE;
