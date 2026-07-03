import { defineConfig } from 'vitest/config';

// Most suites boot their own embedded-Postgres instance (PGlite, ADR 009).
// Under a full parallel `npm test` run that is ~10+ concurrent instances, and
// vitest's 5s default per-test timeout gets flaky on ingest-heavy tests —
// seen first when WP6 added three more suites. CI runs suites as separate
// steps and never hit it; this raises the ceiling for the local all-at-once
// run. Slow is fine, flaky is not.
//
// hookTimeout too (WP8): suites that boot + fixture-ingest the database in a
// beforeAll (invariants, benchmark-intents, benchmark-charts) exceed the 10s
// hook default under the same parallel load — the very first fresh-clone
// `npm test` on 2026-07-03 flaked exactly here.
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
