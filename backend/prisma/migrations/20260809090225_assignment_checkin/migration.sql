-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "checkInAt" TIMESTAMP(3),
ADD COLUMN     "checkInLocation" JSONB;
