# Breadth: any current CBS table answerable in the same chat

**Status:** design APPROVED by the owner, session 138 (2026-09-28) — after the owner's product sanity check
([#335](../../open-questions.md), [brief](../../session-briefs/2026-09-28-sanity-check.md)) chose breadth as the next
priority, the owner answered "Yes, write the plan (Recommended)" on the plain-English design (find the table → pick the
slice from CBS's own breakdowns, total by default → fetch just those numbers, check, store, answer in the same chat →
normal price). **ADR:** [062](../../decisions/062-breadth-table-lane-slice-cache.md). **Step 1 ✅ measured, step 2 ✅ built (session 138), step 3 ✅ built (session 139), step 4 ✅ built hermetically (session 139; recording run pending), step 5 ✅ built and wired dark behind `TABLE_LANE_ENABLED` (session 140, 2026-09-29; D6's old-flow fallback deliberately NOT wired — [#343](../../open-questions.md)); step 6 (benchmark, then the flip) pending.** Supersedes, when live, the 100-credit e-mail flow of
ADR [026](../../decisions/026-on-demand-fetch-job-architecture.md) as the default path.

## 1. The goal in one sentence

A question about any current CBS table gets a checked answer in the same conversation, at the normal question price —
every number still a stored, validated CBS cell with source and date; ask or refuse when unsure.

## 2. Measured facts this design rests on (2026-09-28)

- CBS catalog: 4,858 tables, of which **1,277 current** (`Regulier`); we hold 21. Total size of the current tables
  ≈ 3.5 billion cells (sample of 150, extrapolated) vs. our 1.04 M cells / 400 MB — **pre-loading everything is out**;
  tables must be fetched when asked and kept.
- Sizes: median current table 17,760 cells; 72% ≤ 150k; 87% ≤ 1M; heavy tail to 129M.
- Shapes (150-table sample): only **8% time-only** (the only shape today's on-demand flow delivers); 92% have breakdown
  dimensions and/or a region dimension (21% have a region).
- Breakdown dimensions (279 in the sample): median 7 members, p90 128, 23 over 200 (regions, commodity lists).
  **69% have a recognisable total** (title starting "Totaal" or code `T00…`; 173 have exactly one candidate); only
  **50% of tables have a total for every breakdown**. Recurring special shapes: a `Marges` dimension (value vs. error
  margins), region lists not typed `GeoDimension` (`AlleRegioIndelingen`, 18,235 members), a period-like dimension not
  typed `TimeDimension`, totals named "…; totaal".
- Today's on-demand flow (ADR 025/026/027): finder (Postgres FTS + Haiku rerank) → Haiku measure-fit gate (time-only
  tables only) → 100 credits → async job (kick + daily cron) → whole-table ingest (≤150k-cell slice) → re-run →
  e-mail. Measured once end-to-end: 88 s. Used 3 times in production.
- The query layer already accepts `{ kind: 'explicit', tableId, measure, dims }` targets (`src/query/types.ts:28`).

**Step 1 result — all current tables measured (2026-09-28, metadata only, 1,271 of 1,277 reachable;
`scripts/research/cbs-catalog-crawl.py` + `cbs-catalog-analyze.py`):**
- Shapes: 7% time-only, 8% region only, 30% one breakdown, 26% two, 28% three or more; 8% carry regions in a dimension
  not typed `GeoDimension` (detect by `NL/PV/GM/…` member codes).
- Breakdown dimensions (2,452): 1,665 with exactly one total, 177 with several candidates, 488 with none, 122 `Marges`
  (value vs. margins) — 896 have more than 12 members (buttons need a short-list).
- **728 tables (57%) answerable without asking** (every breakdown has one total or a convention); ~31% need a button
  question when the question doesn't name the breakdown; **151 (12%) have no machine period status** → refused (D7) until
  a generic reviewed period-note reader exists.
- 420 tables (33%) exceed 150k cells — no blocker for slice fetching (D4).
- 430 distinct unit strings; `code`, `naam`, `omschrijving` (224 tables) mark TEXT measures → never answerable as numbers.
- Period grains beyond JJ/KW/MM (e.g. `SJ`, `HJ`, `X0`, month-like `01`–`12`, `G4`) → the period parser refuses unknown
  grains (D7); measure which matter before widening.
- **Reach: ~88% of current tables (~1,100) answerable, most without a follow-up question — vs 21 today.**

## 3. Decisions

- **D1 — Two lanes.** The 26 curated figures stay the fast lane (today's parser, unchanged prompt). A question the
  curated lane cannot place goes to the **table lane**: find the table, then parse the question *against that one table's
  own schema*. No global vocabulary growth: nothing about new tables is added to the curated parser's prompt (today's
  `onboarded:` vocabulary approach does not scale to 1,277 tables and shifts every fixture hash).
- **D2 — Table-scoped parse (one closed-choice LLM call, cheap tier).** Input: the question + the table's measures
  (codes + titles + units), its breakdown dimensions with their member lists (codes + titles; dimensions over a size cap
  are pre-filtered deterministically by text match to the question), its period grains, and whether it has regions.
  Output: measure code, one member per breakdown **or "not named"**, period(s), region names, derivation — every code
  validated against the table's own lists (hard allowlist, like the finder and measure-fit validators). Regions go through
  the existing deterministic region resolution, never the model.
- **D3 — Unnamed breakdowns (owner decision).** When the question does not name a member: use the dimension's CBS total
  when exactly one is identifiable, and **state it in the answer** ("alle leeftijden, mannen en vrouwen"); when none or
  several are identifiable, **ask with buttons** (the dimension's members; a list over ~12 gets a short-list + "andere").
  Total detection is deterministic and conservative (title/code conventions, measured); a small reviewed list of CBS
  conventions handles recurring special dimensions (e.g. `Marges` → the value, never a margin). Never a guessed default.
- **D4 — Fetch only what the question needs.** Register the table's schema once (metadata + code lists + units +
  fingerprint — no cells). Then fetch the **question's slice** (the chosen measure × members × periods × regions),
  typically 1–500 cells, validate it with the same checks that apply to a slice (fingerprint, dimension mapping, period
  parsing + status, units, duplicates, null reasons), store it, answer. Later questions on the same table fetch only the
  cells not yet stored. This is a new ingestion mode ("slice cache") beside today's whole-table sync; the whole-table
  row-count and every-measure-present checks do not apply to it.
- **D5 — Principle (b) holds.** Answers are only ever composed from our own stored, validated cells. The fetch runs as a
  job outside the request (the existing kick + job infrastructure), while the chat shows progress ("CBS-tabel ophalen…")
  and polls for completion — no e-mail. Target: answer within ~15 s for a new table, ~5 s for a stored one. Over a hard
  time budget the chat says so and the answer lands in the thread when ready (no silent drop).
- **D6 — Price: the normal question price, charged only on an answer.** Refusal free; clarification its usual small
  price. The 100-credit tier and the confirm-offer step retire for tables the table lane can serve; the old async flow
  stays only as a fallback for tables it cannot (e.g. above a slice size cap) until measured otherwise.
  **As built (step 5):** the fallback is NOT wired — with the flag on, a table the lane cannot serve is refused free; step 6
  measures whether the fallback is worth wiring ([#343](../../open-questions.md)).
- **D7 — Fail closed.** Unknown dimension shapes, a table without machine period status (unless it has a reviewed
  period-note map, ADR 061), a unit the formatter doesn't know, a finder pick below its calibrated floor, a code outside
  the table's lists → clarify or refuse; never a guessed number. Every answer is audited as today (R8), including the
  table-lane parse.
- **D8 — Stepwise, each step dark behind its own flag until its own measurement passes.**

## 4. Build steps

1. **Measure first (zero spend):** extend the 150-table sample to all 1,277 current tables (metadata only): dimension
   shapes, total-detection hit rate, special-dimension conventions, period-status presence, unit strings unknown to our
   formatter. Output: the reviewed convention list and the exact coverage the table lane can reach.
2. **Slice cache ingestion (zero spend, hermetic):** schema-only registration; `fetchSlice` + slice validation + store +
   dedupe against stored cells; freshness per slice (CBS `Modified`); eviction reuses #110.
3. **Breakdown resolver (zero spend for the deterministic half):** total detection + conventions; the button
   clarification for unnamed breakdowns without a total.
4. **Table-scoped parser (LLM, cheap tier):** prompt + schema + allowlist validator + labelled eval set; recorded
   fixtures (small spend, owner-supervised, after 2026-10-01).
5. **Orchestration + chat UX:** curated miss → finder → table-scoped parse → slice job + in-chat progress/poll → audited
   answer; normal pricing; follow-ups in a thread reuse the table.
6. **Measure live, then switch on:** a table-lane benchmark (new frozen key over ~20 tables of different shapes),
   0 fabricated, refusal/clarification correct; then flip the flag; retire the 100-credit offer for servable tables.

## 5. Invariants at stake

R1/R2 (every number a stored cell — slices are stored before answering), R3/R10 (units/format — unknown units refuse),
R5 (no derivation outside the registered set), R7 (confidence thresholds — the finder floor and the parse allowlist),
R8 (audit), R9 (completeness for class answers), R11 (status per cell), principle (b) (D5), principle (c) (D3/D7).

## 6. Open points (marked, mirrored in open-questions)

- **Assumption:** a question's slice fetch returns in a few seconds via CBS's `$filter` (measured for single-table
  filters in session 138; not yet measured for multi-member filters across large tables) — step 1/2 measures it.
- **Assumption:** the curated lane's "no match" signal (`unmatchedMeasureTerm`) is reliable enough to route to the
  table lane; step 5 only wired it — measured in step 6 on the labelled sets.
- Finder calibration (#172) matters more once every miss goes through it — re-measure in step 4.
- Real-user launch (sanity-check move 1) remains recommended once the table lane is live.
