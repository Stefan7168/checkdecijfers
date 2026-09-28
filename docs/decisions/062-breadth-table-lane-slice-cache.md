# ADR 062 — Breadth: a table lane over any current CBS table, fed by a slice cache

**Status:** accepted 2026-09-28 (session 138, owner present). The owner's product sanity check
([#335](../open-questions.md), [brief](../session-briefs/2026-09-28-sanity-check.md)) chose breadth as the next priority;
the owner approved the design ("Yes, write the plan (Recommended)"). Design:
[superpowers/specs/2026-09-28-breadth-any-cbs-table-design.md](../superpowers/specs/2026-09-28-breadth-any-cbs-table-design.md).
**Step 2 (slice cache) built** — see "As built — step 2". Steps 3–6 not built.

**Relates to:** ADR [003](003-cbs-access-layer.md) (bulk ingestion, principle b), ADRs [025](025-cbs-catalog-table-discovery.md)/
[026](026-on-demand-fetch-job-architecture.md)/[027](027-finder-shape-fit-gate.md) (today's on-demand onboarding, which
this supersedes as the default path once live), ADR [061](061-regional-statistics-70072ned.md) (measure allow-list,
period-note status), #154 (per-cell freshness), #110 (eviction).

## Context

Measured 2026-09-28: CBS has 1,277 current tables; we held 21 (0.4%). Hand-curating figures does not scale; today's
on-demand onboarding only delivers time-only tables (7% of current tables), costs 100 credits and answers by e-mail — used
3 times. All current tables together hold ≈ 3.5 billion cells (our database: 1 M cells / 400 MB), so pre-loading is out.
92% of tables have breakdown dimensions; 57% have a recognisable total for every breakdown.

## Decision

1. **Two lanes.** The curated figures stay the fast lane. A question the curated lane cannot place goes to a **table
   lane**: find the table (the existing finder), then parse the question against that one table's own schema (closed
   choice; regions via the existing deterministic resolver). No global vocabulary growth.
2. **Unnamed breakdowns:** CBS's own total when exactly one is identifiable, stated in the answer; otherwise a button
   question. Never a guessed default.
3. **Slice cache (step 2):** register a table's layout once (`registerSchemaOnly`: metadata, code lists, numeric-measure
   units, fingerprint, CBS `Modified` — no cells); fetch, validate and store **only the cells a question needs**
   (`fetchSlice`, ≤ 2,000 cells); skip fetches that are stored and still current (`ensureSlice`). Answers are composed only
   from stored, validated cells (principle b holds); each cell is dated by the latest CBS confirmation of the slice(s)
   covering it (R4).
4. **Normal question price; answer in the same chat** (progress while fetching, via the existing job infrastructure).
5. **Stepwise, each step dark until measured** (spec §4).

## Alternatives considered

- **Pre-load every current table** — ≈ 3.5 billion cells; impossible at our database size and refresh cost.
- **Keep whole-table async onboarding, lift the price** — still time-only tables, still minutes + e-mail, 150k-cell cap.
- **Grow the curated parser's vocabulary per table** (today's `onboarded:` keys) — prompt size and fixture churn grow
  with every table; does not scale to 1,277 tables.

## As built — step 2 (session 138, 2026-09-28, branch `breadth-step-2`)

- Migration **037 (FILE-ONLY)**: `cbs_tables.ingest_mode` ('full' | 'slice_cache'), `cbs_tables.schema_cbs_modified`,
  table `slice_fetches` (filter_key, normalized filter, cbs_modified, checked_at, row_count, batch_id — cascade on table
  and batch delete), `ingestion_batches` failure stage `ingest_mode`. Everything new is probe-guarded or unreachable
  until 037 is applied; full tables are byte-identical (verified by the unchanged test suites).
- Adapter: `CbsSlice.dimensionIn` / `periodIn`, `CbsMeasure.dataType` (text measures — `DataType: 'String'` — are never
  servable), `CbsTableSchema.modified` (required).
- `registerSchemaOnly` refuses: no CBS `Modified`, no time dimension, no periods, no machine period status, no numeric
  measures, already a full table.
- `fetchSlice`: request validated against stored CBS codes before any network call; schema refresh when CBS `Modified`
  moved (fingerprint + unit check; mismatch quarantines); an OLDER `Modified` is refused; the existing validation checks
  reused by extraction; slice-scoped retained marking (#154) so a cell CBS stops returning is never re-dated as confirmed;
  all writes in one transaction under the per-table lock. `syncTable` refuses slice-cache tables; `sync --all` skips them.
- `ensureSlice`: cache hit when CBS `Modified` is unchanged (bumps `checked_at`, conditionally); stale when another slice
  already saw a newer CBS version.
- Query layer: slice-cache tables answer; every served cell must be covered by a fetched slice (else
  `internal_inconsistency`); cells and slice dates read in one snapshot; a coordinate outside every fetched slice is the
  internal refusal `not_fetched` (never shown to readers).
- Process: built via subagent-driven development — 6 tasks, each reviewed (opus on the invariant-heavy ones), 5 fix
  rounds; the final whole-branch review found 2 Important issues (a withdrawn cell could be dated by an overlapping new
  slice; the `ensureSlice` refresh skipped the unit check), both fixed before merge.

## Trade-offs and open points (step 5)

- A quarantined slice-cache table has no rebaseline path yet (syncTable refuses it) — recovery = eviction or a supervised
  DB edit (RUNBOOK).
- Step 5 must not call `ensureSlice` while holding resolveIntent's shared per-table lock (self-deadlock); the 180 s lock
  timeout would land on a user request; `ensureSlice` fails when CBS is unreachable even for cached slices; slice tables get
  no cadence staleness warning; onboarding/coverage treat slice tables as never synced; wide member lists may exceed CBS's
  URL length. Tracked in [#336](../open-questions.md).

## Revisit triggers

- Step 6's live benchmark shows the table lane's parse or finder below the curated lane's quality floor.
- Database size from slice caching grows faster than eviction reclaims (#110).
