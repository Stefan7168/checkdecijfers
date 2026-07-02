import { defineConfig } from 'vitest/config';

// Most suites boot their own embedded-Postgres instance (PGlite, ADR 009).
// Under a full parallel `npm test` run that is ~10 concurrent instances, and
// vitest's 5s default per-test timeout gets flaky on ingest-heavy tests —
// seen first when WP6 added three more suites. CI runs suites as separate
// steps and never hit it; this raises the ceiling for the local all-at-once
// run. Slow is fine, flaky is not.
export default defineConfig({
  test: {
    testTimeout: 30_000,
  },
});
