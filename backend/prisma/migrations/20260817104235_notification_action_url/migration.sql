-- AlterTable
-- IF NOT EXISTS: an earlier deploy attempt (during a Render/GitHub outage,
-- see git history) got far enough to run this ALTER TABLE against
-- production before being interrupted, but never got to record itself as
-- applied in _prisma_migrations — so `prisma migrate deploy` retried it on
-- the next boot and hit P3018 ("column already exists"). Idempotent going
-- forward regardless of which side of that race a given environment landed
-- on; the column is nullable so this is safe to apply from a clean DB too.
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "actionUrl" TEXT;

