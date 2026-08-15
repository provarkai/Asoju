-- CreateEnum
CREATE TYPE "ConciergeAnalyticsEventName" AS ENUM ('CONCIERGE_OPENED', 'QUICK_PROMPT_CLICKED', 'MESSAGE_SENT', 'MESSAGE_FAILED', 'RETRY_CLICKED');

-- CreateTable
CREATE TABLE "ConciergeAnalyticsEvent" (
    "id" TEXT NOT NULL,
    "name" "ConciergeAnalyticsEventName" NOT NULL,
    "sessionId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConciergeAnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConciergeAnalyticsEvent_name_createdAt_idx" ON "ConciergeAnalyticsEvent"("name", "createdAt");

-- CreateIndex
CREATE INDEX "ConciergeAnalyticsEvent_sessionId_idx" ON "ConciergeAnalyticsEvent"("sessionId");

