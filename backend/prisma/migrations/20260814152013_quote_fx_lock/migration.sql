-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "fxLockExpiry" TIMESTAMP(3),
ADD COLUMN     "lockedFxRate" DECIMAL(12,4),
ADD COLUMN     "sourceCurrency" TEXT;
