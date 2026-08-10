-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('FAMILY', 'CORPORATE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ServiceType" ADD VALUE 'FAMILY_SUPPORT';
ALTER TYPE "ServiceType" ADD VALUE 'PROCUREMENT';
ALTER TYPE "ServiceType" ADD VALUE 'BUSINESS_VERIFICATION';
ALTER TYPE "ServiceType" ADD VALUE 'INVESTMENT_SUPPORT';
ALTER TYPE "ServiceType" ADD VALUE 'AGRICULTURE_SUPPORT';

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "type" "AccountType" NOT NULL DEFAULT 'FAMILY';

