/**
 * CI-observed flakiness: `connect ECONNRESET` against the Postgres
 * service container, striking a rotating, unpredictable set of spec
 * files run over run — never the same one twice, never tied to what a
 * given PR actually changed (see the "ci: run e2e suite serially"
 * commit for the connection-pressure half of this fix). This is
 * transient infrastructure flakiness, not a flaky assertion — the right
 * mitigation is a retry, not weakening what's being asserted.
 */
jest.retryTimes(2, { logErrorsBeforeRetry: true });
