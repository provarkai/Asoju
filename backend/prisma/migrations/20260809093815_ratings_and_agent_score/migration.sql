-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "performanceScore" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "Rating" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "byUserId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Rating_caseId_key" ON "Rating"("caseId");

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ServiceCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_byUserId_fkey" FOREIGN KEY ("byUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
