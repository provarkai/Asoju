-- CreateEnum
CREATE TYPE "MilestoneGroup" AS ENUM ('FOUNDATION', 'DPC', 'SUPERSTRUCTURE', 'ROOFING', 'FINISHING');

-- AlterTable
ALTER TABLE "CaseTask" ADD COLUMN     "milestoneGroup" "MilestoneGroup";
