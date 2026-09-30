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
  load is on hold (ADR 065).
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
- **Built and merged locally:** the planner (step 2, `src/ingestion/warm-plan.ts`, 51 tests), pinned slice registration
  (step 3; units, scope, cadence, pinned flag and fingerprint equal the whole-table path for all 17 fixture-backed seed
  tables, 25 tests). **In progress:** the warm job (step 5) and the read-only parity report (first half of step 7).

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
