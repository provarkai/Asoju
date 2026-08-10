-- AlterEnum
ALTER TYPE "CaseStatus" ADD VALUE 'ON_HOLD';

-- AlterTable
ALTER TABLE "ServiceCase" ADD COLUMN     "heldFromStatus" "CaseStatus";

