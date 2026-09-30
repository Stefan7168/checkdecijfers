# One route: the pinned tables move onto the slice store, kept warm by a job

**Status:** design written by the session on the owner's delegation (session 151, 2026-09-30: "I trust your wisdom.
Apply everything you recommend … just get it done"). This is ADR [065](../../decisions/065-retire-whole-table-copies-one-route.md)
step 2. **Nothing here is built yet.** Facts below come from three read-only code studies the same day (file:line
evidence kept in the session; the load-bearing ones are repeated here) and from live measurements.

## 1. The goal in one sentence

Every table is stored the same way (slices: fetched, checked, stored, dated), a background job keeps the pinned tables'
cells current without a person, and the hand-run whole-table sync, its report and its alert are deleted — with every
existing answer, chart and benchmark result unchanged.

## 2. Facts this design rests on

- **The "whole-table copies" are already slices.** Each pinned table is registered with a declared scope in
  `cbs_tables.slice` (`src/ingestion/registry-seed.ts`: dimension pins, region prefixes, a period floor, measure
  curation) and only that scope is synced — today's refresh of `85770NED` fetched 672 rows of a 686,896-cell table. About
  1.04 million cells in total (ADR 062). What is wrong with them is not their size; it is that one hand-run command
  refreshes each of them and nothing else can.
- **The curated answer path reads its facts from stored cells**, not from code lists: which grains exist, the latest
  period, the default trend window, range offers, the freshest period for the homepage stories, the national-figure
  probe (`src/answer/intent/resolve.ts:473-489, 871-916`; `src/query/run.ts:534-539`; `src/query/resolve.ts:696-700`).
  It also uses the declared scope to know which regions are loaded (`resolve.ts:758-781`). So it works on a slice-stored
  table exactly when the same cells are stored and the declared scope stays in place.
- **The query layer already serves slice-stored tables**: every served cell must be covered by a `slice_fetches` row and
  is dated by the latest confirmation of a covering slice (`src/query/run.ts:247-290, 902-915`).
- **What slice registration lacks for a pinned table** (`src/ingestion/slice-cache.ts` `registerSchemaOnly`): it sets
  `pinned = false` (so eviction would delete the table after 30 idle days), no refresh cadence (so no staleness warning),
  no declared scope, units and fingerprint over all numeric measures (a curated table would fail the unit check and be
  quarantined: `85880NED`, `85828NED`), it refuses a table that is already registered whole, and it refuses a table whose
  periods carry no machine status (`70072ned`). A quarantined slice table has no recovery path.
- **Nothing refreshes stored slices today**: `ensureSlice` re-fetches a slice only when a question needs it and CBS's
  date moved.
- **The benchmark is hermetic and mode-independent**: recorded AI replies are keyed on the request text, which does not
  contain the storage mode; the scorer checks stored cells against the frozen key. The fixture adapter already serves
  filtered slices (`src/cbs-adapter/fixture-source.ts:149-179`).
- **Measured live, 2026-09-30:** CBS's catalogue with only id, status, `Modified`, `ObservationsModified` and
  `ObservationCount` is 0.8 MB in 5 s for all 4,888 tables; one 17 MB data page took 21 s; one unbounded request hung for
  over five minutes (the reason every call now has a time limit, #357).
- **Pages that show figures without a question** (homepage, gallery, the SEO page) run the curated path live over 12
  stories on 11 tables, behind a 30-minute cache; shared links and reopened conversations replay stored answers and do
  not read cells at all.

## 3. Decisions

- **D1 — The declared scope stays; the way it is filled changes.** A pinned table keeps `cbs_tables.slice` as its
  *warm scope*. Instead of one whole-scope sync, the scope is fetched as a list of bounded slice requests through the
  existing `fetchSlice` / `ensureSlice`, each validated, stored and dated like any slice. The stored cell set is the same
  as today's, so the curated path, the benchmark and every page behave identically. (Shrinking a scope to fewer cells is
  a later optimisation, measured first.)
- **D2 — A pure planner** turns a table's warm scope plus its stored code lists into slice requests: all curated
  measures × the pinned member per plain dimension × the regions matching the scope's prefixes × the periods from the
  floor on. It chunks so each request stays under a cell cap and under a member-count cap (a request names every code, so
  745 region codes in one address is too long). Newest periods first, so the latest figure lands first.
