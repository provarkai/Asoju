-- CreateEnum
CREATE TYPE "AiKnowledgeCategory" AS ENUM ('PRICING', 'POLICY', 'SERVICE_INFO', 'FAQ', 'GENERAL');

-- CreateTable
CREATE TABLE "AiKnowledgeEntry" (
    "id" TEXT NOT NULL,
    "category" "AiKnowledgeCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiKnowledgeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiKnowledgeEntry_category_isActive_idx" ON "AiKnowledgeEntry"("category", "isActive");
