# E2E test suite

Real app, real Postgres — no mocked services, no stubbed guards. Each
spec file boots the actual `AppModule` (`test/utils/bootstrap.ts`) and
drives it over HTTP with `supertest`, the same way a real client would.

## Running

```bash
# One-time: a disposable database the tests can write freely to.
createdb asoju_test   # or: psql -c "CREATE DATABASE asoju_test OWNER asoju;"

# Point at it and apply migrations.
DATABASE_URL="postgresql://asoju:asoju@localhost:5432/asoju_test?schema=public" \
  npx prisma migrate deploy

# Run the suite (needs `backend/.env` present with that same DATABASE_URL,
# plus JWT_ACCESS_SECRET/JWT_REFRESH_SECRET — copy .env.example and edit).
npm run test:e2e
```

Every fixture user gets a random-suffixed email (`test/utils/fixtures.ts`),
so re-running the suite against a non-empty `asoju_test` never collides —
there's no teardown step required, though wiping the database between runs
keeps it small.

## What's covered

- `authorization.e2e-spec.ts` — Non-Negotiable #6 (case-scoped access) and
  the independent readiness review's P0-03/P0-04 items: cross-customer
  IDOR, field-actor BOLA (assignment-scoped access), the org-wide queue vs.
  case-content-access distinction (report Section 7.1), document
  classification, partner-role isolation, and role-mismatched privilege
  escalation attempts. Confirmed to actually catch a regression, not just
  pass vacuously: temporarily removing `CaseAccessGuard` from
  `GET /cases/:id` fails 4 of these tests; restoring it passes all 23.

- `privileged-auth.e2e-spec.ts` — P0-06: MFA enroll → confirm → login
  challenge (including proving the mfa-pending token can't double as a
  real access token), MFA disable, password reset (never reveals whether
  an email exists, revokes every existing session, single-use token), and
  `logout-all` session revocation.

## AI safety tests (unit, not e2e)

`src/ai/ai.service.spec.ts` (run via `npm test`, not `test:e2e`) — P0-09.
This sandbox has no real `ANTHROPIC_API_KEY`, so these can't test whether
Claude itself resists a prompt-injection attempt (Anthropic's job, and
nondeterministic besides). What they test is what's actually in this
codebase's control: `@anthropic-ai/sdk` is mocked to return
attacker-shaped tool output (extra fields, out-of-range scores, a refused
tool-use), and the tests confirm the service still enforces every trust
boundary — the model can never set `customerId` (always resolved from the
session), an out-of-range `engagement_subscore` gets clamped rather than
trusted (Non-Negotiable #8's deterministic scoring), a refused structured
response throws instead of falling back to freeform parsing, and every
completed intake is audited as AI-attributed, never as the user acting
directly. Confirmed to actually catch a regression the same way as the
authorization suite: temporarily letting tool output override
`customerId` fails the relevant test; reverting passes it again.

## What's not covered yet

A broader sweep of every endpoint (the e2e suites exercise the
highest-value IDOR/BOLA and auth paths, not every route), and anything
that requires a live external provider (Paystack, WhatsApp/Twilio,
Anthropic) — those are verified up to the boundary this repo controls,
not through the provider itself. See the project's P0 backlog.
