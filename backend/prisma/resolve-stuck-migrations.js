// One-time-per-environment self-heal, run before `prisma migrate deploy`
// in Dockerfile.backend's boot CMD.
//
// What happened: a deploy attempt got interrupted between running this
// migration's SQL (which succeeded) and Prisma recording it as applied —
// see the comment in
// prisma/migrations/20260817104235_notification_action_url/migration.sql
// for the incident. That left a *failed* row in _prisma_migrations
// (started_at set, finished_at null), which makes every subsequent boot
// hit P3009 ("migrate found failed migrations ... new migrations will
// not be applied") before `prisma migrate deploy` even attempts to run
// anything — the migration file's own ADD COLUMN IF NOT EXISTS fix can't
// help, because Prisma refuses to proceed at all while that row stands.
//
// This script is the only way to clear that row without direct DB shell
// access (Render's free tier has no one-off-job API to run
// `prisma migrate resolve` by hand). It looks for exactly the known
// stuck migration, confirms the column it was supposed to add is
// actually present (the SQL DID succeed — only the bookkeeping didn't),
// and marks that specific row finished. It never touches any other
// migration's failure state — a real failure elsewhere should keep
// blocking deploys loudly, not get silently waved through.
//
// Safe to leave in the boot path permanently: once the row is fixed
// (or was never broken), every check below is a fast no-op.
const { PrismaClient } = require('@prisma/client');

const STUCK_MIGRATION = '20260817104235_notification_action_url';

async function main() {
  const prisma = new PrismaClient();
  try {
    const stuck = await prisma.$queryRawUnsafe(
      `SELECT id FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NULL`,
      STUCK_MIGRATION,
    );
    if (!stuck || stuck.length === 0) {
      return; // nothing stuck — normal case on every boot after the fix lands
    }

    const columnExists = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'Notification' AND column_name = 'actionUrl'`,
    );
    if (!columnExists || columnExists.length === 0) {
      // The SQL never actually ran here (unlike production) — let
      // `prisma migrate deploy` fail loudly and visibly rather than
      // marking a migration applied that never ran.
      console.error(
        `resolve-stuck-migrations: found a failed row for ${STUCK_MIGRATION} but the column it adds is missing — not auto-resolving.`,
      );
      return;
    }

    await prisma.$executeRawUnsafe(
      `UPDATE "_prisma_migrations" SET finished_at = now(), applied_steps_count = 1 WHERE migration_name = $1 AND finished_at IS NULL`,
      STUCK_MIGRATION,
    );
    console.log(`resolve-stuck-migrations: marked ${STUCK_MIGRATION} as applied (column already present, bookkeeping only).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('resolve-stuck-migrations failed:', err);
  process.exitCode = 1;
});