- **D3 — Slice registration learns the pinned case.** `registerSchemaOnly` takes options: pinned, refresh cadence, the
  warm scope, and the measure curation (so units and fingerprint are computed exactly as the whole-table path computes
  them). Period status from reviewed notes (`70072ned`) is out of scope here — that table is not in production and its
  load is on hold (ADR 065). *(Built afterwards, #358 item 3: see ADR 065's as-built note.)*
- **D4 — One warm job.** `warmPinnedTables(db, source, deadline)`: one slim catalogue call tells which pinned tables CBS
  changed (`ObservationsModified` against the stored CBS date); for those, and for any planned slice that was never
  fetched, it runs `ensureSlice` per planned request until done or until its time budget ends, then continues on the next
  run. It runs in the daily job and from the command line (`npm run ingest warm [table]`). A new period arrives through
  the schema refresh `ensureSlice` already does when CBS's date moves; the planner then includes it.
- **D5 — What needs a person is e-mailed, not what is routine.** A table the job could not refresh (CBS unreachable for
  a day, a fingerprint or unit mismatch that quarantined it) alerts the owner through the existing alert channel. The
  "CBS has newer data" e-mail and the freshness report are retired once the job is live, because the job does that work.
  A slice table gets a supervised re-baseline command (the missing recovery path).
- **D6 — Small read-side changes only:** a successful slice fetch also stamps `cbs_tables.last_sync_at` (the coverage
  list and the staleness rules read it); nothing else in the curated path changes.
- **D7 — Conversion is supervised, one table at a time, least-shown first.** A read-only parity report first (fetch the
  planned slices from CBS through the adapter, compare every value and status with the stored cells, write nothing).
  Then per table: delete its cells, register it in slice mode with the same scope, warm it, re-run the parity check
  against the pre-conversion export, re-apply the registry. No readers depend on the product today, so a few minutes
  during which one table cannot answer is accepted; the homepage story for that table shows its last cached chart.
- **D8 — The test suites switch with it.** The hermetic database builder gains a slice-mode build (register in slice
  mode, warm from the fixtures). The 20-task benchmark must score the same on it (ADR 065's gate), and then it becomes
  the default build for every suite that loads data — the strongest proof available before touching production.
- **D9 — First-time questions about other tables stay the table lane** (ADR 062), switched on separately after its
  recording run and its own benchmark. It is not part of this gate.
- **D10 — Deleted after the switch:** `syncTable`'s whole-table path and `ingest sync`, the capture/chunked-sync escape
  hatch, the freshness report and the new-data alert, and — once the table lane is on — the 100-credit table request.
  Registry seed scopes stay: they are the warm scopes.

## 4. Build steps (each hermetic, zero AI spend, no schema change unless a step says so)

1. **Measure:** run the planner over every pinned table against the hermetic database and (read-only) production: slice
   count and cell count per table, longest request address. Adjust the caps on the numbers.
2. **Planner** (pure, new file) with tests.
3. **Pinned slice registration** (options on `registerSchemaOnly`; units/fingerprint parity with the whole-table path
   pinned by a test per curated table).
4. **Change detector:** the slim catalogue call in the CBS adapter.
5. **Warm job** + command line + the `last_sync_at` stamp + the re-baseline command.
6. **Slice-mode hermetic build; run the 20-task benchmark and every data-loading suite on it.** Gate.
7. **Parity report + conversion command** (supervised, production).
8. **Wire the warm job into the daily job; failure alert.**
9. **Convert production table by table** (owner present), then **delete** per D10 and update every doc that describes
   the hand refresh.

Steps 2, 3 and 4 touch different files and can be built in parallel; 5 needs all three; 6 needs 5; 7 and 8 need 5.

## 4a. Measured and built so far (2026-09-30)

- **Step 1 measured** (`npm run ingest:warm-plan`, read-only, against production): at the 2,000-cell cap the 20 pinned CBS
  tables hold 1,107,018 scope cells in **894 requests** — 512 of them for `86141NED` (616,714 cells), 120 for `85880NED`,
  112 for `85615NED`; twelve tables need four requests or fewer. Longest request address 5,202 characters (cap 6,000).
- **Live timings the same day** (consumer-price table): 34,104 rows in one filtered request took 12 s; 2,842 rows took 42 s;
  one request stalled past 120 s. Latency is per request and erratic, so the warm job uses **fewer, bigger requests**
  (`WARM_MAX_CELLS = 25,000`, for the job only — a reader's question keeps the 2,000 cap) and treats every request as one
  that can fail or time out. At that cap `86141NED` needs about 25 requests.
- **The separate change detector (step 4) is dropped for now** (cheapest mechanism first): one schema check per pinned
  table per run (about 80 small requests a day for 20 tables) already tells whether CBS changed the table. The slim
  catalogue call stays a recorded option if the daily job ever needs to get cheaper.
- **Built (session 151):** the planner (step 2, `src/ingestion/warm-plan.ts`); pinned slice registration (step 3;
  units, scope, cadence, pinned flag and fingerprint equal the whole-table path for all 17 fixture-backed seed tables);
  the warm job (step 5, `src/ingestion/warm-job.ts`: one schema check per table per run, one confirmation time per run,
  safe clean-up of outdated slice records, `ingest warm`); the parity report and the supervised conversion, the way
  back and the re-baseline for a quarantined slice table (step 7, `parity.ts`, `convert.ts`, `rebaseline-slices.ts`);
  the daily wiring and the failure e-mail (step 8, `/api/warm-job`).
- **Step 6, the gate — PASSED hermetically:** a slice-mode test build (`INGEST_FIXTURE_MODE=slice`) is identical to the
  whole-table build in every reader-relevant column for the 17 convertible seed tables; on it the 20-task benchmark
  scores 14/14, 6/6, 0 invented numbers, and the query, answer, chart, audit, registry, invariants, benchmark, db and
  ingestion suites pass. Against a whole-table run of the same commit the benchmark's answers, charts and refusals are
  the same; only the dates differ (they come from the slice records). Two product gaps found and fixed on the way: a
  period CBS has not published yet now refuses as "not available yet" on a slice table too, and a pinned slice table's
  missing cell is the same data gap as in whole-table storage.
- **Dry runs against production (read-only):** the parity report found three small tables identical; the conversion
  dry run then showed the first version's registration check was stricter than the ingestion rules (it refused on
  descriptive measure text); relaxed to unit and decimals.
- **CBS's filter limit, found by the dry runs:** CBS refuses a request whose filter names about 170 codes or more ("The
  node count limit of '1000' has been exceeded"; 165 accepted, 180 refused, measured). The planner now caps a request at
  150 codes across all axes. With the job's real caps (25,000 cells, 6,000 characters, 150 codes) the 20 pinned tables
  need **108 requests** in total, 32 of them for `86141NED` (`npm run ingest:warm-plan -- --max-cells 25000`).
- **Not done:** step 9 (converting production, owner present; then the deletions of D10). With the conversion of the
  17 pinned tables (2026-09-30) the test default became the slice build, mirroring production (`70072ned` kept
  whole-table; `INGEST_FIXTURE_MODE=full` still selects the whole-table build; ADR 065 as-built note, #358 item 2
  first half). `70072ned`'s period-note
  status in the slice store is built (#358 item 3, ADR 065 as-built note).

## 5. Invariants at stake

R1/R2 (every number a stored cell — unchanged: cells are stored before any answer), R4 (the date shown is the latest
confirmation of the covering slice — per-cell instead of per-table, never newer than the truth), R11 (status per cell),
the quarantine rule of ADR 003 (a structural change takes the table out of service), principle (b) (only the job talks
to CBS), principle (c) (a cell outside every fetched slice refuses; it is never guessed).

## 6. Open points (marked; mirrored in open-questions #356)

- **Assumption:** filling a warm scope in bounded requests takes minutes, not hours, per table. Step 1 measures it; if a
  big regional table needs too many requests, the cell cap for warm requests is raised (one data page carried 17 MB in
  21 s) rather than the design changed.
- **Assumption:** a few minutes of refusals per table during conversion is acceptable (no outside users). If that stops
  being true before conversion, adopt the stored cells in place instead and let the job re-confirm them.
- The per-cell date can differ between cells of one chart when slices were confirmed on different days; the chart shows
  the oldest (existing behaviour of the slice store).
- Eurostat's four datasets are whole-dataset copies too; they follow the same pattern after CBS, in their own step.
  *(Designed and built 2026-09-30: section 7.)*

## 7. Eurostat on the one route (#358 item 4, 2026-09-30) — designed and built

**The smallest design:** a Eurostat dataset is stored, warmed, proven and converted by the SAME code and commands as a
CBS table (`ingest warm`, `ingest:parity`, `ingest convert-to-slices`, `convert-to-full`, `rebaseline-slices`). No
second planner, no second store, no schema change. What changes is only where Eurostat differed:

- **The adapter speaks the slice store's request.** `fetchSlice` asks every source for `measures` × `dimensionIn` ×
  `periodIn`. The Eurostat adapter used to refuse those three fields; it now sends them (`unit=` from the
  `<dataset>|<unit>` measure code, one parameter per listed member, a `geo` list inside the EU/EFTA restriction instead
  of the whole sweep, `sinceTimePeriod` at the earliest listed period) and applies the exact lists client-side, as it
  already did for every other clause. A listed member or unit missing from the response refuses (no result with holes).
- **The registered scope reaches every schema read.** `registerSchemaOnly`, `checkSliceSchema` (so the warm job and
  every reader fetch), the parity report, the conversion and the re-baseline pass the table's own `cbs_tables.slice` to
  `fetchTableSchema` / `fetchCodeList`, exactly as the whole-table sync always did. A Eurostat schema — its measure set
  and the decimals the unit check compares — comes from that one scoped request (a full dataset can be over the 500k
  synchronous cap). CBS's adapters ignore the argument, so CBS is unchanged.
- **The planner knows Eurostat's shape:** the period floor applies to `time` (not `Perioden`), and a scope pinning `unit`
  is checked against the measure codes (Eurostat folds the unit into the measure). The four datasets plan to one or two
  requests each.
- **Frozen-dataset detection (ADR 048's 2026-09-30 addendum) moves into the job.** A frozen dataset never looks changed,
  so the job would re-confirm it every day. After its one schema check the warm job judges a Eurostat table's newest
  stored period by the freshness report's limits (monthly 4 months, quarterly 3 quarters, annual 30 months — now shared
  in `src/ingestion/data-end-lag.ts`) and, past the limit, quarantines it (stage `period_parsing`, before any slice is
  confirmed): its figures refuse and the owner is mailed. CBS tables are not judged this way.
- **Routing:** `warmPinnedTables` takes adapters for other sources (`sources: { eurostat }`); the command line builds each
  table's adapter from its id prefix (under the run budget — the Eurostat adapter gained the same `stopAt` as CBS's), the
  parity report likewise, and the daily `/api/warm-job` passes a Eurostat adapter under the same hard stop and limits.
- **Conversion curation:** a Eurostat dataset has no seed entry; its own stored scope and cadence (the reviewed
  registration) are carried over. The conversion rewrites the row in place, so the DOI stays.

**What stays:** the fail-closed checks are the existing ones — fingerprint over dimensions and measures, unit and
decimals (quarantine), Eurostat's per-cell statuses through `buildStagedRows`, a source date never moving backwards, the
"rows outside the request" guard. Nothing changes in production until a dataset is converted (the job only touches
slice-stored tables). The whole-table sync of a Eurostat dataset (now routed by the command line) stays as the way back
until the D10 deletion.

**Invariants:** R1/R2 (cells stored and checked before any answer), R4 (dated by the covering slice's confirmation), R11
(Eurostat's flags stored verbatim per cell; `Published` only for an unflagged value), principle (c) (a frozen dataset or
a changed unit takes the table out of service). No LLM prompt bytes change.

**Tests (hermetic, real captured responses):** `tests/ingestion/eurostat-slices.test.ts` — for all four datasets a
slice-mode build equals the whole-table build (every cell with value, status and value attribute; the registry row; the
labels); a second warm run confirms every slice; the parity report is identical; a dry-run and a real conversion keep
every cell and the DOI; `convert-to-full` plus a sync works; a frozen monthly dataset and a changed unit quarantine.
Adapter URL, refusal and budget tests in `tests/eurostat-adapter/statistics-api.test.ts`; parser list tests in
`tests/eurostat-adapter/jsonstat.test.ts`.

**Open:** (1) **Assumption:** the Statistics API accepts repeated values for any dimension (verified live for `geo`
only); the four datasets send one value per non-geo dimension, so only a future multi-unit request depends on it.
(2) A fresh slice registration of a NEW Eurostat table (not a conversion) does not verify a DOI; the four existing rows
keep theirs. (3) Converting production's four datasets is an owner-present step, as for CBS (RUNBOOK).
