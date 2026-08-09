/**
 * Staging/production separation (independent readiness review) — the one
 * piece of it that's actually enforceable in code rather than a hosting
 * decision: refuse to boot in production with a config that's still
 * shaped like the checked-in dev example. Every value here has a known,
 * public "unset" default in .env.example; if any of them survive into a
 * NODE_ENV=production process, that process is either still on the dev
 * defaults or someone copied .env.example straight into production
 * without changing it. Both are worth crashing loudly for at startup
 * instead of running silently insecure.
 *
 * Deliberately collects every problem before throwing once, rather than
 * failing on the first — a misconfigured deploy should get one complete
 * list, not a game of whack-a-mole through repeated restarts.
 */

const KNOWN_DEV_DEFAULTS: Record<string, string> = {
  JWT_ACCESS_SECRET: 'change-me-access-secret',
  JWT_REFRESH_SECRET: 'change-me-refresh-secret',
  WHATSAPP_WEBHOOK_SECRET: 'change-me-whatsapp-webhook-secret',
};

const MIN_SECRET_LENGTH = 32;

export function validateProductionEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;

  const problems: string[] = [];

  for (const [key, devDefault] of Object.entries(KNOWN_DEV_DEFAULTS)) {
    const value = env[key];
    if (!value) {
      problems.push(`${key} is not set.`);
    } else if (value === devDefault) {
      problems.push(`${key} is still set to the checked-in .env.example default — this must be a real secret in production.`);
    } else if (key !== 'WHATSAPP_WEBHOOK_SECRET' && value.length < MIN_SECRET_LENGTH) {
      // The webhook secret is a shared stand-in pending real Twilio
      // signature verification (see WhatsappWebhookGuard) — not a signing
      // key — so it isn't held to the same minimum length.
      problems.push(`${key} is shorter than ${MIN_SECRET_LENGTH} characters — too weak for production.`);
    }
  }

  if (!env.DATABASE_URL) {
    problems.push('DATABASE_URL is not set.');
  }

  // main.ts falls back to allowing every origin when CORS_ORIGIN is unset —
  // fine for local dev, never acceptable for a deployed environment.
  if (!env.CORS_ORIGIN) {
    problems.push('CORS_ORIGIN is not set — without it, production falls back to allowing every origin.');
  }

  if (problems.length > 0) {
    throw new Error(
      `Refusing to start with NODE_ENV=production and an insecure/incomplete config:\n` +
        problems.map((p) => `  - ${p}`).join('\n') +
        `\nSee .env.production.example for what a real production config needs to set.`,
    );
  }
}
