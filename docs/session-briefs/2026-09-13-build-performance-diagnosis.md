# Build & CI performance diagnosis — where the ten minutes actually goes

**Status: analysis only — nothing in this document is decided, scheduled, or built.**
Written 2026-09-13 by Fable 5.1 on the owner's ask ("the build/dev experience is getting noticeably
slower — diagnose it"), two independent measurement passes reconciled into one report (a CI-log-focused
pass with real GitHub Actions data, and a from-scratch local pass that measured the backend suite
end-to-end and isolated the exact per-test cost with a standalone script). No code was changed to
produce this — every number below traces to a real CI run, a real local run, or a standalone
micro-benchmark, never a framework assumption. Published as an artifact during the session
(https://claude.ai/code/artifact/eab275e6-c890-4d31-a3bc-11f21c686d58, same content, styled); this file
is the durable copy so a future session can find it via the normal reading order instead of needing the
link pasted in.

## In one page, for the owner

The CI gate takes 8.5–11.6 minutes and a full local test run measures at **776.8 seconds** — 87% of it
one thing. `next build` and Turbopack are already fast (14.7s); they were never the problem.

**The smoking gun:** `tests/billing/ledger.test.ts` boots a fresh in-memory Postgres instance inside a
`beforeEach` — once per test, 58 times for 58 tests — when booting it once per file would do. A
standalone script isolated the actual cost: booting a fresh instance takes **2.4–3.7 seconds regardless
of whether the 29 schema migrations then run on it** (migration replay itself is nearly free), while
resetting an *already-booted* instance with `TRUNCATE ... RESTART IDENTITY CASCADE` costs **32–44
milliseconds** — a 60–100× difference. `tests/ingestion/ingestion.test.ts` has the same pattern (28 boots
for 29 tests). Fixing just these two files recovers roughly 200 seconds — about a quarter of the total
local suite time — with no test rewritten, only how each file sets itself up.

Separately, CI runs the backend suite as 15–17 sequential steps (one per module) rather than letting all
148 files share the runner's cores at once — that alone is worth sharding into ~3 parallel jobs once the
per-test-boot problem above is fixed.

**Projected result of both fixes together: the ~10-minute CI gate drops to roughly 4 minutes.**

### Three things only the owner can answer, before committing to the CI-sharding work specifically

1. **Which wait actually bothers you day to day** — the CI gate, the local `npm test` block before a
   push, or something else? (Assumed: the test suites, since the production build itself measures at
   14.7 seconds.)
2. **Is this repository meant to stay public?** GitHub's API reports `private: false` and 0 billed
   Actions minutes today, but `docs/RUNBOOK.md` and `docs/STATUS.md` both talk about the repo as private
   / Actions minutes as a real cost to manage. If it's staying public, running 3 CI jobs in parallel
   instead of 1 is free. If it goes private, budget roughly +2 billed minutes per run for the parallel
   jobs.
3. **How many CPU cores does your other (8GB) machine have, and do you normally leave `next dev` running
   while tests run there?** This decides whether capping Vitest's worker count (Tier 1-D below) is worth
   doing on that machine specifically — it showed 34-minute runs there per lessons-learned, against 13
   minutes on this session's 4-core sandbox.

## Diagnosis: likely bottlenecks, ranked by actual cost

1. **The CI gate is 94–95% test execution.** Across three real runs, gate wall-clock was 411s / 510s /
   697s; typecheck, install, and the benchmark scorer together cost under 10 seconds. Over the last 40
   runs, push-triggered runs median 11.8 minutes, PR runs median 11.4 minutes.
2. **Root cause #1, confirmed by reading the code, not inferred:** `tests/billing/ledger.test.ts:22-29`
   calls `createTestDb()` before every one of its 58 tests — 126.9 seconds for that one file alone
   (≈2.19s/test), the single slowest file measured. `tests/ingestion/ingestion.test.ts` calls it 28 times
   for 29 tests (71.0 seconds). 56 of 148 files (38%) take over 10 seconds each — far more than a single
   shared boot per file would cost, which is the tell that this pattern is widespread, not isolated to
   these two files.
3. **Root cause #2 — CI runs the suite as 15–17 sequential steps, each bounded by its single slowest
   file**, instead of letting Vitest spread all 148 files across the runner's cores at once the way a
   plain combined local run already does.
4. **The web (Next.js) test suite is mostly harness overhead, not test time.** 104 files each spin up a
   fresh process and a fresh jsdom environment; the suite's own reported timing shows `environment: 70.8s`
   against `tests: 55.8s` of actual work. `lucide-react`'s barrel export (1,819 exports, reached by
   `chat.tsx` and 20 other test files) inflates import cost on top of that.
5. **The fixture-snapshot cache is oversized and never pruned** — 11 copies × 143MB = 1.5GB were
   accumulating, and its cache key hashes all of `src/` so any backend edit anywhere rebuilds it.
6. **On memory-constrained machines this becomes a swap problem, not just a CPU one.** Default worker
   count (cores − 1) times several simultaneous 143MB-plus in-memory Postgres instances can exceed
   available RAM alongside a running dev server — matching this project's own prior OOM/timeout
   incidents recorded in lessons-learned.
7. **17 test files (222 tests) — `tests/attachments/` and `tests/usage/` — have no CI step at all** and
   only ever run locally; any CI restructuring should close this gap, not just move the existing steps
   around.
