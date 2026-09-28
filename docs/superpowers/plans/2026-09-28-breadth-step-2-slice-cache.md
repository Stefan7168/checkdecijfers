# Breadth step 2 — slice cache ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A library (not yet wired to chat) that registers any current CBS table's layout without its cells, then fetches, validates and stores exactly the cells a question needs — so a later step can answer from any of ~1,100 tables within seconds.

**Architecture:** A new ingestion mode beside today's whole-table sync. `registerSchemaOnly` stores metadata, code lists, numeric-measure units and a fingerprint (no observations). `fetchSlice` requests a narrow `$filter` (measures × dimension members × periods), runs the validation checks that make sense for a slice, upserts the cells into the ordinary `observations` table and records the fetch in a new `slice_fetches` table. `ensureSlice` skips a fetch that is already covered and fresh. The query layer learns that, for a slice-cache table, a missing cell outside any fetched slice is "not fetched" (internal), never "not published".

**Tech Stack:** TypeScript, Postgres (PGlite in tests), CBS OData v4 (`FixtureSource` in tests).

**Spec:** [docs/superpowers/specs/2026-09-28-breadth-any-cbs-table-design.md](../specs/2026-09-28-breadth-any-cbs-table-design.md) (D4, D5, D7; step 2).

## Global Constraints

- Branch `breadth-step-2` from `main`. Implementers never push, merge, apply migrations to a live DB, touch `.env`, use `git stash`, or call an LLM.
- **No change for existing tables:** every table registered today keeps `ingest_mode = 'full'` and behaves byte-identically (same filter strings, fingerprints, sync semantics, refusals).
- Migration 037 is **file-only** (applied later by the owner with `npm run db:migrate`); hermetic tests apply it through PGlite. Every reader of the new column/table must tolerate its absence in production until applied (probe first, as `src/attachments/publications.ts` does for migration 036) — or the code is unreachable from production until step 5 wires it (preferred: nothing in `web/` or the request path calls these functions in this step).
- Principle (c): anything unexpected fails loudly with a plain-language summary; never a guessed status, unit or code. R1: nothing here answers — it only stores validated cells.
- Text measures (`DataType: 'String'` in CBS `MeasureCodes`; units like `code`, `naam`, `omschrijving`) are never registered as servable.
- 8 GB machine: one foreground vitest process at a time.

---

### Task 1: Migration 037 — `ingest_mode` + `slice_fetches`

**Files:** Create `migrations/037_slice_cache.sql`; Test `tests/db/` (follow the file an existing migration test uses — `grep -rln "036" tests/db tests/attachments | head`).

- [ ] Write the migration:

```sql
-- 037 — slice cache (breadth step 2, spec 2026-09-28-breadth-any-cbs-table-design.md D4).
-- ⚠ FILE-ONLY until the owner-supervised `npm run db:migrate`. Nothing in the
-- request path reads these objects until breadth step 5 wires them.
-- Plain Postgres only (ADR 009).
alter table cbs_tables
  add column ingest_mode text not null default 'full'
    check (ingest_mode in ('full', 'slice_cache'));

create table slice_fetches (
  id bigint generated always as identity primary key,
  table_id text not null references cbs_tables(id) on delete cascade,
  -- canonical JSON of the requested filter (sorted keys and code lists); the
  -- idempotency key for "this exact slice was fetched"
  filter_key text not null,
  filter jsonb not null,
  -- CBS 'Modified' of the table at fetch time: a newer CBS value makes the
  -- slice stale (ensureSlice refetches)
  cbs_modified timestamptz,
  row_count integer not null,
  batch_id bigint references ingestion_batches(id),
  fetched_at timestamptz not null default now(),
  unique (table_id, filter_key)
);
create index slice_fetches_by_table on slice_fetches (table_id);
```

  Then add the same row-level-security / grant posture the project uses for server-only ingestion tables: find how `ingestion_batches` and `dimension_labels` are locked down (grep migrations for `enable row level security` and `revoke` on those tables) and mirror it exactly for `slice_fetches`, with a comment naming the migration you copied.
- [ ] Test: after migrations apply on PGlite, `cbs_tables.ingest_mode` defaults to `'full'` for an inserted row, rejects `'other'`, and `slice_fetches` enforces `unique (table_id, filter_key)` and cascades on table delete. Run the db suite file; commit `feat(db): migration 037 — slice cache mode + slice_fetches (breadth step 2, file-only)`.

---

### Task 2: Adapter — member lists, period lists, measure data type

**Files:** `src/cbs-adapter/types.ts`, `src/cbs-adapter/odata-v4.ts` (`sliceToFilter`), `src/cbs-adapter/fixture-source.ts` (`matchesSlice`), `src/cbs-adapter/parse-v4.ts` (measure parsing), `src/eurostat-adapter/statistics-api.ts` (refuse the new fields); tests in `tests/ingestion/adapter.test.ts` and `tests/eurostat-adapter/statistics-api.test.ts`.

