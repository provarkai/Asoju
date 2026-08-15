/**
 * CI-observed flakiness: `connect ECONNRESET` against a spec file's own
 * Nest HTTP server (returned by `app.getHttpServer()`), striking a
 * rotating, unpredictable set of spec files run over run — never the
 * same one twice, never tied to what a given PR actually changed.
 *
 * Three layers now address this, from cheapest to most structural:
 *  1. DATABASE_URL's `connection_limit` (see ci.yml) bounds the
 *     connection/FD pressure each spec file's Prisma pools put on
 *     Postgres.
 *  2. ci.yml's `backend-e2e` job shards the 49 spec files across 4
 *     parallel jobs, each with its own fresh Postgres container —
 *     quartering sustained per-container load and bounding any one
 *     shard's blast radius (also fixed a broken healthcheck that was
 *     silently failing every 5s the whole job: `pg_isready -U asoju`
 *     with no `-d` checks a database matching the username, not
 *     POSTGRES_DB).
 *  3. The fix this comment used to defer: `app`/`prisma` are created
 *     once per file in `beforeAll`, so `jest.retryTimes` re-running
 *     just the failing `it()` was hitting the same already-wedged
 *     instance every time — every retry, and every later test in the
 *     file, failed identically. Every spec file's `beforeEach` now
 *     calls `ensureHealthyApp` (test/utils/bootstrap.ts): a live app
 *     is a no-op, a wedged one gets closed and rebuilt fresh, so a
 *     connection reset costs at most the one test it happened during.
 *
 * This retry still helps for the genuinely-transient case (a single
 * request resets without taking the app down with it), so it stays.
 */
jest.retryTimes(2, { logErrorsBeforeRetry: true });