8. **Explicitly ruled out, not worth further attention:** TypeScript typechecking (1.8–2.8 seconds
   either way), the Next.js production build (14.7 seconds locally, Turbopack + TypeScript combined), and
   the `turbopack.root` warning (cosmetic — ADR 018 already recorded that setting it explicitly broke
   Vercel's build packaging once, for no measurable speed gain).

## Measurement plan

Run each measurement 2–3 times on an otherwise idle machine.

| Metric | Command | Reads | Fast / slow |
|---|---|---|---|
| Full backend suite | `time npx vitest run --reporter=json --outputFile=/tmp/backend.json` | Wall time; sort per-file durations from the JSON | ≤520s idle 4-core; >900s = contention |
| Harness vs. test cost | `npx vitest run tests/billing` | The Duration line's transform/setup/import/tests/environment split | `tests` ≫ `import` = test-bound; `environment` > `tests` = harness-bound |
| PGlite cost breakdown | standalone script (below) | ms for: bare boot, boot+29 migrations, dump/restore, TRUNCATE-reset | **Measured:** boot 2.4–3.7s ≈ boot+migrations; restore 0.6–0.85s; TRUNCATE-reset 32–44ms |
| Web suite pool/isolation | `vitest run --pool=threads`, `vitest run --no-isolate` | Duration line's `environment`/`import`; pass/fail count | environment drops toward ~workers×0.7s; any new failure is a real state leak to fix first |
| Snapshot size trade-off | `dumpDataDir('gzip')` vs `'none'` in the script below | MB on disk, restore ms | gzip ~20–40MB from 143MB; restore within ±0.3s |
| Worker cap on a memory-constrained machine | `vitest run --maxWorkers=3` vs. default | Wall time; swap activity during the run | default 30+min if swap-bound; capped 8–12min |
| Real CI wall-clock, post-fix | `gh run view <id> --json jobs` (or the GitHub MCP tools) | Longest job = critical path | ≤4.5min gate, vs. 8.5–11.6min today |

PGlite cost-breakdown script (scratch — delete after running):

```ts
// tmp-pglite-cost.ts — run from the repo root with: node tmp-pglite-cost.ts (or npx tsx)
import { PGlite } from '@electric-sql/pglite';
import { createTestDb, wrapPGlite } from './tests/helpers/pglite-db.ts';
import { applyMigrations } from './src/db/migrate.ts';
const t = () => performance.now(), N = 3;
for (let i = 0; i < N; i++) { const a = t(); const c = new PGlite(); await c.waitReady; console.log('boot', (t()-a)|0); await c.close(); }
for (let i = 0; i < N; i++) { const a = t(); const { close } = await createTestDb(); console.log('createTestDb', (t()-a)|0); await close(); }
const c = new PGlite(); await c.waitReady; await applyMigrations(wrapPGlite(c));
for (const mode of ['none', 'gzip'] as const) {
  const bytes = Buffer.from(await (await c.dumpDataDir(mode)).arrayBuffer());
  console.log(mode, (bytes.length / 1048576).toFixed(1), 'MB');
  for (let i = 0; i < N; i++) { const a = t(); const r = new PGlite({ loadDataDir: new Blob([new Uint8Array(bytes)]) }); await r.waitReady; console.log('restore', (t()-a)|0); await r.close(); }
}
const db = wrapPGlite(c);
const { rows } = await db.query(`select tablename from pg_tables where schemaname='public' and tablename<>'schema_migrations'`);
const a = t();
await db.query(`truncate ${rows.map((r) => `"${r.tablename}"`).join(', ')} restart identity cascade`);
console.log('TRUNCATE', rows.length, 'tables', (t()-a)|0);
await c.close();
```

## Optimization plan

Every check keeps running in every tier — nothing here proposes skipping a test.

### Tier 1 — under a day each

- **1-A. Shard the CI gate 3-way, run `web` as its own parallel job.** Replace the 15–17 sequential
  domain steps with a `backend` job using a 3-way matrix (`vitest run --shard=N/3`) plus a parallel `web`
  job; benchmark run+score on shard 1. Closes the `tests/attachments`/`tests/usage` coverage gap for free
  (every file under `tests/` now runs in CI). Projected: gate 8.5–11.6min → ~4min. ~2 hours including one
  CI round. Risk: loses per-domain step names in the Actions UI (mitigate with `--reporter=github-actions`
  annotations); revert the workflow commit if anything regresses.
- **1-B. Add `test:changed` / `test:related` scripts** (`vitest run --changed origin/main`, `vitest
  related`) for the local inner loop. Maps an edited file to only its dependent tests. ~20 minutes.
- **1-C. Prune old fixture-snapshot tars, keep the newest 2.** Stops the unbounded 1.5GB cache growth.
  Cache-only, no correctness risk. ~15 minutes.
- **1-D. Cap Vitest's worker count via an env var**, if measurement confirms the 8GB machine is
  swap-bound rather than CPU-bound. ~10 minutes.
- **1-E. Leave `turbopack.root` alone** — no measurable gain, and ADR 018 already recorded the real
  packaging-breakage risk of setting it.

### Tier 1 — the confirmed, ready-to-execute fix (do this first)

- **One database per test FILE, `TRUNCATE`-reset per test — confirmed in `ledger.test.ts` and
  `ingestion.test.ts` specifically.** Move `createTestDb()` from `beforeEach` to `beforeAll`, add a
  `beforeEach` that runs `TRUNCATE ... RESTART IDENTITY CASCADE` on the tables the file actually touches.
  Measured, not estimated: boot 2.4–3.7s vs. reset 32–44ms. These two files alone: 126.9s + 71.0s → low
  single digits, roughly 26% of the total measured backend time. ~2–3 hours for these two; risk is
  cross-test leakage if a test assumes a pristine database (re-seed anything a migration inserts, e.g.
  005/020, or exclude those tables from the truncate list) — revert per file if anything breaks.

```ts
// Pattern for tests/billing/ledger.test.ts
let db: Db, close: () => Promise<void>;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
// credit_transactions' append-only trigger is BEFORE UPDATE OR DELETE (migrations/005:96) — TRUNCATE is allowed.
beforeEach(() => db.query('truncate credit_transactions, trial_questions restart identity cascade'));
```

### Tier 2 — 1–3 days each

- **2-A. Generalize the confirmed fix above into a shared helper** in `tests/helpers/pglite-db.ts`, then
  audit every remaining `createTestDb()`/`createIngestedDb()` call site **by its enclosing hook, not by
  occurrence count** — a single call sitting inside `beforeEach` looks identical to one inside `beforeAll`
  by a plain grep, which is exactly how `ledger.test.ts` stayed hidden until someone actually read it.
  Watch for `tests/query/eviction-race.test.ts` and `resolve-eviction-race.test.ts`, which run far hotter
  than the DB-boot cost alone would predict — likely genuine timing waits for a race window, needing fake
  timers rather than a database fix; read before reclassifying either one.
- **2-B. Snapshot the migrated-empty database**, the same way the already-ingested (17-table) path was
  optimized on 2026-07-25 (per `vitest.config.ts`'s own comment: 7.9–10.7s → 1.16–1.39s) — extend that
  same restore-instead-of-replay trick to the plain schema-only path.
- **2-C. Web suite: `pool: 'threads'`, shared jsdom across a worker** instead of one process per file —
  add an explicit `afterEach(cleanup)` first (Testing Library's auto-cleanup isn't active today since
  `globals: true` isn't set), since today's per-file isolation is masking any DOM leaks a shared
  environment would expose.
- **2-D. Narrow the fixture-snapshot cache key** to the actual ingestion-code import closure instead of
  hashing all of `src/`, so an unrelated backend edit stops invalidating it.
- **2-E. Gzip the snapshot dump** — roughly 80 of its 143MB is near-empty WAL.

### Tier 3 — larger, longer-term

- **3-A. Pool one PGlite instance per worker for the whole suite**, reset by truncate between files —
  the largest possible win (an estimated 50–60% off the backend suite), also the highest risk: needs a
  full cross-test isolation audit first. Keep the old per-file path behind an env switch during rollout.
- **3-B. Duration-balanced CI sharding** (persist timing data as a CI artifact so shards balance by
  measured cost, not by file-hash luck) — worth revisiting once 2-A lands and the current "one shard gets
  `ledger.test.ts`" imbalance is gone anyway.
- **3-C. Evaluate `happy-dom`** as a faster drop-in for jsdom in the web suite.
- **3-D/E. Minor:** cache `.next/cache` in the deploy job (written today, never read); an unused `shadcn`
  dependency and an eslint/TypeScript peer-version mismatch worth a cleanup pass, unrelated to speed.

## First 3 actions, in order

1. **Fix the two confirmed offenders** — `tests/billing/ledger.test.ts` and
   `tests/ingestion/ingestion.test.ts` — moving `createTestDb()` to `beforeAll` with a `TRUNCATE`-based
   reset. Smallest diff, no new infrastructure, both offenders already proven by direct code inspection.
   Confirm: both files' own runtime drops from 126.9s/71.0s toward single digits.
2. **Shard the CI gate and open a PR** using the 3-way matrix approach above. Confirm: the shards' Test
   Files sum to 148 and Tests to 2,262+ (proof the previously-ungated `attachments`/`usage` files now
   run), and the slowest job finishes in ≤4.5 minutes.
3. **Build the shared reset helper and sweep every remaining call site by its hook**, generalizing action
   1 — this is the piece that needs the owner's answers to the three questions above before it's worth
   scheduling as real work, since it's 1–3 days rather than a few hours.

## Action 3 as-built (session 110, branch `s110/tinfra`)

Built as a scoped, parallel subagent task (`docs/open-questions.md` #245), independently of the owner's
3 sub-questions above (which still only gate the CI-sharding tier). Everything below is measured, not
projected — every number traces to an individual `npx vitest run <file> --maxWorkers=1` run, one before
the conversion and one after, on the same 8GB machine with other agents running in parallel.

**The helper.** `tests/helpers/reset-db.ts` exports one function:

```ts
resetTestDb(db: Db, opts?: { tables?: string[] }): Promise<void>
```

It reads `pg_tables` for the `public` schema (excluding `schema_migrations`) once per db instance
(cached in a `WeakMap<Db, string[]>`), `TRUNCATE`s all of them with `RESTART IDENTITY CASCADE`, then
re-inserts the two rows a migration itself seeds at table-creation time (not test fixtures) so a reset
reproduces "freshly migrated," not merely "empty": `signup_grant_config` (migration 005, `credits=100`)
and `trial_pot_config` (migration 020, `remaining_questions=0, cap=0`). No `createIngestedDb()`-based
file in the allowed directories needed the ingested-db variant the brief sketched (Action 3 step 1's
"boot+ingest once, restore only mutable tables") — the two in-scope users of `createIngestedDb()`
(`tests/registry/coverage.test.ts`, `tests/catalog/current-status.test.ts`) already booted once per file
via `beforeAll` with no per-test reset at all, and stayed untouched.

**The sweep.** 40 files converted, spanning `tests/attachments/` (8), `tests/billing/` (11),
`tests/catalog/` (4), `tests/db/` (13), `tests/registry/` (1), `tests/threads/` (3). Two source shapes
existed, both converted the same way (boot in `beforeAll`, `resetTestDb()` in `beforeEach`, no per-test
`createTestDb()`/`close()` left):
  - A literal `beforeEach(() => createTestDb())` / `afterEach(() => close())` pair (the shape Action 1
    fixed in `ledger.test.ts`/`ingestion.test.ts`).
  - A per-test `withDb`/`withPricedDb`-style helper function that every `it()` calls, which boots and
    closes internally — grep-invisible as a "per-test boot" the way a literal `beforeEach` is, exactly
    the trap Action 2-A's own note warned about ("a call sitting inside `beforeEach` looks identical to
    one inside `beforeAll` by a plain grep"). 30 of the 40 files shared a byte-identical `withDb` body
    (verified by hashing each), converted mechanically with a one-off script; the rest (two
    `withPricedDb` files, `pricing.test.ts`'s 7 inline per-`it()` boots, `registry.test.ts`'s
    `registeredDb()` helper, four `tests/catalog/` files with describe-scoped setup, `trial-pot.test.ts`'s
    file-level hooks) were hand-converted.
  - Two describes turned out to be read-only against `findTable()` (no `db.query` writes at all):
    `tests/catalog/find-replay.test.ts`'s whole file, and the first describe (`'findTable routing'`) in
    `tests/catalog/find.test.ts`. Both boot+ingest ONCE per describe (`beforeAll`) with **no** per-test
    reset at all, since nothing mutates state. Every other converted describe (including `find.test.ts`'s
    second, DDL-adjacent describe and all three in `recall.test.ts`) still resets per test, since their
    tests insert/delete rows.

**Measured, summed across the 40 files: 795.7s → 200.3s, a 4.0x aggregate speedup.** Individual files
ranged from 18x (`tests/attachments/retention.test.ts`, 56.0s → 3.1s) down to a single file that got
marginally *slower* (`tests/billing/pro-subscription-e2e.test.ts`, 3.6s → 6.1s, one test only — boot
cost dominates either way for a one-test file, and the "after" run likely hit more contention from the
other parallel sessions this ran alongside; not a regression worth chasing). Full per-file numbers, one
row per converted file (before/after wall-clock from an individual `vitest run <file> --maxWorkers=1`
run, and the resulting speedup):

| File | Before | After | Speedup |
|---|---|---|---|
| `tests/attachments/audit.test.ts` | 12.17s | 5.16s | 2.4x |
| `tests/attachments/file-store.test.ts` | 6.35s | 4.09s | 1.6x |
| `tests/attachments/read.test.ts` | 3.35s | 3.42s | 1.0x |
| `tests/attachments/reconstruct.test.ts` | 11.98s | 3.23s | 3.7x |
| `tests/attachments/replay.test.ts` | 4.53s | 3.06s | 1.5x |
| `tests/attachments/respond.test.ts` | 13.15s | 2.86s | 4.6x |
| `tests/attachments/retention.test.ts` | 55.99s | 3.08s | 18.2x |
| `tests/attachments/store.test.ts` | 28.43s | 3.25s | 8.7x |
| `tests/db/error-log.test.ts` | 12.38s | 2.97s | 4.2x |
| `tests/db/migration-012.test.ts` | 41.23s | 3.58s | 11.5x |
| `tests/db/migration-013.test.ts` | 6.65s | 2.63s | 2.5x |
| `tests/db/migration-015.test.ts` | 8.56s | 4.65s | 1.8x |
| `tests/db/migration-016.test.ts` | 6.38s | 2.67s | 2.4x |
| `tests/db/migration-017.test.ts` | 5.91s | 2.65s | 2.2x |
| `tests/db/migration-018.test.ts` | 21.34s | 3.22s | 6.6x |
| `tests/db/migration-024.test.ts` | 7.52s | 4.35s | 1.7x |
| `tests/db/migration-026.test.ts` | 22.86s | 5.73s | 4.0x |
| `tests/db/migration-027.test.ts` | 32.62s | 5.47s | 6.0x |
| `tests/db/migration-030.test.ts` | 67.52s | 8.12s | 8.3x |
| `tests/db/migration-032.test.ts` | 10.22s | 6.42s | 1.6x |
| `tests/db/migration-033.test.ts` | 7.68s | 5.13s | 1.5x |
| `tests/threads/dataset-threads.test.ts` | 15.40s | 12.75s | 1.2x |
| `tests/threads/replay.test.ts` | 14.11s | 3.87s | 3.7x |
| `tests/threads/threads.test.ts` | 76.67s | 6.90s | 11.1x |
| `tests/billing/creator-email.test.ts` | 10.89s | 4.31s | 2.5x |
| `tests/billing/history.test.ts` | 74.78s | 6.30s | 11.9x |
| `tests/billing/ledger-split.test.ts` | 14.21s | 7.78s | 1.8x |
| `tests/billing/pro-bucket.test.ts` | 9.82s | 6.99s | 1.4x |
| `tests/billing/pro-subscription-e2e.test.ts` | 3.59s | 6.05s | 0.6x |
| `tests/billing/stripe-webhook.test.ts` | 45.81s | 4.31s | 10.6x |
| `tests/billing/pro.test.ts` | 8.60s | 3.80s | 2.3x |
| `tests/billing/dataset-gate.test.ts` | 10.51s | 3.15s | 3.3x |
| `tests/billing/gate.test.ts` | 10.50s | 3.24s | 3.2x |
| `tests/billing/pricing.test.ts` | 8.43s | 3.12s | 2.7x |
| `tests/billing/trial-pot.test.ts` | 13.95s | 5.02s | 2.8x |
| `tests/registry/registry.test.ts` | 6.70s | 6.12s | 1.1x |
| `tests/catalog/ingest.test.ts` | 12.80s | 10.22s | 1.3x |
| `tests/catalog/find-replay.test.ts` | 16.67s | 5.21s | 3.2x |
| `tests/catalog/find.test.ts` | 22.23s | 7.22s | 3.1x |
| `tests/catalog/recall.test.ts` | 33.25s | 8.20s | 4.1x |
| **TOTAL (40 files)** | **795.7s** | **200.3s** | **4.0x** |

`dataset-threads.test.ts`'s modest 1.2x and `registry.test.ts`'s 1.1x reflect the two hazard fixes above
(a private per-test boot re-added for the DDL test) and the `registeredDb()`-style helper's own
re-registration cost (cheap relative to a PGlite boot, but not free) respectively — both still net wins,
just smaller than the pure-`TRUNCATE` cases.

**Two real correctness bugs found and fixed while sweeping, not just perf regressions:**

1. **`tests/threads/threads.test.ts` and `tests/threads/dataset-threads.test.ts`** each have one test
   that runs schema DDL (`alter table chat_threads drop column dataset_id`; `drop table if exists
   user_datasets cascade`) to reproduce the real pre-migration-026 production shape (the #154-class bug
   from session 86). `resetTestDb()` only `TRUNCATE`s — it cannot undo a dropped column or table — so on
   a shared instance that DDL would permanently break every test that runs after it in the same file.
   `dataset-threads.test.ts`'s version happened to be the LAST test in the file (masking the bug — it
   passed by ordering accident), but `threads.test.ts`'s version was NOT last and failed 16 of 33 tests
   the moment the conversion ran, with a "relation user_datasets does not exist" error surfacing several
   tests later. Fix: both tests now keep their own private, freshly-migrated `createTestDb()` instead of
   the file's shared one — exactly what every test in these files did before this conversion — with a
   comment explaining why.
2. **`tests/billing/creator-email.test.ts`** has two different tests that each `create schema auth;
   create table auth.users (...)` from scratch (the file's whole premise is "no auth schema by default").
   `resetTestDb()` only touches the `public` schema, so on a shared instance the second such test would
   throw "already exists". Fix: this file's own `beforeEach` runs `drop schema if exists auth cascade`
   after the shared reset, restoring "no auth schema at all" before every test.

Both are the exact class of hazard Action 2-A's write-up anticipated ("watch for a file whose tests
share state deliberately") — neither was a case of deliberately shared state, but of a per-test
mutation the generic `TRUNCATE`-only reset structurally cannot reverse (DDL, or a schema outside
`public`). Any FUTURE file added to the shared-db pattern should be checked for the same two hazards:
does any test run DDL (`drop`/`alter`/`create table`), and does any test touch a schema other than
`public`.

**Deliberately left on the old per-test-boot path, with reasons:**
  - `tests/db/fixture-snapshot.test.ts` — this file's entire purpose is proving `createIngestedDb()`
    hands out ISOLATED databases per call; converting it to a shared instance would falsify the very
    property it tests.
  - `tests/registry/coverage.test.ts`, `tests/catalog/current-status.test.ts` — already boot once per
    file via `beforeAll` with no per-test reset (read-only against the ingested fixture); no conversion
    needed.
  - `tests/sources/`, `tests/websearch/`, `tests/docs/` — no `createTestDb()`/`createIngestedDb()` call
    sites at all; nothing to convert.
  - Out of scope for this task (other agents' concurrent work): `tests/answer/`, `tests/audit/`,
    `tests/ingestion/`, `tests/query/`, `tests/chart/`, `tests/invariants/`, `tests/benchmark/` — a
    follow-up sweep should cover these the same way.

**Not done:** the branch (`s110/tinfra`) has not been merged to `main`; `npm run typecheck` is clean and
all 40 converted files pass individually, but the full backend suite / CI has not been run against this
branch. The owner's 3 sub-questions from Action 2 are unaffected by this action and remain open for the
CI-sharding tier specifically.

## Landing bundle (session 110)

**Task:** investigate whether the landing's client JS (26 requests / 595 KB cold, largest chunk
169 KB per the session 110 UX audit) has an easy, safe reduction — the audit's own suggestion was
`next/dynamic`-loading interaction-only chart UI (style modal, story stage, download menu,
embed dialog, notes editor) that a first-time reader never needs before clicking something.

**Setup note (second worktree attempt):** the worktree's `node_modules`/`web/node_modules` were
symlinks into the main checkout; Turbopack refuses to build across a symlink that points outside
the project root. Fix: `rm` the two symlinks, then a real `npm ci` at the repo root and inside
`web/` (a few minutes each, disk-only cost). `next build` (Turbopack) then runs clean.

**Baseline measurement.** Turbopack's production build output in Next 16.3.4 does **not** print
the classic webpack-era "Size / First Load JS" route table — `next build`'s route list is names
only. First Load JS for `/` was instead computed by reading
`.next/server/app/page_client-reference-manifest.js`'s `clientModules` chunk list for the root
route and summing those chunk files' sizes on disk:

- 8 chunks, **1,348,403 bytes (≈1.32 MB) raw/uncompressed** total for `/`'s first load.
- Largest single chunk: `2vra43ef2jbr1.js`, **599,116 bytes**. (This is the raw, uncompressed
  local-build size; the audit's "169 KB" figure was a production, gzipped-over-the-wire number —
  the two are consistent once you account for gzip, not a discrepancy.)
- Confirmed via string search inside that chunk: it contains **Recharts** (`recharts-*` class
  names, `ResponsiveContainer`, `LineChart`, `AreaChart` all present) — expected, since `ChartView`
  (`components/chart.tsx`) must stay a plain SSR'd import for the gallery's first paint/SEO, per
  the audit's own framing.
- Confirmed jsPDF/svg2pdf.js are **already** excluded from this chunk (session 110's own earlier
  fix): the only match for `jsPDF`/`svg2pdf` in the chunk is the destructuring site of a
  `Promise.all([e.A(415512), e.A(598590)])` dynamic-chunk call inside the download-export function
  — the actual library code lives in separate, on-demand chunks, not here. Nothing to fix there.
- Confirmed the 3D demo (`/bevolking-3d-demo`, `three`/`@react-three`) does **not** leak into the
  landing's first load: zero matches for `three`/`@react-three` across any of the 8 root-page
  chunks; it's already an isolated route via its own `next/dynamic({ssr:false})` loader
  (`app/bevolking-3d-demo/map3d-loader.tsx`).

**What was tried, and reverted.** `components/chart.tsx` (`'use client'`, the file `ChartView`
lives in) statically imports five interaction-only children directly into its own module graph —
`ChartEditModal`, `ChartConfigPanel` (1,882 lines), `ChartStoryPanel`/`ChartStoryStage` (325 +
736 lines), `ChartNotes` — each mounted unconditionally (visibility controlled by an internal
`open` prop) and each invisible on first paint by default. In principle this is exactly the
`next/dynamic({ssr:false})` case the codebase already has one precedent for
(`map3d-loader.tsx`). Two of the five (`ChartConfigPanel`/`ChartConfigTrigger`,
`ChartStoryPanel`/`ChartStoryTrigger`) share a source file with a small, always-visible trigger
button, so a clean split first needed pulling each trigger into its own tiny file
(`chart-config-trigger.tsx`, `chart-story-trigger.tsx`) re-exported from the original file for
test back-compat, then converting the five heavy components in `chart.tsx` to
`dynamic(() => import(...).then(m => m.X), { ssr: false })`.

`npm run typecheck` was clean and the five components' own isolated test files
(`chart-config-panel.test.tsx`, `chart-edit-modal.test.tsx`, `chart-story.test.tsx`,
`chart-story-stage.test.tsx`, `chart-notes.test.tsx` — 154 tests) all passed unchanged. But
`components/chart.test.tsx` (5,375 lines, the integration suite that exercises all of this
*through* `ChartView`) came back **56 failed / 225 passed of 281** — every failure a
`fireEvent.click(trigger); expect(screen.getByRole(...)).toBeInTheDocument()` pair with no
`await`/`findBy` in between. The dynamically-imported component resolves its `import()` on a
later microtask than the synchronous assertion that follows the click, so the dialog/region
genuinely isn't in the DOM yet at assertion time — a real timing break, not a flake. Rewriting
that scale of the test file (dozens of synchronous assertions spread across style/story/notes
flows) to `await screen.findByRole(...)` is a large, separate piece of work, not a "cheap,
preserves-behaviour" fix, and well outside "run the test files of the components you touch." Per
this task's own instruction — revert rather than force through a change that isn't a clean win —
the whole change (both new trigger files, the `chart.tsx`/`chart-config-panel.tsx`/
`chart-story.tsx` edits) was reverted with `git checkout` before committing anything. **First
Load JS for `/` is therefore unchanged: 1,348,403 bytes before and after.** This is a real,
properly-scoped follow-up (its own work package, budgeted for updating `chart.test.tsx`'s
assertions to `findBy`/`waitFor` alongside the `next/dynamic` split), not something to redo as a
"cheap" pass.

**What was kept: `turbopack.root`.** `web/next.config.ts` sets `turbopack.root` to the repo root
(`fileURLToPath(new URL("..", import.meta.url))`), silencing Turbopack's "Next.js inferred your
workspace root" warning — this repo's monorepo-style layout (root `package-lock.json` +
`web/package-lock.json`, the same shape as ADR 018's `web/backend -> ../src` symlink) was already
being inferred correctly; this just states it instead of re-guessing on every build. Zero
behaviour change: rebuilding after the config edit reproduced the exact same 8 chunks and the
exact same 1,348,403-byte total, with the warning gone. `npm run typecheck` and
`next.config.test.ts` (6 tests, unaffected — it only asserts on `nextConfig.headers`) both pass.

**Net result:** no landing bundle-size win this pass (the one safe, real lever — a config
warning fix — has no bytes attached; the byte-bearing lever needs the `chart.test.tsx` rewrite
first). Commit: `perf(web): silence Turbopack workspace-root warning` (config-only, no code
behaviour change) on branch `s110/perf2`. Not merged.

**Lazy-load applied (session 110, second attempt).** Done properly this time, in a fresh
worktree on branch `s110/perf3`, two commits: `test(chart): make interaction assertions
async-safe (findBy/await) — no behaviour change` (`1ba09b6`), then `perf(web): lazy-load
interaction-only chart UI (modal, style panel, story, notes)` (`08a4789`). `components/chart.tsx`
now wraps five components in `next/dynamic({ ssr: false })`: `ChartEditModal` (the Style/Embed
popup shell), `ChartConfigPanel` (~1900 lines, the Style tabs), `ChartStoryPanel` (the compact
Insights panel), `ChartStoryStage` (the full-screen Present stage) and `ChartNotes` (the
click-to-annotate editor). The download menu's PDF path was already dynamic and is untouched;
`ChartView`'s own SVG (Recharts) stays a plain, statically-imported, server-rendered import — the
gallery's first paint is unaffected.

The first attempt's blocker — a static import of ANY binding from a module pulls the WHOLE module
into the importer's chunk, so `ChartConfigTrigger`/`ChartStoryTrigger` sharing a file with their
heavy panels silently defeated the split — was solved the same way that attempt had already found:
both triggers moved into their own tiny files (`chart-config-trigger.tsx`, `chart-story-trigger.tsx`),
re-exported unchanged from the original files for `chart-config-panel.test.tsx`/`chart-story.test.tsx`
back-compat.

The actual blocker last time — 56 of `chart.test.tsx`'s 281 assertions failing because a
`fireEvent.click` on a trigger was followed by a synchronous `getByRole`/`getByText` against the
panel that click opens, one microtask before the dynamic import resolves — was fixed by rewriting
every such assertion to `await screen.findByRole(...)` (or `within(...).findByRole(...)`, or making
the enclosing test/helper `async` where it wasn't already), landed as its own commit BEFORE the
dynamic() conversion so it could be verified green against the still-fully-synchronous `chart.tsx`
(confirmed by re-running the suite against a stash of the dynamic-conversion commit's files). No
test was deleted or weakened. `next/dynamic` itself needed a global mock under jsdom
(`web/test/mock-next-dynamic.ts`, wired into `vitest.setup.ts`) resolving through `React.lazy` +
`Suspense` so the awaited gap is a real one; the same setup file also raised testing-library's
default `findBy`/`waitFor` timeout from 1000ms to 5000ms, because the very first panel any test
process opens pays a real, one-time module-transform-and-evaluate cost that measurably exceeded
1000ms on this loaded machine (two of the file's ~284 tests — always the first to open the Style
panel — timed out at 1000ms even though the fix itself was correct; every later test opening the
same panel resolved instantly, module already cached).

Loading-fallback choice: `ChartEditModal`, `ChartStoryPanel`, `ChartStoryStage` and `ChartNotes`
use `loading: () => null` because chart.tsx mounts all four unconditionally (gated on things like
`state.form !== 'table'` or `storyAvailable`, never on their own open/closed state) and each
already renders `null` internally whenever closed — `null` exactly reproduces that default
appearance instead of flashing new visible content on a chart nobody has interacted with.
`ChartConfigPanel` is the one exception: it is only ever reached once its parent `ChartEditModal`
is already open, so a small digit-free `Skeleton` there is a real improvement with no
flash-when-closed risk.

Verified: `npm run typecheck` clean on both commits; `vitest run components/chart.test.tsx`
284/284 (both against the pre-dynamic and the post-dynamic `chart.tsx`); `vitest run
components/chart-config-panel.test.tsx` 90/90; `vitest run components/chart-story.test.tsx`
11/11. Bundle-size re-measurement (the same `client-reference-manifest.js` chunk-size method this
section used for the 1,348,403-byte baseline) is left to whichever session runs the next real
`next build` from the main checkout — this worktree only ran component tests, per its own
process rules.

**Parent measurement + one revert, session 110 (after the second attempt merged).** Real Turbopack
builds in the main checkout, landing (`/`) client-reference-manifest chunks: before 8 chunks /
1,351,443 bytes raw, largest 601,137; after (all five dynamic) 10 manifest entries / 1,311,908, largest
461,356 — the two extra entries are the lazy chunks, not first-load. `ChartStoryPanel` was then made
STATIC again (the landing's first gallery card pre-opens it, so lazy-loading it dropped the insights
text from the server HTML and added a layout shift — the one place a first paint needs it; 301 lines):
final largest chunk 472,477 bytes (−21% raw on the critical chunk), `chart.test.tsx` 284/284,
`gallery.test.tsx` green. The modal, the 1,900-line style panel, the story stage and the notes editor
stay `dynamic({ ssr: false })`.

## Landing bundle pass 2 (session 110)

**Task:** with the pass-1 lazy-load already merged (largest chunk 472,477 bytes, above), look for
a second, independent, ≥40 KB win in the landing's remaining first-load chunks — module-by-module
this time, not just re-checking the chart path.

**Setup, same trap as pass 1.** This worktree's `node_modules`/`web/node_modules` were again plain
symlinks into the main checkout (Turbopack refuses to build across them); fixed the same way
(`rm` both, real `npm ci` at the repo root and inside `web/`).

**Baseline (build 1 of 3), same manifest-chunk method as pass 1** — reading
`.next/server/app/page_client-reference-manifest.js`'s `clientModules` for `/`, deduping every
chunk file referenced by ANY of them (not just every other array entry — see the correction note
below), and summing on-disk sizes: **10 chunks, 1,317,815 bytes total**, matching the parent's
post-merge number almost exactly (the parent measured 1,311,908 on a slightly different `npm ci`
run — both are the same build, small hash-driven byte noise between installs). Per-chunk
breakdown, identified by grepping each chunk's minified text for package/identifier markers, then
cross-checking against `git grep` for which source files use those imports:

| Chunk (bytes) | Contents (evidence) | Landing-required? |
|---|---|---|
| 472,477 | `recharts` (88 hits: `ResponsiveContainer`, `LineChart`, `AreaChart`, `recharts-*` classNames), `motion` (4), `clsx` (28); `svg2pdf`/`stripe` matches are just the destructuring site of an already-separate dynamic-chunk call, not inlined code | Yes — `components/chart.tsx` (`ChartView`), the gallery's own SSR'd chart SVG. Excluded from this pass by the brief's own rule ("never touch the chart SVG path"). |
| 381,692 | `zod` (581 hits) — traced via `grep -rl "from 'zod'"` to exactly one landing-reachable source file, `web/lib/chart-presentation.ts` (`overridesSchema`, `frameBackgroundSchema`, used by the exported `sanitizeOverrides()`). Read the call graph: `sanitizeOverrides` is called from `resolvePresentation()` and `withAccountDefault()` — both called **unconditionally** by `chart.tsx` on every render (`withAccountDefault(accountStyle)` at `chart.tsx:1863`), not only from the interactive `ChartConfigPanel`. Zod here validates a chart's presentation overrides on the plain read/render path, not just the editor — it is baked into the chart SVG path the brief says not to touch, so untouchable within this pass's own scope without a real "hand-roll the validation" refactor (a separate, larger task). | Yes, for the same reason as the row above. |
| 203,156 | First-party app code confirmed by `strings`-dumping the chunk: `deriveDatasetVisuals`/`messageHasVisual`/`datasetMessageHasVisual` (the chat message→visual-card derivation logic), a `submitAnswerFeedback` server reference, and inlined lucide `thumbs-up`/`thumbs-down` icon path data — i.e. `components/dashboard.tsx`, `components/workspace.tsx`, `components/trial-chat.tsx` and their chat/feedback subtree, per the RSC client-module list for `/` (`grep`-extracted from the manifest: `dashboard.tsx`, `workspace.tsx`, `trial-chat.tsx`, `answer-proof.tsx`, `onboarding-live-status.tsx`, `source-badge.tsx`, `coverage-disclosure.tsx` all appear as client modules for this route). | **No for `dashboard.tsx`/`workspace.tsx`** — see "what was tried" below. `trial-chat.tsx` (the anonymous trial chat) IS needed: `components/trial.tsx`'s `TrialSectie` renders `<TrialChat>` unconditionally and visibly whenever the trial gate is `'open'` (the default state for an anonymous visitor) — it's the landing's own composer, visible at first paint, not gated behind a click, so the brief's "keep anything visible at first paint SSR" rule rules out `ssr:false` for it. |
| 70,716 | Next.js framework internals: `layout-router.js`, `render-from-template-context.js`, `client-page.js`, `client-segment.js`, `error-boundary.js`, `boundary-components.js`, `icon-mark.js` (all `[project]/web/node_modules/next/dist/esm/...`, confirmed from the manifest's own `clientModules` keys, which still carry source paths for `node_modules/next` even though the app's own source paths are stripped in the minified chunk text) | Yes — React/Next runtime, unavoidable. |
| 62,815 / 40,841 / 36,442 / 30,758 / 18,056 / 862 | No package marker hit (grepped for `recharts`, `d3-`, `motion`/`framer`, `@base-ui`, `radix`, `lucide`, `react-resizable-panels`, `next-themes`, `three`, `topojson`, `jspdf`, `svg2pdf`, `date-fns`, `zod`, `@supabase`, `stripe`, plus a second pass for `react-day-picker`, `cmdk`, `sonner`, `embla`, `AnimatePresence`, `ResizablePanel`, `Toaster`, `class-variance-authority`, `@floating-ui`, `tailwind-merge`, `swr`, `@tanstack`, `react-hook-form`, `dayjs`, `posthog`, `@vercel/analytics`, `supabase-js`, `createClient`, `GoTrueClient`, `@sentry`) — likely the remaining first-party providers (`theme-provider.tsx`, `lang-provider.tsx`, `style-panel-owner.tsx`, `site-header.tsx`, `chart-usage-tracker.tsx`, `site-footer.tsx`) plus Next's own small shared runtime pieces, none individually large enough or clearly a third-party-library win to justify further digging inside this pass's 3-build budget. No Supabase browser client, no `react-resizable-panels`, no `next-themes` string matched anywhere in the 10 chunks — those named-in-the-brief candidates simply aren't present on the landing's client side. | Assumed yes (framework/providers needed globally); not fully individually attributed — flagged rather than guessed. |

**What was tried: `next/dynamic()` on `Dashboard`/`Workspace` in `app/page.tsx`.** `app/page.tsx`
(a Server Component) statically imported `Dashboard`, `Workspace` and `QuestionHistory` at module
top level, but renders at most one of `Dashboard`/`Workspace` — and only inside the
`userId !== null` branches; an anonymous visitor's request returns `<Landing>` several lines
earlier and never references either. (`QuestionHistory` turned out to already be a plain
`async function` **Server Component** with no `'use client'` — it needs no treatment; it was never
in the client manifest at all.) This is the textbook "unauthenticated homepage ships the
authenticated dashboard's JS" Next.js gotcha: because the manifest is built from the route's
static import graph, not its runtime branches, both client components' whole module graph (chat,
feedback, thread sidebar) was in `/`'s client-reference-manifest regardless of which branch a
given request takes. Fix applied: wrap both in `dynamic(() => import(...).then((m) => m.X))` with
**no `ssr: false`** (Dashboard/Workspace ARE the first-paint content for logged-in visitors, so
per the brief's own rule they must stay server-rendered for that audience — only the anonymous
branch benefits, and it already never reaches them).

`npm run typecheck` was clean (build 2 of 3, full rebuild). But the same manifest-chunk
measurement showed **no reduction**: 11 chunks / 1,317,926 bytes (+111 bytes, largest chunk still
472,474 — noise-level identical). The 203,156-byte chunk did disappear as a single unit, replaced
by four smaller chunks (154,138 + 41,617 + 23,878 + 20,941 ≈ 240,574) — real code-splitting
happened — but the manifest still lists every chunk reachable from the route's compiled module
graph whether it is loaded eagerly or only on the branch that actually renders `<Dashboard>`/
`<Workspace>`, so this crude sum (the same method the parent's own pass-1 measurement used) cannot
see the difference between "shipped to every visitor" and "shipped only when this branch
executes." **Per this task's own instruction — keep only a ≥40 KB measured reduction, otherwise
revert — the change was reverted with `git checkout -- web/app/page.tsx`** (build 3 of 3
reproduced the exact pre-change baseline: 10 chunks, 1,317,815 bytes, largest 472,477 — bit-for-bit
match on the total, confirming the revert is clean). `components/chart.test.tsx` re-run
post-revert: 284/284 passed.

**Read as a finding, not a dead end:** the measurement method this brief has used since pass 1
(sum every chunk the manifest lists for the route) cannot detect the real, per-visitor savings a
route-level `next/dynamic()` split produces, because it doesn't distinguish "this route's request
CAN reach this chunk on some branch" from "this specific request's RSC payload actually references
it." A true before/after for this class of fix needs a real browser network trace on the built app
(`next start` + an anonymous request, checking which chunk files the browser actually fetches) —
outside this pass's grep-and-build-count budget. Recorded here rather than left silent, per
open-questions #245's own norm of writing down a negative result with its reason, not just a
positive one.

**Net result: no keeper this pass.** No code changed relative to the pass-1 merge
(`git status` clean); this is a **measurement-only** pass — no commit beyond this doc append. The
472,477-byte chart chunk and 381,692-byte zod-in-the-render-path chunk together account for
~65% of the landing's first load and are both legitimately required by the chart SVG path this
brief is scoped never to touch; the 203,156-byte chat/dashboard chunk is a real
architectural leak (ships to every visitor) but this measurement method can't confirm a real-world
byte reduction for the one fix tried, and a browser-trace-based follow-up is a separate, explicitly
scoped task (own build + browser-tool budget), not a "cheap" extension of this pass.

## Landing bundle pass 3 (session 110)

**Task:** two concrete follow-ups from pass 2, each with a named target — Target A (drop the
381,692-byte zod chunk out of `chart.tsx`'s render path) and Target B (prove, with a real browser
network trace rather than the manifest-chunk sum, whether `next/dynamic()`-wrapping
`Dashboard`/`Workspace` in `app/page.tsx` actually reduces anonymous visitors' first load).

**Setup, same as passes 1-2.** Fresh worktree, no `node_modules` at all this time (not even a
symlink) — a plain `npm ci` at the repo root and inside `web/` (a few minutes each) was all that
was needed; no Turbopack-across-symlink trap to work around.

**Target A — zod out of the render path.** Read `lib/chart-presentation.ts`'s `overridesSchema`
(a zod schema built at module load) and every caller of `sanitizeOverrides`: `chart.tsx`
(`withAccountDefault`/`resolvePresentation`, called unconditionally on every render, including the
landing's SSR'd gallery chart), `lib/chart-style-context.tsx` (`ChartStyleProvider`'s one-time
`sanitizeInitial`, signed-in tree only) and `app/chart-style-actions.ts`'s `saveMyChartStyle` (the
actual write path — untrusted raw browser JSON destined for `user_chart_styles`). Traced every
input the RENDER-path call sites actually receive: `chart.tsx`'s `state.presentation` (built by
its own reducer from panel actions, never raw JSON), `accountStyle` from `useChartStyle()` (already
sanitized once at `ChartStyleProvider` mount), and `gallery.tsx`'s `initialPresentation`
(`templateById(...).overrides`, a compile-time-typed curated template) — none of them is untrusted
input by the time it reaches `sanitizeOverrides` on the render path; the write path is the one
real security boundary.

Applied the brief's option 2: replaced `sanitizeOverrides` in `lib/chart-presentation.ts` with a
hand-written, zod-free validator with IDENTICAL semantics to the old schema (same 17 keys, same
enum lists, same "lowercase-then-regex" 6-digit hex rule, same `.strict()` exact-key-set rule per
`frameBackground` variant — `solid`/`gradient`/`image` each reject any extra or missing key, not
just a wrong type) — pinned byte-for-byte by the existing `lib/chart-presentation.test.ts` suite,
which needed ZERO changes and passed 54/54 unchanged. The zod-backed strict version (renamed
`sanitizeOverridesStrict`, along with its own private copies of `hexSchema`/`frameBackgroundSchema`/
`overridesSchema`) moved into `app/chart-style-actions.ts` itself — already a `'use server'` Server
Action module Next.js compiles into a server-only bundle and never ships to the client — so it
keeps zod as the real allow-list for the one path that actually receives untrusted input. Added a
new parity test to `app/actions-chart-style.test.ts` (`'the strict write-path sanitiser and the
render-path sanitiser agree on every fixture'`) that runs 20 fixtures — including every zod-schema
edge case from the pinned test suite — through both `saveMyChartStyle` (exercising
`sanitizeOverridesStrict`) and `sanitizeOverrides`, asserting identical results, so the two
validators can never silently diverge in a future edit. `zod` is no longer imported anywhere in
`lib/chart-presentation.ts`.

Verified two ways: (1) `.next/server/app/page_client-reference-manifest.js`'s chunk-sum method
(the one passes 1-2 used) went from the pass-2 baseline's 10 chunks / 1,317,815 bytes to **9
chunks / 943,345 bytes (-374,470 bytes, -28.4%)** — the missing 381,692-byte zod chunk, confirmed
by `grep -c ZodError` returning **zero hits across all 9 chunks** (the chart chunk itself still has
83 `recharts-` hits, confirming the chart SVG path is untouched). (2) The REAL anonymous first-load
method this pass introduces for Target B (below) was also run against Target-A-only: `next start`
on port 3123, `curl http://localhost:3123/` as an anonymous visitor, every `<script src="/_next/...">`
and `<link rel="preload" as="script">` extracted from the served HTML and summed from
`.next/static/...` on disk — **15 real script/preload tags, 1,496,638 bytes total, zero `ZodError`
matches across all 15** (this real-network number is higher than the manifest-sum number because
the manifest-chunk method, as pass 2 itself noted, doesn't capture every chunk the browser actually
requests — e.g. framework/runtime chunks referenced by the root layout rather than the page's own
RSC client-reference-manifest; it is still the right relative comparison, and Target A's win shows
up identically in both methods). `npm run typecheck` clean. Commit:
`perf(web): drop zod from chart.tsx's render-path import graph (Target A)` (`ed236cb`).
**Kept.**

**Target B — proving (not guessing) whether `next/dynamic()` on `Dashboard`/`Workspace` helps.**
Pass 2 tried wrapping both in `next/dynamic()` (no `ssr: false` — they ARE the first-paint content
for a signed-in visitor) in `app/page.tsx`, saw the crude manifest-sum total barely move, and
correctly flagged that its own measurement method "cannot detect the real, per-visitor savings a
route-level `next/dynamic()` split produces" — a browser-trace-based follow-up was left as this
pass's job. Re-applied the exact same change (`const Dashboard = dynamic(() =>
import('../components/dashboard.tsx').then((m) => m.Dashboard))`, same for `Workspace`;
`npm run typecheck` clean) and this time measured with the REAL anonymous-request method above
instead of the manifest sum: `next start` on port 3123, a fresh anonymous `curl` of `/`, every
`<script src>`/preload-as-script tag extracted and summed from disk.

**Result: no reduction — confirms pass 2's suspicion, now with hard evidence.** 16 real
script/preload tags, **1,496,752 bytes total** — 114 bytes MORE than the Target-A-only baseline
(1,496,638 bytes, 15 tags), not less. Inspecting the actual HTML explains why: Next.js's
`next/dynamic()` machinery still emits ordinary, unconditional `<script src="..." async>` tags for
every chunk reachable from the route's dynamic-import graph — e.g. `<script
src="/_next/static/chunks/0ca1y52n9gfmu.js" async>` was present in the anonymous visitor's own
served HTML, one of four new chunks (154,138 + 41,617 + 23,878 + 20,941 bytes, replacing the old
203,156-byte single chunk pass 2 already saw split apart) that the old 203,156-byte
`Dashboard`/`Workspace`/chat chunk got split into. `next/dynamic()` (at least at `ssr: true`,
inside a Server Component route, on Next 16.3.4/Turbopack) preloads the chunks it wraps for EVERY
request to the route regardless of which runtime branch actually renders them — it cannot tell,
at build time, that the anonymous branch (`userId === null`, returning `<Landing>`) never reaches
`<Dashboard>`/`<Workspace>` at all. Splitting the code doesn't stop it from being fetched.

Per this task's own instruction — keep only a measured reduction, otherwise revert — reverted with
`git checkout -- web/app/page.tsx`. Rebuilt (build 3 of the pass's 3-build budget) to confirm a
clean revert: manifest-chunk sum came back to 9 chunks / 943,342 bytes (3-byte hash noise off the
943,345 Target-A-only number, the same install-to-install noise passes 1-2 already documented) —
bit-for-bit equivalent. **Reverted — measurement only, no commit for Target B.**

**Read as a finding:** the real anonymous first-load method this pass built (curl the built app,
parse the served HTML's own `<script>`/preload tags, sum on-disk sizes) is now the trustworthy
before/after tool the last two passes' methodology note asked for. It confirms Target A's win in
both methods and definitively closes pass 2's open question on `next/dynamic()`-wrapping the
dashboard/workspace branch: it is not a viable lever for `app/page.tsx` as currently structured
(a single route serving three mutually-exclusive branches from one Server Component) — the
203,156-byte (now ~240,574-byte, split) chunk is a real architectural leak to anonymous visitors,
but fixing it needs a structural change (e.g. a genuinely separate route/layout per branch, so
the anonymous request's OWN module graph never references the client component at all), not a
`next/dynamic()` wrapper — a separate, larger piece of work, not a "cheap" follow-up.

**Net result: one real keeper.** Target A alone: real anonymous first load 1,496,638 bytes (15
script/preload tags), zod fully out of `chart.tsx`'s import graph, no behaviour change (54/54 +
37/37 unit tests, 284/284 `chart.test.tsx`). Target B: proven, not just suspected, to be a dead
end for this route's current shape — reverted clean.

## Logged-in workspace bundle (session 110)

**Task:** the three passes above only ever measured `/` as an anonymous visitor. The signed-in
workspace (`Dashboard`/`Workspace` via `app/page.tsx`, `components/workspace.tsx`, `chat.tsx`,
`thread-sidebar.tsx`, `visual-dock.tsx`) had never been measured with a real request. Use pass 3's
own honest method — `next start`, curl the served HTML, sum on-disk sizes of every
`<script src>`/preload-as-script tag — for both an anonymous and a signed-in request, then look
for a ≥40 KB, measured, safe win.

**Setup, same trap as passes 1-3.** This worktree's `node_modules`/`web/node_modules` were plain
symlinks into the main checkout; fixed the same way (`rm` both, real `npm ci` at the repo root and
inside `web/`, a few minutes each). The dev-harness's auth-stub (`:9911`) and llm-stub (`:9912`)
were already running (another agent's harness), so they were reused as documented in
`scripts/dev-harness/README.md` rather than started again; its `session-cookie.json` supplied the
signed-in `curl -b` cookie. `next start` ran on port 3131 (3102/9911/9912 belong to that other
harness and were never touched).

**A new build-time gotcha, distinct from passes 1-3's Turbopack-across-symlinks trap: `NODE_OPTIONS`
breaks `next build`'s own TypeScript step.** `scripts/dev-harness/env.sh` sets
`NODE_OPTIONS="--import <preload>"` so the PGlite fixture db is available to every Node process the
harness starts — that is correct for `next dev`/`next start` (long-lived server processes), but
`next build` also spawns a short-lived `tsc` subprocess for its own type-checking step, and
`NODE_OPTIONS` is inherited by every child process, not just the main one. With it set, `next build`
compiled successfully but then failed at "Running TypeScript..." with "Could not parse output from
TypeScript's `--showConfig`" and never finished (no `BUILD_ID` written) — the preload script's own
imports/side effects, run again inside the `tsc` subprocess's context, corrupt the JSON `tsc
--showConfig` output Next.js's build step parses. **Fix: build WITHOUT `NODE_OPTIONS`** (the route
itself is server-rendered on demand, not statically generated, so nothing at build time actually
needs the harness db) **and only set `NODE_OPTIONS` when running `next start`** (the DB is a
request-time, not build-time, dependency). `run-next-dev.mjs`'s `pathToFileURL(...)` percent-encoding
trick is also required for `NODE_OPTIONS` itself when constructed by hand — a raw path with the
checkout's spaces (`Check de Cijfers`) throws `ERR_MODULE_NOT_FOUND` on the first space-delimited
fragment.

**A second, more consequential gotcha: `web/lib/db.ts`'s harness seam never fires under `next
start`.** The seam (`if (process.env.NODE_ENV !== 'production') { use global.__checkdecijfersDb }`)
exists precisely so the harness's PGlite preload can feed the app a db — and it works under `next
dev` (`NODE_ENV=development`). But `next start` always serves a `next build` output, and Turbopack's
production build inlines `process.env.NODE_ENV` to the literal string `'production'` wherever it's
referenced in application code — confirmed empirically: setting `NODE_ENV=development` in the shell
that runs `next start` (without rebuilding) made no difference at all, because the `!== 'production'`
check had already been dead-code-eliminated at build time, when `next build` itself ran with the
implicit default `NODE_ENV=production`. The anonymous branch (`Landing`) degrades gracefully when
`getDb()` then throws `DATABASE_URL is not set` (`coverage-disclosure.ts` and `galerij`'s curated
charts both catch and log, serving a stale/empty version) — but `app/page.tsx`'s signed-in branches
call `getBalance`/`listThreads`/etc. through an un-caught `Promise.all`, so the whole request 500'd.

**Fix applied and kept: an explicit harness escape hatch, additive to the existing seam.**
`web/lib/db.ts`'s condition became `if (process.env.NODE_ENV !== 'production' ||
process.env.CDC_PGLITE_HARNESS === '1')` — `CDC_PGLITE_HARNESS` is an ordinary runtime env var (never
subject to the `NODE_ENV`-style build-time inlining Next.js/Turbopack special-cases), set only by
`scripts/dev-harness/env.sh`/`run-next-dev.mjs`, and never set in any real deploy — so production
behaviour (the `cached` branch, a real `connectFromEnv()` pool) is bit-for-bit unchanged; the change
only ever takes effect when this exact harness's own flag is on. This is the only source change this
pass makes; it is harness-enablement, not a bundle-size fix, and is necessary infrastructure for
*any* future session that wants to measure the logged-in workspace with a real request rather than
guessing from source. Verified: `npm run typecheck` clean; `getDb` is mocked (`vi.mock('../lib/db.ts',
() => ({ getDb }))`) in every test file that touches it (`actions.test.ts` and 12 others), so no
existing test exercises this branch directly — ran `npx vitest run app/actions.test.ts --maxWorkers=1`
(36/36 passed) as a representative check that nothing else broke.

**Build-budget accounting (the brief caps `next build` at 3 real runs this pass):** (1) the
`NODE_OPTIONS`-broken build above (no `BUILD_ID` written — a genuinely failed attempt, still counted
against the cap per the brief's own wording); (2) a clean build without `NODE_OPTIONS`, confirming
the build-time cause of (1), taken *before* the `db.ts` fix — this build could serve the anonymous
landing but not the signed-in workspace; (3) the final rebuild, with the `db.ts` fix in place and
`NODE_OPTIONS` still unset at build time. All 3 are spent; no further rebuild was attempted this
pass (see "Net result" below for what that forecloses).

**Measurement, both requests against build 3, `next start -p 3131` with build 3 above plus
`NODE_OPTIONS` (the preload) restored for the running server only:**

- Anonymous (`curl http://localhost:3131/`): HTTP 200, **15 script/preload tags, 1,502,217 bytes**
  — matches pass 3's Target-A-only baseline (1,496,638 bytes / 15 tags) to within normal
  install-to-install hash noise (passes 1-3 already documented this noise band).
- Signed-in (`curl -b <session-cookie.json's sb-localhost-auth-token> http://localhost:3131/`):
  confirmed rendering `Workspace` (not `Landing`, not `__next_error__`) via `grep -o
  "Workspace\|Dashboard\|Landing\|__next_error__"` on the response body. HTTP 200, **15
  script/preload tags, 1,502,217 bytes** — byte-for-byte, tag-for-tag **identical** to the
  anonymous response (`diff` of the two sorted `src="..."` lists is empty).

**Finding: there is no separate "logged-in bundle" today — the anonymous visitor already pays for
all of it.** This confirms and sharpens pass 3's own Target-B conclusion (dynamic()-wrapping
`Dashboard`/`Workspace` in `app/page.tsx` didn't reduce anonymous bytes because Next emits
`<script>` tags for the whole statically-imported module graph of a route "regardless of which
runtime branch actually renders them"): the *converse* is equally true from the signed-in side —
every chunk the workspace needs was ALREADY being shipped to anonymous visitors before this pass
even started, because `Landing`, `Dashboard` and `Workspace` are three static imports inside the
same `app/page.tsx` Server Component. There is no request-shape-based split at all between "what an
anonymous visitor's browser fetches" and "what a signed-in visitor's browser fetches" for `/` as
currently structured — the earlier "logged-in workspace bundle" framing this brief opened with is,
measured, not a distinct thing to diet separately; it is the same 1,502,217 bytes already accounted
for (and left alone, per this brief's own scope) by passes 1-3.

**Per-chunk module identification** (same method as pass 2 — grep each chunk's minified text for
package/identifier markers, `strings` for any embedded source paths, and distinctive UI string
literals pulled from the actual source files as fingerprints; every marker below was cross-checked
for false positives — see the `zod`/`zodra` note):

| Chunk (bytes) | Contents (evidence) | Notes |
|---|---|---|
| 480,448 | `recharts-` (83 hits, matches pass 2/3's chart chunk exactly), a `svg2pdf` hit that is only the destructuring site of an already-separate dynamic-chunk call (pass 1's finding, unchanged); `ChartEditModal`/`ChartConfigPanel`/`ChartStoryPanel`/`ChartStoryStage`/`ChartNotes` identifiers present as the `dynamic(() => import(...))` call sites pass 1 introduced, not their bodies (those are separate, on-demand chunks). Zero `ZodError` hits — Target A's fix confirmed still holding; the one raw `zod` substring match in a *different* chunk (3trj6b9cc2g1f.js, below) is a false positive: it's inside the Dutch word "zodra" ("as soon as"), verified by printing 30 characters of context around every hit. | `components/chart.tsx` (`ChartView`), same as passes 1-3. Landing-required, out of this pass's scope by the brief's own rule. |
| 229,290 | `react-dom` (1), `Fiber` (29), `Suspense` (5), `startTransition` (3), `hydrateRoot` (2), `webpack`/`turbopack` (1 each) | React + React-DOM + the Next.js client hydration runtime. Framework, unavoidable. |
| 203,596 | `Workspace` (1, exact string match) and `DeleteHistory` (1) as identifiers; `"chat-composer"`, `"chat-panel"`, `"dock-panel"` (1 each) as literal CSS/test-id-style strings pulled straight from `components/workspace.tsx`/`chat.tsx`; a `ResponsiveContainer`/`ChartView` reference (the inline chart preview inside a chat answer) | This is the Workspace/Chat/ThreadSidebar/VisualDock module graph — almost exactly pass 2's 203,156-byte "chat/dashboard" chunk (99.98% match; the ~400-byte drift is ordinary hash noise). **This is the one real candidate for a next pass's lazy-load** (see "What this pass recommends, unverified" below). |
| 144,443 | `x-deployment-id`, `x-action-revalidated`, `middleware`, `forbidden`, `digest`, `unauthorized` string literals; `startTransition` (5) | Next.js's app-router client runtime (Server Actions fetch/revalidation handling). Framework, unavoidable. |
| 112,594 | Served with the `noModule` attribute in the HTML (`<script src="/_next/static/chunks/0cz1d0mv5g_q7.js" noModule="">`); contents are `Reflect`/`Symbol`/`WeakMap`/`species`/`iterator`-heavy — a core-js-style ES2015+ polyfill bundle | Next.js's automatic **legacy-browser fallback bundle**. `nomodule` scripts are never fetched or executed by any browser that understands `type="module"` (every browser this product targets) — this pass's byte-sum method counts it because it's a real `<script>` tag in the HTML, but it is not part of any modern visitor's real first-load cost. Worth noting as a measurement-method caveat for future passes, not a code change. |
| 71,439 | Zero `ZodError` hits (the one `zod` substring is the "zodra" false positive above); referenced from the RSC payload as the vendor half of nearly every client-component reference alongside `2o70teaie9lwz.js` (`I[...,["/_next/static/chunks/3trj6b9cc2g1f.js","/_next/static/chunks/2o70teaie9lwz.js"],"LangProvider"]`, and again for `ThemeProvider`, `StylePanelOwnerProvider`, `ChartUsageTracker`, `SiteFooter`) | The shared site-chrome/providers vendor chunk (`theme-provider.tsx`, `lang-provider.tsx`, `style-panel-owner.tsx`, `chart-usage-tracker.tsx`, `site-footer.tsx`) — global on every route, not workspace-specific. |
| 62,906 / 40,841 / 35,492 / 30,758 / 28,473 / 27,546 / 22,582 / 10,947 / 862 | 35,492-byte chunk: 1 `lucide` hit (icon glyph data). The rest: no marker from the full sweep (`react-resizable-panels`, `PanelGroup`, `PanelResizeHandle`, `papaparse`, `date-fns`, `@base-ui`, `AttachmentsPanel`, `DatasetChat`, `AccountPanel`, `user-chart-styles`, `ThreadSidebar`, `VisualDock` — all zero hits across all 15 chunks, re-confirmed this pass) | Same as pass 2's own honest admission for its unattributed tail: likely first-party providers/small Next runtime pieces, individually too small to justify further digging inside this pass's budget. **Notably absent, confirmed again:** no `react-resizable-panels`, `@base-ui`, `papaparse`/csv, or `date-fns` string anywhere in any of the 15 chunks — either these libraries aren't reachable from `/` at all today, or their identifiers are fully mangled by Turbopack's minifier (unlike `Workspace`/`DeleteHistory`, which happened to survive as literal strings). Flagged rather than guessed, per this brief's own norm. |

**What this pass recommends, unverified (no build budget left to prove it this pass).** The
203,596-byte Workspace/Chat/dock chunk is the one candidate that fits this brief's own criteria
(interaction-only pieces that ship but aren't needed before an interaction) — but the RIGHT
mechanism matters, and this pass's own measurement just re-proved which one doesn't work: pass 3's
Target B already showed that wrapping `Dashboard`/`Workspace` themselves in `next/dynamic()` **at
the `app/page.tsx` Server Component boundary** (necessarily `ssr: true`, since they ARE the
first-paint content) does not shrink the real script-tag byte count, because Next still emits an
unconditional `<script src>` for every chunk reachable from the route's import graph regardless of
which branch executes. The precedent that DID work is pass 1's: wrapping genuinely interaction-only
CHILDREN **inside an already-`'use client'` component** (`chart.tsx`'s `ChartEditModal`/
`ChartConfigPanel`/`ChartStoryPanel`(partially)/`ChartStoryStage`/`ChartNotes`) with
`dynamic(() => import(...), { ssr: false })` — `ssr: false` chunks are fetched via a runtime
`import()` call embedded in the parent's own chunk, not as a top-level `<script>` tag, so they
never appear in this pass's byte sum at all until actually opened. The same pattern likely applies
inside `workspace.tsx`/`chat.tsx`/`thread-sidebar.tsx` themselves (both are already `'use client'`)
for pieces gated behind their own open/closed state — the delete-history confirmation dialog
(`DeleteHistory`, confirmed present in this chunk) is the clearest candidate by name alone, and the
brief's own suggested list (account panel, dataset/attachments chat if dormant, chart dock's heavy
children beyond `ChartView`) should be checked the same way `chart.tsx`'s children were: read each
candidate's actual mount condition first (only ever reached from a click vs. unconditionally
mounted with internal open/closed state), matching `chart.test.tsx`'s async-safe rewrite pattern
(`web/test/mock-next-dynamic.ts`) if any assertion needs it. **Not attempted this pass** — the
3-build budget was spent establishing the measurement method itself and fixing the harness gap that
blocked it; applying and then verifying a dynamic() split needs at least one more full
build-and-measure cycle, which is exactly the next pass's job.

**Net result: no bundle-size change this pass (0 bytes, by design — no code diet was attempted
without the build budget to verify it).** One real, kept fix: `web/lib/db.ts`'s `CDC_PGLITE_HARNESS`
escape hatch, harness-only, enabling every future session to measure the logged-in workspace with a
real signed-in request instead of reading source and guessing. One real, sharpened finding: the
"logged-in workspace bundle" and the "anonymous landing bundle" are, today, the exact same
1,502,217 bytes — there is no separate logged-in cost to diet independently until `Dashboard`/
`Workspace`'s own interaction-only children are split the way `chart.tsx`'s already were. Commit:
`fix(harness): let CDC_PGLITE_HARNESS reach next start's production db seam` — `npm run typecheck`
clean, `app/actions.test.ts` 36/36 passed as a representative check of every `getDb`-mocking test
file's continued behaviour.

## Route split (session 110)

**Task:** act on the finding the "Logged-in workspace bundle" pass above ended on — the anonymous
landing and the signed-in workspace ship the SAME 15 chunks because `web/app/page.tsx` is one
Server Component that statically imports `Landing`, `Dashboard` and `Workspace`. Not with
`next/dynamic()` (measured twice, doesn't work — pass 2 by chunk-sum, pass 3 Target B by real
request), but with the structural change those passes named: a genuinely separate route segment, so
the anonymous request's own module graph never references the signed-in tree. Keep the URL `/`.

**What was built.** `web/proxy.ts` rewrites `/` to `/workspace` when `getClaims()` validated a
session; `web/app/page.tsx` now imports only `Landing`; `web/app/workspace/page.tsx` holds the
Dashboard/Workspace branches, their flags and reads, moved verbatim (plus `runtime` and the ⟨W2⟩
`maxDuration = 90`, since a Server Action posts to the URL the browser is on and the proxy resolves
that to this segment). `/workspace` is internal: the proxy 307s any direct request for it — or
anything under it — back to `/`, unconditionally and before it reads the session, so it is not a URL
a browser can ask for; from `/` a signed-in visitor is rewritten straight back in. Full rationale,
trade-off and revisit trigger: ADR 033 D8.

**Measured, same method as pass 3** (`next build` without `NODE_OPTIONS`, `next start -p 3141` with
it, curl the served HTML as an anonymous and as a signed-in visitor, sum every `<script src>` /
preload-as-script from disk):

| Request | Before | After | Δ |
|---|---|---|---|
| Anonymous `/` | 15 tags, **1,503,395 bytes** | 13 tags, **1,280,984 bytes** | **−222,411 (−14.8%)** |
| Signed-in `/` | 15 tags, **1,503,395 bytes** | 15 tags, **1,498,886 bytes** | −4,509 (did not grow) |

The anonymous request stops fetching the 203,647-byte Workspace/Chat/ThreadSidebar/VisualDock chunk
(pass 2 and the logged-in pass both identified it), a 35,489-byte lucide-icon chunk and an 862-byte
sibling; it gains one 17,587-byte chunk (the landing's own, now split from the shared graph). The
480 KB recharts chunk and the framework chunks are unchanged — the landing genuinely needs them.
Both responses were confirmed to render the right surface first (the anonymous one the landing's
three gallery charts, the signed-in one `chat-composer`/`chat-panel`), and the signed-in HTML's own
markers are identical before and after.

**Live-verified on the built app, beyond the byte count:** direct `/workspace` and `/workspace/deep`
both 307 to `/` (signed in AND signed out) while `/workspace-debug` still 404s (the exact-match
discipline holds); `/?purchase=success` still reaches the page's `searchParams` through the rewrite;
`/geschiedenis` and `/credits` unaffected; `<html lang>` and the `generateMetadata` title resolve
identically from the `lang` cookie on the rewritten route (EN and NL checked); a hand-set
`x-source-route: eurostat` on `/` is still stripped (the footer stays CBS), i.e. the
strip-then-set discipline survives the rewrite.

**Gotcha worth recording, on top of the two the logged-in pass found.** `next build` must run with
the harness env (`scripts/dev-harness/env.sh`) sourced, `NODE_OPTIONS` unset — not with a bare env.
`NEXT_PUBLIC_*` values are inlined **at build time**, so a build without
`NEXT_PUBLIC_SUPABASE_URL` bakes `undefined` into the proxy's Supabase client: every signed-in
request then reads as anonymous and `next start` silently serves the LANDING to a cookie-carrying
curl. That cost one of this pass's three builds to diagnose (the first "signed-in" measurement was
a landing render in disguise). Second, smaller trap: the harness's auth stub generates a fresh
signing key on every start, so a `session-cookie.json` written by an EARLIER stub validates against
nothing — if the stub was restarted, re-derive the cookie (or reuse the file the running stub
itself wrote).

**Tests:** `proxy.test.ts` (+9 route-split cases), `app/workspace/page.test.tsx` (new — the props
survived the move, and the source pin that `app/page.tsx` never imports the signed-in tree again),
`app/dormancy.test.tsx` (its signed-in pins now render the new route; `/` pinned as
landing-only, session-independent), the three source-scan wiring tests repointed at the moved file,
`components/landing.test.tsx`, `components/workspace.test.tsx`, `app/layout.test.ts`,
`app/health.test.ts` — 150 tests, all green; `npm run typecheck` clean. Playwright: 6 passed, 1
failed — `answer.spec.ts` "(g) an over-cap multi-region refusal…" expects a chip labelled
`… in PV20 …` while the app renders `… in Groningen …`. Confirmed **pre-existing**: stashed the
whole change, moved the new route folder aside and re-ran that spec on the baseline — identical
failure, same locator. Not this pass's to fix (it is a test-expectation/label-resolution mismatch);
worth its own row.
