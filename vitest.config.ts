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
//
// Raised 30s → 60s (#125a, 2026-07-11): the suite kept growing (two more
// db-booting files that session) and benchmark-charts/cli.test started
// hitting the 30s ceiling on a busy machine — twice in one session, both
// solo-green in ~1.5s. Same class, same fix as above.
//
// Raised 60s → 120s (2026-07-18): the coverage sprint (s49–s54) doubled
// SEED_TABLES 8 → 17, so every createIngestedDb() beforeAll now ingests
// twice the fixtures — tests/query/freshest-quarantine.test.ts hit the 60s
// hook ceiling three times in one session under the query suite's 7
// parallel PGlite boots on a loaded machine, solo-green in 12.5s each time.
// Same class, same fix.
export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // web/ is a standalone Next.js workspace (ADR 018) with its own vitest
    // config, jsdom environment, and `npm run web:test` script — its
    // *.test.tsx files must not be swept into this root, Node-environment run.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
      'web/**',
    ],
  },
});
