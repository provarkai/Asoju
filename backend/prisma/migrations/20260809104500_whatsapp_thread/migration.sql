-- CreateTable
CREATE TABLE "WhatsAppThread" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "history" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppThread_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppThread_phone_key" ON "WhatsAppThread"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppThread_userId_key" ON "WhatsAppThread"("userId");

-- AddForeignKey
ALTER TABLE "WhatsAppThread" ADD CONSTRAINT "WhatsAppThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

