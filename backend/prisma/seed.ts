/**
 * Bootstraps the very first SuperAdmin account.
 *
 * Every other staff/agent/provider/partner account has a real provisioning
 * path once at least one Admin/SuperAdmin exists — AuthService.adminProvisionAccount
 * (POST /admin/staff-accounts), /ops/agents, /ops/providers,
 * POST /admin/partners/:partnerId/contacts. None of those help with
 * account #1: they all require an authenticated Admin/SuperAdmin caller,
 * which is exactly the chicken-and-egg this script exists to break. Every
 * subsequent staff member should go through the real endpoints above, not
 * this script (README's own "Notes" section previously pointed at raw
 * Prisma/psql for this one gap — this replaces that).
 *
 * Usage:
 *   SEED_SUPERADMIN_EMAIL=you@asoju.example SEED_SUPERADMIN_PASSWORD='...' \
 *     npm run seed --workspace=backend
 *
 * Idempotent and safe to re-run: no-ops (does not touch the existing
 * account) if a user with that email already exists.
 */
import { PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';

const MIN_PASSWORD_LENGTH = 8;

async function main() {
  const email = process.env.SEED_SUPERADMIN_EMAIL;
  const password = process.env.SEED_SUPERADMIN_PASSWORD;

  // Fail loudly and collect every problem at once, same discipline as
  // config/validate-production-env.ts — this is a one-shot bootstrap
  // script, not a place to guess at partial/placeholder input.
  const problems: string[] = [];
  if (!email) problems.push('SEED_SUPERADMIN_EMAIL is required');
  if (!password) problems.push('SEED_SUPERADMIN_PASSWORD is required');
  if (password && password.length < MIN_PASSWORD_LENGTH) {
    problems.push(`SEED_SUPERADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (problems.length) {
    console.error('Cannot seed the first SuperAdmin account:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.findUnique({ where: { email: email! } });
    if (existing) {
      console.log(`User ${email} already exists (role: ${existing.role}) — nothing to do.`);
      return;
    }

    const passwordHash = await argon2.hash(password!);
    const user = await prisma.user.create({
      data: { email: email!, passwordHash, role: Role.SUPER_ADMIN, isActive: true },
    });

    await prisma.auditEvent.create({
      data: { actorType: 'system', action: 'user.seeded_first_superadmin', metadata: { userId: user.id, email } },
    });

    console.log(`Created SuperAdmin ${email} (${user.id}).`);
    console.log(
      'MFA is mandatory for this role — the first login will return { mfaEnrollmentRequired: true } ' +
        'instead of a session; complete enrollment there before this account can do anything else.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
