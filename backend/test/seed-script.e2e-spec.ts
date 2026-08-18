import { execFileSync } from 'child_process';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { prisma } from './utils/fixtures';

/**
 * backend/prisma/seed.ts bootstraps the very first SuperAdmin account —
 * the one gap adminProvisionAccount (POST /admin/staff-accounts) can't
 * close on its own, since it needs an already-authenticated Admin caller.
 * Exercised as a real subprocess (`npm run seed` runs it the same way)
 * rather than importing it directly, since it's a standalone script with
 * its own `main()`/`process.exitCode` — not something wired into the
 * Nest app the rest of this suite boots.
 */
describe('Seed script — first SuperAdmin bootstrap', () => {
  const backendRoot = path.resolve(__dirname, '..');

  function runSeed(env: Record<string, string>): { status: number; output: string } {
    // Never SEED_SUPERADMIN_EMAIL/PASSWORD in the parent's own process.env
    // (they aren't set by anything in this suite) — start from a clean
    // slate for those two keys each time rather than relying on absence.
    const { SEED_SUPERADMIN_EMAIL: _e, SEED_SUPERADMIN_PASSWORD: _p, ...restEnv } = process.env;
    try {
      const output = execFileSync('npx', ['ts-node', 'prisma/seed.ts'], {
        cwd: backendRoot,
        env: { ...restEnv, ...env },
        encoding: 'utf8',
      });
      return { status: 0, output };
    } catch (err) {
      const e = err as { status: number; stdout: string; stderr: string };
      return { status: e.status, output: `${e.stdout}${e.stderr}` };
    }
  }

  function uniqueEmail(): string {
    return `seed-${randomBytes(4).toString('hex')}@e2e.test`;
  }

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('fails loudly and creates nothing when the required env vars are missing', () => {
    const result = runSeed({});
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('SEED_SUPERADMIN_EMAIL is required');
    expect(result.output).toContain('SEED_SUPERADMIN_PASSWORD is required');
  });

  it('rejects a password shorter than 8 characters', () => {
    const email = uniqueEmail();
    const result = runSeed({ SEED_SUPERADMIN_EMAIL: email, SEED_SUPERADMIN_PASSWORD: 'short' });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('at least 8 characters');
  });

  it('creates a real, working SUPER_ADMIN account', async () => {
    const email = uniqueEmail();
    const result = runSeed({ SEED_SUPERADMIN_EMAIL: email, SEED_SUPERADMIN_PASSWORD: 'Passw0rd!23' });
    expect(result.status).toBe(0);
    expect(result.output).toContain(`Created SuperAdmin ${email}`);

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user?.role).toBe('SUPER_ADMIN');
    expect(user?.isActive).toBe(true);
    expect(user?.passwordHash).toBeTruthy();
  });

  it('is idempotent — re-running against an existing email creates no duplicate and reports "nothing to do"', async () => {
    const email = uniqueEmail();
    runSeed({ SEED_SUPERADMIN_EMAIL: email, SEED_SUPERADMIN_PASSWORD: 'Passw0rd!23' });

    const second = runSeed({ SEED_SUPERADMIN_EMAIL: email, SEED_SUPERADMIN_PASSWORD: 'Passw0rd!23' });
    expect(second.status).toBe(0);
    expect(second.output).toContain('already exists');

    const count = await prisma.user.count({ where: { email } });
    expect(count).toBe(1);
  });
});
