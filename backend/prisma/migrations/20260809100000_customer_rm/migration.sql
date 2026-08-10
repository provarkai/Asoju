-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "assignedRmUserId" TEXT;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_assignedRmUserId_fkey" FOREIGN KEY ("assignedRmUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

