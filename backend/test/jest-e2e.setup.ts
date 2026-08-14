/**
 * CI-observed flakiness: `connect ECONNRESET` against a spec file's own
 * Nest HTTP server (returned by `app.getHttpServer()`), striking a
 * rotating, unpredictable set of spec files run over run — never the
 * same one twice, never tied to what a given PR actually changed.
 *
 * Known limitation of this retry: `jest.retryTimes` re-runs only the
 * failing `it()` block, never the file's `beforeAll` — but `app`/
 * `prisma` are created exactly once per file, in `beforeAll`. If that
 * one shared app/pool gets wedged mid-file, every retry (and every
 * later test in the file) hits the same already-broken instance and
 * can't recover — which is why a whole file sometimes fails end to end
 * despite this. The real per-file fix (recreate `app` on failure, not
 * just re-run the assertion) is a larger, all-28-files change tracked
 * separately; DATABASE_URL's `connection_limit` (see ci.yml) reduces
 * the connection/FD pressure that triggers this in the first place,
 * which is the cheaper mitigation to try first. This retry still helps
 * for the genuinely-transient case (a single request resets without
 * taking the app down with it), so it stays.
 */
jest.retryTimes(2, { logErrorsBeforeRetry: true });
