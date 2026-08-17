-- CreateEnum
CREATE TYPE "PricingZone" AS ENUM ('LAGOS', 'SOUTH_WEST', 'OTHER');

-- AlterTable
ALTER TABLE "CaseScope" ADD COLUMN     "zone" "PricingZone" NOT NULL DEFAULT 'OTHER';
