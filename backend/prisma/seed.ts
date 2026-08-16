// Bootstraps the accounts that have no self-service signup path.
// `POST /auth/register` always creates a CUSTOMER (see auth.service.ts) —
// staff, agent, provider, and partner accounts are onboarded by an
// existing ADMIN via the Ops Console (`/ops/agents`, `/ops/providers`,
// `POST /agents`, etc.), which means the very first ADMIN has nowhere to
// come from. This script is that one-time bootstrap: run it once, by hand,
// against a real DATABASE_URL (e.g. from Render's dashboard Shell for the
// backend service, where the env is already configured) — never expose it
// as an HTTP endpoint, since anyone who could call it could mint their own
// admin account.
//
//   npm run seed --workspace=backend
//
// Idempotent: re-running leaves existing accounts' passwords untouched and
// only corrects their role if it drifted. Override the emails via
// SEED_ADMIN_EMAIL / SEED_FIELD_AGENT_EMAIL; passwords are always
// generated fresh and printed once — there is nowhere else to recover them
// from, so save them immediately (or drive a password reset afterward
// through the normal `/auth/forgot-password` flow).
import 'dotenv/config';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

interface SeedAccount {
  label: string;
  email: string;
  role: Role;
  /** Agents need a linked Agent profile (fullName is its only required field); admins don't. */
  agentFullName?: string;
}

async function ensureAccount({ label, email, role, agentFullName }: SeedAccount) {
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    console.log(`= ${label} already exists (${email}) — password left untouched.`);
    if (existing.role !== role) {
      await prisma.user.update({ where: { email }, data: { role } });
      console.log(`  role corrected: ${existing.role} -> ${role}`);
    }
    return;
  }

  const password = randomBytes(9).toString('base64url');
  const passwordHash = await argon2.hash(password);

  await prisma.user.create({
    data: {
      email,
      passwordHash,
      role,
      ...(agentFullName ? { agentProfile: { create: { fullName: agentFullName } } } : {}),
    },
  });

  console.log(`+ created ${label}`);
  console.log(`    email:    ${email}`);
  console.log(`    password: ${password}  (printed once — save it now)`);
}

async function main() {
  await ensureAccount({
    label: 'admin (Ops Console — /ops)',
    email: process.env.SEED_ADMIN_EMAIL ?? 'admin@asoju.dev',
    role: Role.ADMIN,
  });

  await ensureAccount({
    label: 'field agent (Field App — /field)',
    email: process.env.SEED_FIELD_AGENT_EMAIL ?? 'agent@asoju.dev',
    role: Role.FIELD_AGENT,
    agentFullName: 'Seed Field Agent',
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