**Interfaces — produces:**

```ts
// CbsSlice additions
/** Several allowed codes per dimension: `(Dim eq 'a' or Dim eq 'b')`. */
dimensionIn?: Record<string, string[]>;
/** Exact period codes: `(Perioden eq 'x' or …)` — the dimension name is the table's TimeDimension, passed by the caller as `periodDimension`. */
periodIn?: { dimension: string; codes: string[] };
// CbsMeasure addition
/** CBS 'DataType' ('Double' | 'Long' | 'String' | …); '' when absent. */
dataType: string;
```

- [ ] Tests first: `sliceToFilter` appends `dimensionIn` clauses (dimension keys in sorted order, codes in given order, parenthesised when >1) and then `periodIn`, AFTER every existing clause (so every existing slice's string is unchanged — the 03759ned exact-string test must still pass); empty arrays add nothing. `FixtureSource` applies both. The v4 measure parser fills `dataType` from `DataType` (`''` when missing) — assert on the 70072ned fixture that `CP0001` is `'String'` and `M000100` is `'Double'`. Eurostat `buildRequestUrl` throws on `dimensionIn`/`periodIn` like it does on `measures`.
- [ ] Implement; run `npx vitest run tests/ingestion/adapter.test.ts`, the Eurostat file, `npx tsc --noEmit` (fix every `CbsMeasure` construction the type change breaks — test helpers included — with `dataType: ''` where no source value exists). Commit `feat(adapter): member/period lists in slices; measure data type (breadth step 2)`.

---

### Task 3: `registerSchemaOnly`

**Files:** Create `src/ingestion/slice-cache.ts`; test `tests/ingestion/slice-cache.test.ts`.

**Interfaces — produces:**

```ts
export type SchemaOnlyResult =
  | { ok: true; tableId: string; numericMeasures: string[]; alreadyRegistered: boolean }
  | { ok: false; reason: 'no_time_dimension' | 'no_machine_period_status' | 'no_numeric_measures' | 'registered_as_full'; summary: string };
export async function registerSchemaOnly(db: Db, source: CbsSource, tableId: string): Promise<SchemaOnlyResult>;
```

Behaviour (each a test, using `FixtureSource` over existing fixtures — `83625NED` (region + time), `85224NED` (breakdowns), `70072ned` (no machine period status), and a clone with every measure's `DataType` set to `'String'`):
- Fetches schema + every dimension's code list (reuse `fetchAllCodeLists` from pipeline.ts — export it if needed) and CBS `Modified` (from the table properties the adapter already reads; if the adapter does not expose it, add it to `CbsTableSchema` as `modified: string | null`).
- Refuses `no_time_dimension` (no `TimeDimension`), `no_machine_period_status` (every period code has `status: null` — ADR 061's prose reader is per-table curated, not generic), `no_numeric_measures` (every measure `dataType === 'String'`).
- Inserts `cbs_tables` with `ingest_mode = 'slice_cache'`, `slice = null`, `pinned = false`, `units` = numeric measures only (`dataType !== 'String'`), `schema_fingerprint` = `computeFingerprint(dimensions, numericMeasureCodes)` computed NOW (not at first sync), `source` the same way `registerTables` sets it; writes `dimension_labels` for every dimension with the same batched helper `registerTables` uses (reuse, don't copy); `last_row_count = null`.
- Already registered as `slice_cache` → `{ ok: true, alreadyRegistered: true }` with no writes. Already registered as `full` → `registered_as_full` (the whole-table path owns it; the caller uses it as-is).
- Run `npx vitest run tests/ingestion/slice-cache.test.ts` and `tests/ingestion` (nothing else may change), `npx tsc --noEmit`. Commit `feat(ingestion): schema-only registration for slice-cache tables (breadth step 2)`.

---

### Task 4: `fetchSlice` — fetch, validate, store one slice

**Files:** `src/ingestion/slice-cache.ts`; tests in `tests/ingestion/slice-cache.test.ts`.

**Interfaces — produces:**

```ts
export interface SliceRequest {
  measures: string[];                 // numeric measure codes of this table, ≥ 1
  members: Record<string, string[]>;  // every NON-time dimension → ≥ 1 code (regions included)
  periods: string[];                  // ≥ 1 period code
}
export type SliceFetchResult =
  | { ok: true; batchId: number; rowsStored: number; missingCells: number; filterKey: string }
  | { ok: false; stage: FailureStage | 'request'; summary: string };
export async function fetchSlice(db: Db, source: CbsSource, tableId: string, req: SliceRequest): Promise<SliceFetchResult>;
export function sliceFilterKey(req: SliceRequest): string; // canonical JSON: sorted keys, sorted code lists
```

Behaviour (tests on the same fixtures):
- `request` refusals BEFORE any network call: table not `slice_cache`; a measure not in stored `units`; a dimension missing from `members` or not a stored dimension; any code not in that dimension's stored `dimension_labels`; a period not in stored period labels; the product of list sizes over **2,000 cells** (the cap; name it `SLICE_MAX_CELLS`).
- Freshness/schema: fetch CBS `Modified`; if it differs from the stored value (keep it on `cbs_tables` — add nothing new: store it in `slice_fetches.cbs_modified` and compare against the table's latest fetch, or re-fetch the schema whenever `Modified` moved), re-fetch the schema and compare the fingerprint over numeric measures; mismatch → `schema_fingerprint` failure + quarantine (`needs_review`), exactly like `syncTable`'s stage 1.
- Fetch via `source.fetchObservations(tableId, { measures, dimensionIn: members, periodIn: { dimension: <time dim>, codes: periods } }, dimensionNames)`.
- Validate with the EXISTING check functions where they apply (reuse from validate.ts, never copy): duplicate cells and reason-less nulls and string values (the `row_plausibility` pieces — call a new exported helper extracted from `checkRowPlausibility` WITHOUT the row-count-tolerance and every-measure-present parts, and keep `checkRowPlausibility`'s own behaviour byte-identical), `checkPeriodParsing`, `checkDimensionMapping` (against stored labels, `acceptNewCodes = false`), `checkUnitConsistency` (fetched measure metadata vs stored units). Any failure → batch `failed` with that stage and summary; a mapping/unit/fingerprint failure quarantines the table; nothing is written to `observations`.
- Store: upsert the rows into `observations` with the SAME column derivation `syncTable` uses (extract the row-staging logic into a shared helper rather than duplicating it) and the same upsert conflict target, but WITHOUT the "mark unseen cells as retained" step (a slice is not a full sync). Record an `ingestion_batches` row (succeeded, counts) and upsert `slice_fetches (table_id, filter_key)` with `row_count`, `batch_id`, `cbs_modified`. All in one transaction under the same per-table advisory lock `syncTable` takes.
- `missingCells` = requested coordinates CBS returned no row for (a real CBS "no cell", recorded, not an error).
- Idempotent: the same request twice → second upsert changes nothing, `slice_fetches` has one row.
- Tests also pin: a status comes from the period labels (R11) — e.g. a provisional period's cell stored with its status; a crafted duplicate row → `row_plausibility` failure, 0 rows stored.
- Run the slice-cache tests, `tests/ingestion`, `npx tsc --noEmit`. Commit `feat(ingestion): fetchSlice — validated per-question slices (breadth step 2)`.

---

### Task 5: `ensureSlice` + honest "not fetched" in the query layer

**Files:** `src/ingestion/slice-cache.ts`; `src/query/run.ts` (`diagnoseMissing`); tests in `tests/ingestion/slice-cache.test.ts` and `tests/query/` (new file `slice-cache-missing.test.ts`).

**Interfaces — produces:** `export async function ensureSlice(db, source, tableId, req): Promise<SliceFetchResult & { cached?: boolean }>` — returns `{ ok: true, cached: true, … }` without fetching when a `slice_fetches` row with the same `filter_key` exists AND CBS `Modified` is unchanged since it (one cheap properties request); otherwise `fetchSlice`.

- [ ] Query side: for a table with `ingest_mode = 'slice_cache'`, `diagnoseMissing` must distinguish (a) a coordinate inside a fetched slice that CBS returned no cell for → the existing `not_published` wording, and (b) a coordinate outside every fetched slice → a new internal refusal kind `not_fetched` (plain Dutch internal-refusal copy; it should never reach a reader because step 5 always ensures before querying — so map it to the existing internal/owner-alert path, not user copy). Tables with `ingest_mode = 'full'` (and databases where migration 037 is absent — probe the column) behave exactly as today.
- [ ] Tests: cache hit (no second fetch — count `fetchObservations` calls with a spy wrapper around `FixtureSource`), stale `Modified` → refetch, (a)/(b) refusals, and an unchanged-behaviour test for a `full` table's `not_published`.
- [ ] Run the new tests, `tests/query`, `tests/ingestion`, `npx tsc --noEmit`. Commit `feat(query): slice-cache ensure + honest not-fetched diagnosis (breadth step 2)`.

---

### Task 6 (controller): verification + docs

Full `scripts/verify-block.sh`, `/code-review` LOW, opus final whole-branch review, then merge to `main` (owner present) — safe because nothing in the request path calls the new functions. Docs: ADR 062 (breadth: two lanes + slice cache, as-built step 2), RUNBOOK (migration 037 is file-only; owner applies with `npm run db:migrate` before step 5 goes live), STATUS, build plan, open-questions #335.
