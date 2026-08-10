-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('SENT', 'FAILED');

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "channel" TEXT,
ADD COLUMN     "deliveryStatus" "NotificationDeliveryStatus" NOT NULL DEFAULT 'SENT',
ADD COLUMN     "failureReason" TEXT;

