# ADR 062 — Breadth: a table lane over any current CBS table, fed by a slice cache

**Status:** accepted 2026-09-28 (session 138, owner present). The owner's product sanity check
([#335](../open-questions.md), [brief](../session-briefs/2026-09-28-sanity-check.md)) chose breadth as the next priority;
the owner approved the design ("Yes, write the plan (Recommended)"). Design:
[superpowers/specs/2026-09-28-breadth-any-cbs-table-design.md](../superpowers/specs/2026-09-28-breadth-any-cbs-table-design.md).
**Steps 2 (slice cache), 3 (breakdown resolver), 4/4b (table-scoped parser, hermetic) and 5 (the table lane wired into
the workspace chat, DARK behind `TABLE_LANE_ENABLED`) built** — see the "As built" sections. **Step 6's harness (the
table-lane benchmark: frozen tasks, key, hermetic runner + scorer, CI test) built 2026-09-30** — its measured run waits
for step 4's recording + calibration run (after 2026-10-01), which now records the benchmark's parse requests too; the
flag flip comes after both. The parser has still never called the AI.

**Decision 1 superseded 2026-09-30 (session 151) by ADR [065](065-retire-whole-table-copies-one-route.md):** the curated
whole-table set does not stay as a permanent fast lane; this slice cache becomes the only way data enters, with the pinned
definitions kept on top. Nothing is deleted until ADR 065's gate passes.

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

- Migration **037** (file-only at build time; **applied to the live database 2026-09-29, session 145, together with 038**): `cbs_tables.ingest_mode` ('full' | 'slice_cache'), `cbs_tables.schema_cbs_modified`,
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

## As built — step 3 (session 139, 2026-09-28, branch `breadth-step-3`)

- Adapter: `CbsDimension.title` (CBS `Title` verbatim; Eurostat's dimension `label`; `''` when absent). Not in the
  fingerprint and not stored in `expected_dimensions` — fingerprints byte-identical (pinned by a test).
- `src/query/breakdowns.ts` (pure; not wired in step 3, used by the table lane since step 5): `classifyDimension` (time / geo / geo_like — ≥80% region-prefixed codes /
  margins / breakdown), `findGrandTotal`, `marginsValueMember`, `resolveBreakdowns(dimensions, named)` → coordinates +
  stated defaults + `callerDimensions` (time/geo/geo-like left to the caller), or ONE button question (CBS order, at most
  12 options + the true member count). `statedDefaultsText` → `Uitgangspunt: <dimension>: <member>` / `Assumed: …`, CBS
  text verbatim (dimension identifier when CBS has no title).
- **Total rule (measured):** the FIRST member only, when it has a `Totaal…` title or a `T00` code, AND it is the only
  total-like member (a `; totaal` / `, totaal` suffix also counts as total-like) or the only `T00` member. Tightened in
  the final review: the suffix alone never makes the first member the total — 85004NED "Zonnestroom, totaal" is a solar
  sub-total in a solar + wind table. Stricter, never looser.
- `named` input is checked: a dimension name the table does not have throws (a caller bug never becomes a silent
  default); a named code that is not a member of a breakdown / margins dimension returns a question.
- Reach re-measured with the shipped TypeScript (`scripts/research/breakdown-reach.ts` over the committed crawl): of the
  923 tables with machine period status, 1,785 breakdown dimensions, **1,362 resolved by the total rule; 575 tables need
  no follow-up question, 348 ask** (session 138's Python pass: 1,363 / 576 / 347 — the tightening moved 1 dimension;
  82557NED's margins dimension without a `Waarde` member now correctly asks).
- Process: subagent-driven development — 3 tasks, each reviewed; final opus review "with fixes" (0 Critical, 3
  Important: the suffix false positive, unchecked `named`, no report of the caller's dimensions) — all fixed in one wave
  and re-reviewed. Step-5 design items from this step are added to [#336](../open-questions.md).

## As built — step 4 (session 139, 2026-09-29, branch `breadth-step-4`)

- `src/answer/table-parse/` (not wired in step 4, used by the table lane since step 5; still no live LLM call — the
  recording + calibration run is owner-supervised after 2026-10-01, estimated ~90k input tokens on the cheap tier over the
  34 labelled cases then; ~114k over 39 cases with prompt v3 now, see step 5):
  - `input.ts` — pure builder from `CbsTableSchema` + code lists: numeric measures only; step 3's classes decide which
    dimensions are offered (breakdowns only); lists over 40 members are pre-filtered deterministically (the grand total
    + members sharing a ≥ 4-letter word or a number with the question, CBS order, marked "shortened"); refuses tables
    with no time dimension / no numeric measure / a missing code list (`TableParseIneligibleTableError`).
  - `parse.ts` — static Dutch prompt, zod output (measure or `geen`; per breakdown a member, `niet_genoemd` or `anders`;
    the curated period spec, region terms, region scope and derivation; one confidence), and a hard-allowlist validator:
    anything outside the offered lists throws. Places always go in `regions`; on a table without regions a place is
    accepted only when it matches a region-coded member of a breakdown (exactly one match → that member or `anders`;
    look-alikes such as Groningen province / energy region → `anders`), else `TableParseRegionUnavailableError`.
    Measures that look identical to the model → `TableParseAmbiguousMeasureError`. A period precision the table lacks
    is flagged (`periodGrainUnavailable`), never adapted. `anders` = "not exactly one offered member" (not listed,
    several fit, or asks across members) → a question, never the total. Returns `{result, audit}`.
  - `bridge.ts` — parse → step 3's `named`: `anders` → ask that dimension; `geen` must be refused before; an explicit
    pick of the grand total is left to the resolver so it is disclosed as a stated default.
- `benchmark/tableparse-labelled-set.json` (34 cases over 8 real tables) + `scripts/tableparse-eval.ts`
  (`--dry-run` zero spend; `--replay`; `--record` refuses unless `TABLEPARSE_RECORD_OK=1`). Metadata-only fixtures in
  `tests/fixtures/tableparse/schemas/`. The curated parser is byte-identical (only `export` added to three schemas).
- Process: subagent-driven development, 4 tasks, each reviewed (opus on the prompt/validator); the Task 3 review found
  the prompt told the model to drop place names on tables without regions (a silent national answer) — fixed; the final
  opus review ("with fixes", 0 Critical) led to one fix wave + a small follow-up (look-alike places, region-coded
  members only). Items to settle before the recording run and in step 5: [#339](../open-questions.md).

## As built — step 4b (session 139, 2026-09-29, branch `breadth-step-4b`)

Settles the parser before its first recording (every item changes prompt bytes): the CBS adapter carries measure groups
(`CbsMeasure.groupPath`, CBS `MeasureGroups` titles root → leaf; in memory only — fingerprint, `cbs_tables.units` and
all curated prompts byte-identical; best-effort: a failed fetch flags `measureGroupsUnavailable` and only the table
parser refuses such a table); the prompt shows `groep:` lines and the duplicate-measure guard includes the group (it
resolved every identical-title case in the fixtures); prompt/schema versions 2; month/quarter questions default to the
seasonally adjusted measure when they don't say; reader-side place names are normalized (`places.ts`: suffix/prefix,
aliases) and the place KIND is used only to reject (a municipality question never takes a province member; look-alikes
still ask); the pre-filter always offers region-coded members the reader named. Final opus review found one Critical
(the first normalization discarded the kind — "gemeente Utrecht" matched the province) — fixed before merge. Dry run: 35
cases, ~102k estimated input tokens for the recording run.

## As built — step 5 (session 140, 2026-09-29, branch `breadth-step-5`)

The table lane is wired into the workspace chat and is **dark**: with `TABLE_LANE_ENABLED` unset, `askQuestion` behaves
exactly as before (pinned by the existing suites). Nothing here has run against the live AI or the live database.

**The flow.**
1. **Routing (request path, our database only).** A curated miss in a thread-aware turn (the workspace chat) that the
   existing table finder matches to a CBS table used to become the 100-credit onboarding offer. With the flag on it
   becomes a **table-lane request** instead: `createTableLaneRequest` reserves the normal question price and inserts a
   `table_lane_requests` row in ONE transaction (migration **038**, file-only at build time, applied live 2026-09-29 session 145; a failed insert rolls the charge back). The
   routing turn itself stays free (the gate already refunded it) and is not attached to the thread; the row links it
   (`routing_audit_id`) so the question history hides it and per-conversation deletion redacts it (final review I2/I3).
   A web add-on on that turn is settled before the row is created (final review M1). If queueing throws,
   nothing was charged and the turn falls back to today's offer path. The finder is only injected when
   `ONBOARDING_ENABLED=1` (already set in production), so both flags are needed. (A follow-up link routes without it: the
   linked table stands in for the finder.)
2. **The job (the only place that contacts CBS).** `runTableLaneJob` (`src/ingestion/table-lane-job.ts`) is a route,
   `/api/table-lane-job`, kicked right after a row is queued (`web/lib/table-lane-kick.ts`, fail-soft through the shared
   `web/lib/cron-kick.ts`) and swept once a day by the existing `/api/onboarding-cron`. Per row: load the table's live CBS
   schema and code lists, `registerSchemaOnly`, `planTableLane` (the table-scoped parse plus every safety gate in one fixed
   order), `ensureSlice` for the planned slice, then `respondTableLane` writes exactly ONE audited response, then
   `finishTableLaneRequest` ends the row and settles the money in one transaction, then the audited answer is attached to
   the reader's thread. `ensureSlice` and `registerSchemaOnly` run strictly before `respondTableLane`, so they never run
   under `resolveIntent`'s per-table lock ([#336](../open-questions.md) (1)).
3. **Reader side.** A progress bubble polls `pollTableLane` (our database only) every 2 s for the first minute, then every
   15 s up to 10 minutes; after 60 s it adds a "this is taking longer" line. A breakdown or region question comes back with
   buttons (`replyToTableLane`); a typed reply is matched against ALL members of that dimension (normalized exact title
   or exact code, must be unique; no nearest match). A lane question takes ONE reply (`is_reply` + a unique index in 038,
   checked in the store under the user's lock): a retry, a second tab or a stale client gets the existing child and is
   not charged again (final review I1). Replies, like routing and follow-up links, need `TABLE_LANE_ENABLED` (final
   review I4). A follow-up in the same conversation reuses the previous answer's table.

**Money.** The same 'simple' question price and the Pro-bucket-first split as a normal turn; the ledger debit is filed under
a derived request id (`deriveAddonRequestId(requestId, 'table-lane')`) because the routing turn already used the raw id. An
answer keeps the price; a clarification is refunded down to the clarification price; a refusal, a failure and a give-up are
refunded in full. Status and refund move in one transaction, so a row is never finished-but-unsettled or settled twice; a
superseded job invocation's finish is rejected (attempt fencing). Thread and history captions read the derived debit.

**Job robustness.** Job budget 240 s (route `maxDuration` 300 s), no new row claimed with under 120 s left; at most 2
attempts per row; a `running` row older than 5 minutes is reclaimed; a row a crashed invocation left at the cap gets an
audited `table_lane_failed` refusal plus a full refund (claimed atomically first, so it is audited once). A CBS
metadata failure retries once after 2 s, then refuses `cbs_unreachable` (audited, full refund). `ensureSlice` failing at
stage `fetch` retries once after 2 s; if it still fails, a stored copy of that exact slice confirmed within the last **24
hours** may answer (disclosed in the envelope as `fromCachedSlice`), else `cbs_unreachable`. Logs carry the row id, table
id, attempt and error class only, never the question.

**Refusals (all typed and audited, principle c).** `table_lane_ineligible`, `_no_measure`, `_unsure` (confidence below
`acceptThreshold`, an ambiguous measure, or a validator refusal), `_period_unsupported`, `_period_grain`, `_period_missing`,
`_region_class`, `region_unknown`, `region_unavailable`, `_too_large` (over 2,000 cells), `cbs_unreachable`,
`table_lane_failed`. One deterministic Dutch template each, with the English sibling for an English reader; no AI wording.
Deliberately refused in step 5 (each tracked in [open-questions](../open-questions.md) #340–#345): region classes ("per
provincie"); a table with BOTH a region dimension and region-coded breakdown members when a place is named; the period
kinds `change_over_year`, `now_vs_ago`, `date_range` and `relative`; a period precision the table does not publish (strict,
no fallback to another grain).

**Audit (R8).** Every outcome writes one `audit_answers` row carrying a present-only `tableLane` envelope key (row id,
table, finder confidence, the validated parse, the parse audit, the offered-menu hash, prompt/schema versions, the fixed
selection, the button question, the previous-question context). `reconstruct.ts` re-checks its shape and re-derives the
selection note byte-identically; the table parse is recorded in `llm_calls` as role `table_parse`, on every outcome
where the model was called (Ruling R6). Finished `table_lane_requests` rows (they hold the question text and the
table id a second time) are hard-deleted by the GDPR self-service deletion, per-thread deletion and the retention purge;
an in-flight row is swept by the next run once it ends (the same documented residual as `pending_table_requests`).
Per-thread deletion also redacts each lane row's thread-less routing turn through `routing_audit_id` (collected before
the lane rows are deleted; skipped while 038 is unapplied). The question history hides every linked routing turn (probe
on the table, never on the flag), so a lane question is one entry; one still in flight appears once it is answered.

**Copy.** Under each lane answer a deterministic line lists every fixed breakdown coordinate, named ones as "Selectie:"
and stated defaults as "Uitgangspunt:", CBS titles verbatim; it is never part of the model-written answer text.

**Parser prompt v3.** The parse gained one optional line with the previous question(s) in the conversation (at most two,
oldest first), so a follow-up ("En voor vrouwen?") can carry the topic over. The version bump happened before the first
recording; the labelled set is now 39 cases (34 → 35 in 4b → 39 with the follow-up cases); the dry run estimates ~114,136
input tokens for the recording run.

**Rulings taken while building** (recorded so the next session does not re-decide them):
- **R1** `TableLaneChoice` lives in `src/answer/table-lane/types.ts` so `src/answer` needs no runtime import from
  `src/ingestion` (the `bridge.ts` precedent). **R5** `plan.ts` does import the constant `SLICE_MAX_CELLS` from
  `src/ingestion/slice-cache.ts`; accepted, it runs only in the job.
- **R2/R6** the parser stayed byte-identical until the one task that bumped its version; the parse audit is kept on every
  outcome where a model call happened, including refusals (overruling the plan's "null on step-2 refusals").
- **R3** the job writes the thread id it attached to back onto the row, so a first question in a new chat gets a thread and
  child rows (button replies, follow-ups) inherit it.
- **R4** "Nederland" / "heel Nederland" on a national-only table (no region dimension, no region-coded member): the same
  model output is re-validated with only those terms removed (`absorbNationalTerms`), the answer states "Regio: Nederland
  (landelijke tabel)", and a table whose title names Caribisch Nederland is never absorbed. Any other place there still
  refuses. **Assumption:** only the exact names are removed, so a mis-tagged place cannot hide behind it.
- **R7** table-lane copy uses the informal "je" like every other refusal. **R8** the envelope stores the fixed selection
  itself, so the reader-visible note is re-derivable.
- **R9** a CBS metadata failure retries once, then refuses `cbs_unreachable`. **R10** the daily sweep works through open
  rows even with the flag off (the flag gates only NEW work: routing, follow-up links and replies — final review I4), so
  held credits never wait on a flag flip.
- **R11** one shared kick helper (`cron-kick.ts`) for the onboarding and table-lane kicks.
- **R12** only thread-aware turns (the workspace chat) route to the lane; the Dashboard chat keeps the onboarding offer,
  because the job needs a thread to attach to.
- **R13** while a lane question is open, typed text that matches no member closes the question and is sent as a fresh
  question (never traps the reader; costs a paid question on a typo).
- **R14** the follow-up link is a fallback, not an override: the real finder runs first and a confident pick of a
  DIFFERENT table wins, so a topic change is never answered from the old table. **R15** a bare follow-up with no topic
  term ("En in 2020?") still gets today's curated "which topic?" question in step 5; measure in step 6.
- **R16** the old onboarding offer never targets a slice-cache table, flag on or off, Dashboard or workspace
  (`sliceCacheTableIds`, read through `to_jsonb(row)` so it is safe without migration 037): a slice-cache pick gets the
  honest "not available right now" text with nothing charged, and slice-cache alternates are dropped from the signed
  candidate chain. The finder itself is unchanged, because the lane needs it to keep routing to slice-cache tables.

**Process.** Subagent-driven development: seven build tasks, each reviewed by the most capable tier, six with a fix round.

**Go-live needs ALL of:** migrations 037 + 038 applied (✅ DONE 2026-09-29, session 145, owner present — `npm run db:migrate`, exactly those two, verified read-only); `TABLE_LANE_ENABLED=1`;
`ONBOARDING_ENABLED=1` (already set); `CRON_SECRET` (already set — the job route and the daily sweep both refuse to run
without it, so a queued row would hold the reader's credits with nothing to answer or refund it); the parser recording + calibration run (after 2026-10-01, [#338](../open-questions.md));
and step 6's benchmark. Sequence and manual job kick: RUNBOOK "Table lane (breadth step 5)".

## As built — step 6 (harness) (2026-09-30, branch `worktree-agent-ac775b07853a4bbb1`; built dark, zero spend)

The table-lane benchmark exists and runs hermetically; its **measured** run needs the recorded parser (the supervised
`tableparse:record` run, which now records these requests too). Nothing here touches the parser's prompt bytes, the
database schema or production.

- **Task set** (`benchmark/tablelane-tasks.json`, frozen): 23 questions over 8 CBS tables that are NOT in the curated
  set (6 from step 4's schema fixtures, plus 2 held-out tables never seen in calibration: `37478hvv` airports, monthly,
  102 measures in nested groups; `80567ned` vacancy rate, quarters only). None repeats a labelled calibration question
  (pinned by test), so the accept threshold is never tuned on it. **14 answer** tasks (single values, a year-range series,
  a follow-up, a GeoDimension default, a region-coded breakdown member, a measure picked through its CBS group, month,
  quarter, provisional cells), **2 ask** tasks (two total-like age members; the look-alike "Groningen") each followed by
  their one button click, **7 refuse** tasks (no matching measure, a forecast year, a causal "waarom", a town on a national
  table, a year on a quarters-only table, a survey year not published, a cell CBS left empty → `not_published`). The table
  is given per task: it stands in for the finder's pick, which is measured by the finder's own calibration.
- **Answer key** (`benchmark/tablelane-answer-key.json`): 16 entries (14 answers + 2 post-click answers), every value read
  from CBS OData on 2026-09-30 through the live adapter AND re-read with the raw OData URL (`verifyUrl`, plain fetch):
  16/16 identical. Re-check any time: `npm run tablelane:bench:capture -- --verify-key` (read-only).
- **CBS snapshot:** schema + code lists from `tests/fixtures/tableparse/schemas/` (the same files the parser requests are
  built from, so hashes match the recording), cells in `tests/fixtures/tablelane-bench/cells/` (only the planned slices,
  captured read-only by `scripts/capture-tablelane-bench.ts`, which refuses when CBS's `Modified` differs from the schema
  fixture's). The stand-in source (`tests/helpers/tablelane-bench-source.ts`) throws on any slice it does not hold and
  logs it, so a fetch nobody expected is a scored failure, never "CBS has no data".
- **Runner** (`scripts/run-tablelane-benchmark.ts`, `npm run tablelane:bench:run`): per task a real `table_lane_requests`
  row (money reserved) → `runTableLaneJob` (the route's code) on a fresh PGlite; an ask task plays its click exactly like
  `replyToTableLane`. `--replay` (default) checks EVERY needed fixture before running and stops with the full list if one
  is missing; any failing parse call during the run also invalidates it (the job would otherwise turn it into a refusal).
  `--canned` feeds each task's expected parse as the model output (harness self-check). The answer text is the
  deterministic template (no compose model is recorded for the lane; prose is the curated benchmark's job).
- **Scorer** (`scripts/score-tablelane-benchmark.ts`): reads the dumped audit records only (R8). Answer = every key cell
  among the stored result cells (table, measure, period, region, breakdown coordinates, value, CBS status, provisional
  flag) and no extra cells; refuse = typed reason in the task's list; ask = one question about the expected dimension
  with options, then an answer matching the key after the click; all = R8 reconstruction clean, no unexpected fetch.
  Invented numbers: the R1 body scan on answers; on non-answers every number not from a structured source.
- **Gate:** answer tasks ≥ 12 of 14 (85.7% — the curated benchmark's own floor, 12 of 14; the revisit trigger above is
  "below the curated lane's quality floor"), refuse + ask 9 of 9, invented numbers 0.
- **Recording:** `tableparse:eval` (dry-run / `--record` / `--replay`) also covers one request per benchmark task,
  labelled `bench:<id>`, not scored there. Dry run: labelled 39 cases / 114,136 tokens (unchanged) + benchmark 23 requests
  / 74,991 tokens = 62 calls / ~189,127 estimated input tokens per record run.
- **CI** (`tests/benchmark/tablelane-benchmark.test.ts`): definition + key-equals-snapshot checks; the canned run (always);
  the replay machinery over canned outputs recorded to a temp dir (a deleted fixture must raise `MissingFixturesError`);
  and the real replay, **skipped until `tests/fixtures/llm/tableparse/` exists** — from then on a missing benchmark
  fixture fails, invented numbers fail always, and the full gate fails CI once `gate.enforcedInCi` is set to true in the
  task file (false today so the calibration commit is not blocked by a dark feature; the flip needs
  `npm run tablelane:bench:score` to exit 0 regardless).
- **First finding (canned run, before any model call):** tasks L1–L3 (85669NED, unit "miljard kg CO2-equivalent") fail
  R8 — the answer template writes the unit into the body and the R3 number-word check (`wordFormProblems`) flags
  "miljard", so the answer is served with a failing verdict and an admin alert. Pinned in the test as a known finding;
  **fix before the flip** ([#339](../open-questions.md) item 14). With it, even a perfect parse scores 11 of 14.
- **Not covered, stated:** a curated-front-door refusal (causal/forecast are refused by the curated intent parser before
  the lane in production; L18/L19 test the lane's own defence); an indistinguishable-measure refusal
  (`TableParseAmbiguousMeasureError`) — no non-curated fixture table has two measures the model cannot tell apart (checked
  over all 8), so it stays covered by calibration case `ambiguous-arbeid-werklozen` (80590ned) and the unit tests.

## As built — step 5 follow-up: the refused question shapes (2026-10-01, worktree branch, dark)

Built before the parser's first recording, **without touching the parser's prompt or output schema** (no recorded byte
changes). The table lane now answers four of the shapes step 5 refused, with the curated lane's own rules — shared, not
copied — and still no AI in any number:

- **A class of regions** ("per provincie", "alle gemeenten", "welke gemeente in Utrecht …", [#340](../open-questions.md)).
  The parser already reported the class (`regionScope`). `resolveTableRegionClass` (`src/answer/table-lane/regions.ts`)
  applies the curated rules (named places win over a class; "gemeenten in X" resolves X as a province; only "Nederland"
  means every gemeente) and reads the roster from CBS's own dimension groups with the query layer's own rule
  (`regionRoster`, extracted from `src/query/region-set.ts`, used by both). The slice holds exactly that roster (split
  into pieces of at most 150 codes by the existing splitter) and the intent carries it as `regionSet`, so the query layer's
  coverage, "not applicable" and ranking checks (ADR 054) run unchanged. Still refused (`table_lane_region_class`, text
  reworded): a class over more than one period (checked before any fetch), a table whose regions are not one CBS
  GeoDimension, a missing or empty CBS group (never a code-prefix scan).
- **Now versus N units ago, explicit date ranges, relative periods** ("vorig jaar") ([#342](../open-questions.md) (b)).
  The pure period arithmetic moved out of `src/answer/intent/resolve.ts` into `src/answer/intent/period-rules.ts`; the
  curated resolver and the lane's `resolveTablePeriod` both call it (curated behaviour byte-identical, benchmark
  unchanged). The lane applies it to the table's own published codes: both periods of a comparison must be listed (never a
  nearest period); a date range resolves at the finest published grain that expresses its whole-month boundaries; a
  relative period is the calendar period before the reference date and must be listed. The parser's grain flag for a date
  range now follows the same rule (flagged only when no published grain expresses it — "1 januari t/m 31 december 2022" is
  exactly the year 2022 on a yearly table); validator code only.
- **The derivation follows the curated normalization** (a range, `since` or `last_n` is a series; a multi-month date range
  too, unless it collapsed to one period). A series or change over ONE period is refused before any fetch with the new
  reason `table_lane_single_period` (its own Dutch and English template).
- **Still refused: change during a year** ("hoeveel steeg X in 2023", `change_over_year`). Which two cells that means
  depends on whether the measure is a stand per 1 januari or a flow; the curated lane reads that from a hand-curated key
  list and an arbitrary CBS table states nothing structural about it, so any choice would be a guess (principle c).
- Hermetic tests: `tests/answer/table-lane-periods.test.ts`, `tests/answer/table-lane-plan.test.ts` (region classes,
  period shapes, derivations), `tests/ingestion/table-lane-job.test.ts` (end to end through the real query layer over the
  stored slice: per provincie, gemeenten in Utrecht with a ranking, alle gemeenten fetched in pieces, now vs 5 years ago
  with the difference derivation, a date range as a series, "vorig jaar").
- Question phrasings the parser prompt does not map to these shapes yet ("gestegen sinds vorig jaar", "nu vergeleken met
  2015", "2015 tot 2020") and labelled cases for the recording are proposals for the session, not built here.

## As built — recording + calibration (2026-10-01, session 153, owner present; total AI spend ~$4.24)

The parser's first live recordings. Measured numbers, then the changes they forced.

- **Prompt version 4** ([#360](../open-questions.md), owner decision): three PERIODE lines (bare "van 2015 tot 2020" →
  year_range; "nu vergeleken met 2015" → since; "gestegen sinds vorig jaar" → now_vs_ago 1) and, after the first
  recording, three more (never pick a default member for an unmentioned dimension; a place-member dimension still gets a
  choice; "Nederland" is a named place). 11 labelled cases added (50 total; B1–B4).
- **Cheap tier measured and rejected.** `claude-haiku-4-5`, two recordings: 15/50 then 26/50 labelled cases (prompt
  additions barely moved it); table-lane gate 12/14 answers but 4/9 refuse/ask. Two misses would have shown a real CBS
  number for the wrong question: "CO2-uitstoot van het wegverkeer" read as all greenhouse gases, "nu vergeleken met 2015"
  read as one year ago. That is the measured accuracy miss the escalation rule waits for: a probe of `claude-sonnet-5` on
  the 24 failed cases fixed 15, including both. **`TABLE_PARSE_MODEL` is now `claude-sonnet-5`** (same request shape as
  the meaning check: no sampling params, thinking disabled). Per question ~8.3k billed input tokens ≈ 1.8 cents (Haiku
  ≈ 0.65 cents).
- **Structural fixes (no AI, all deterministic, each with tests):**
  1. A question that names a year but is read as counted back from now (now_vs_ago / relative / last_n / latest) is
     refused (`assertPeriodFitsNamedYear`).
  2. An extra `niet_genoemd` entry for a dimension the table does not offer is dropped, not refused (a member code or
     `anders` there still refuses).
  3. Refusal order in `planTableLane`: 'geen' → grain → period availability → confidence. Facts ("no such figure", "CBS
     has no 2030 figure") now win over the vaguer "not sure"; none of these can produce a number.
  4. **Total picks are the resolver's call.** The bridge already left a pick of the unique CBS grand total to the resolver
     (F5). Both models also picked "Totaal leeftijd" next to "Totaal, gestandaardiseerd", where the resolver must ASK.
     Now the first member, titled "Totaal …" (or a T00 code), on a dimension without a unique total is also left to the
     resolver (`isTotalPick`, `firstMemberTotalLike`). Only the first member: a later "Totaal bedrijfsmotorvoertuigen" is
     a sub-total a reader names on purpose. The reader's own button click is always named as-is.
  5. **Seasonal adjustment enforced in code** (`applySeasonalAdjustmentRule`): of a "Seizoengecorrigeerd" /
     "Niet-seizoengecorrigeerd" twin pair in one CBS measure group, the question's own words decide, else the period
     (month/quarter → adjusted, year → unadjusted). Both models ignored the prompt's rule.
  6. *Tried and withdrawn:* treating a named place as served when the chosen member's title contains it ("Schiphol" →
     "Amsterdam Airport Schiphol"). The verification block's existing safety test showed the hazard: a birth-country member
     "Nederland" would then "serve" a question about where people LIVE. A title naming a place does not say the member is
     about that place's location, so the rule was removed; L11 refuses safely.
- **Calibration** (#338). Confidence does not separate right from wrong (wrong readings up to 0.95, right ones down to
  0.5); the threshold only screens self-declared doubt. **`acceptThreshold` = 0.6:** zero number-producing wrong accepts in
  BOTH recordings (the gross/net labour-participation flip sat at 0.55). Stability: 8 of 73 readings differ between the
  two runs; after the fixes above only two change an outcome (that 0.55 case, refused; a "1 januari" question refused
  in one run, answered correctly in the other).
- **Measured result (both runs, final code):** labelled set 44/50, the six misses all refuse or ask (pinned by name in
  `tests/answer/table-parse/calibration-replay.test.ts`); **table-lane benchmark 12/14 answers (the floor), 9/9 refuse/ask, 0 invented
  numbers — GATE PASS.** The two answer misses are L11 and L12 (an airport named as a place — "Schiphol", "de Nederlandse
  luchthavens" — refused as region-unavailable; never a wrong number).
- **Not changed:** `gate.enforcedInCi` stays false and `TABLE_LANE_ENABLED` stays unset until the owner's GO.
- **Open:** "op 1 januari JJJJ" read as a one-day date range (refused, [#361](../open-questions.md)); L11/L12 (#361); the
  estimator in `tableparse:eval --dry-run` undercounts billed tokens 1.9× (Haiku) to 2.5× (Sonnet) — it omits the
  structured-output schema; the script now prints the measured factor.

## As built — the front door (2026-10-01, session 153, owner present, after the flip)

**Found by the owner's live check, not by any benchmark.** With `TABLE_LANE_ENABLED=1` live, "Hoeveel bestelauto's werden
er in 2024 gesloopt?" was refused as out of scope (audit row 337): the curated intent parser calls a topic far from its
vocabulary `out_of_scope`, and only an *unmatched* topic ever reached the table finder. The table-lane benchmark hands
each task its table, so it could not see this. Second gap: recall is Dutch full-text with every word required, so a
whole question finds nothing and word forms miss ("gesloopt" vs the title's "sloopvoertuigen").

- **Recall 'any' mode** (`recallCandidates(..., { mode: 'any' })`): the question's content words (question/function words
  and numbers dropped; a past participle "ge…t/d" adds its base, "gesloopt" → "sloop") match ANY word as a prefix, raw
  and stemmed, ranked by `ts_rank`; same Text filter, Eurostat deny gate and quota merge. The default mode is untouched.
- **The question finder** (`questionFinder`, injected by `askQuestion` only while `TABLE_LANE_ENABLED` and
  `ONBOARDING_ENABLED` are on, thread-aware callers only): an `out_of_scope` parse, or an unmatched topic the term
  finder could not place, is searched with the question itself; a confident pick routes to the table lane, otherwise the
  original refusal / B15 clarification stands byte-identical. Reply turns never get it. No prompt changed, no fixture moved.
- **Its own confidence bar** (`QUESTION_FINDER_CONFIG`, 0.7; the 100-credit fetch path keeps 0.8). Measured on the 38
  questions: every right rerank pick scored ≥ 0.75, every wrong pick and non-question ≤ 0.35, nothing between. The owner's
  vans question sat at 0.75 (the rerank docks itself when a summary does not name the asked year) — the second live
  refusal (audit row 338) was this bar, found by reproducing the finder on the live catalogue.
- **Measured** (`npm run frontdoor:eval`, 38 questions drafted by an agent from the live catalogue: 32 about
  non-curated tables, 6 that must not route; four expected-table lists extended after review): **before 6/32 reach a
  right table, after 22/32 with the 0.7 bar, 27/32 with the meaning step below; 0/6 negatives routed.** Four live runs +
  one rerank sweep, ~$2.75.
- **The meaning step ([#362](../open-questions.md), `src/catalog/search-terms.ts`):** the 10 misses were meaning gaps word
  search cannot bridge ("getrouwd" vs "huwelijkssluitingen", "te zwaar" vs "overgewicht"). When the question finder finds
  no confident table, the cheap model proposes up to 6 CBS-style search words (validated: plain words only, no codes or
  numbers; any failure = no retry) and the finder searches ONCE more with them; the rerank still judges against the
  reader's own question. The model proposes search words only — never a table, code or number (principle a). Like the
  rerank, the call lives inside the finder and is not written to `audit_answers.llm_calls` (pre-existing: no finder call
  is). **Measured: 26/32 (27/32 after one more expected-table gap was fixed), 0/6 negatives routed.**
- **Rarity weighting (#362):** 'any' mode leaves out words that match more than 6 % of the catalogue (and over 50 tables),
  measured per word from the catalogue — never a list; the rarest word stays when all are common. Live: 28/32 (welfare
  tables now on the shortlist), 0/6 negatives routed. Plus Dutch plural spelling (`dutchSingularStems`): live **31/32**.
- **Read-only end-to-end proof (no owner login needed):** reader → question finder → 85245NED → table parser on live CBS
  metadata → slice {A047215, vans A018935, 2024JJ00}; CBS returns 9,517 for that cell, the answer-key value.
- **Still open:** traffic deaths, gas use and welfare questions find no confident table; rent increase and welfare are read
  as curated-like and end in a clarification; household waste per person picks a sector total (not per person).

## As built — answers like a reader expects (2026-10-01, session 153, owner request after comparing with ChatGPT)

The owner asked the same two questions here and in ChatGPT. ChatGPT answered in about a second with an older figure
(9.96 million pigs, 1 April 2025 — CBS's own table 84952NED says 9.658 million for April 2025) plus a trend table and
context; we answered 9.188 million (April 2026, provisional — exactly the CBS cell) as one bare number, phrased
"naar verwachting". Owner decision: fix the wording first, then show a trend by default.

- **Forecast framing rejected (R11, `forecastFramingProblems` in `src/answer/compose/validate.ts`):** the phrasing model
  turned CBS's "Voorlopig" into "naar verwachting" and the semantic check passed it (audit row 342, now a pinned known
  divergence). Forecast words are rejected unless the data itself is about forecasts or expectations; a rejected body
  falls back to the template. One semantic-check labelled case used "volgens de prognose" as filler — reworded and its
  one fixture re-recorded (9/9, 0 FP, 0 FN).
- **Trend by default (`trailingPeriods`, `TREND_CONTEXT_PERIODS` in `periods.ts`; plan step 11b):** a question that names
  no period (the period was defaulted to the latest) now plans a series ending at the latest: 6 years, 8 quarters or 13
  months of the table's own published periods (CBS's gaps stay gaps). It is answered through the existing series path —
  the composed trend sentence under the same validators, a line chart with the latest value — and the stated default
  reads "Perioden: <first> t/m <latest>". A named period, a comparison of several places and a region class are
  unchanged. Table-lane benchmark unchanged (every task names its period): 12/14, 9/9, 0 invented.
- **Live follow-ups (owner: "a mess"):** the first trend answer (pigs) fell back to the series template — the phrasing
  model wrote a 2020→2026 decline without the provisional marking in that sentence and was rejected twice — and listed
  13 values; it also had no chart (April/December gaps). The series template now leads with the latest value (a year
  earlier, the start of the series; `SERIES_LATEST_FIRST_MIN_CELLS` = 4, one-place series only), and a one-place series
  with gaps is drawn as bars (ADR 007 as-built note).

## Trade-offs and open points (after step 5)

- A quarantined slice-cache table has no rebaseline path yet (syncTable refuses it) — recovery = eviction or a supervised
  DB edit (RUNBOOK).
- Step 5 settled the design points step 2 left ([#336](../open-questions.md) (1), (2), (3), (9), (10) in part): the
  job never holds the lock while fetching, the 180 s lock timeout lands on the job and not on a request, a
  fresh-enough cached slice may answer when CBS is down, and a lagging mirror retries once. Still open: slice tables get
  no cadence staleness warning; the coverage page treats slice tables as never synced (the old onboarding offer no longer
  targets them, R16); wide member lists may exceed CBS's URL length.

## Revisit triggers

- Step 6's live benchmark shows the table lane's parse or finder below the curated lane's quality floor.
- Database size from slice caching grows faster than eviction reclaims (#110).
