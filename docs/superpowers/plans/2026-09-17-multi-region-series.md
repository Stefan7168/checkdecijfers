# Multi-region series (`region_series`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** answer "one measure, 2–6 explicitly named regions, a period range" — one line per region,
each region's own first/last/direction, no cross-region claim, honest per-region coverage — and make
small multiples reachable from a CBS answer for the first time (UX-audit pass-3 rows 13, 14).

**Architecture:** the shape is DERIVED from fields the intent contract already has
(`regions.length > 1 && periodCodes.length > 1`), so nothing under `src/answer/intent/` changes and
no LLM fixture moves. `resolve.ts`'s one-varying-axis refusal becomes conditional; `run.ts`'s existing
one-statement cross-product fetch is reused; a new `ResultShape` `'region_series'` carries a
per-region coverage record; `deriveDirection`/`deriveFirstLast` are called on per-region SLICES
(`checkSingleRegion` keeps that the only legal call); `buildChartSpec` emits `kind: 'line'`; the body
is the deterministic template, so R8 re-derives it byte-identically. **Tech stack:** TypeScript,
Vitest, Postgres (hermetic test DB, ADR 009), Next.js/React (`web/`) — no new dependency, no
migration, no new SQL primitive, no prompt/schema byte.

**Spec:** [docs/superpowers/specs/2026-09-17-multi-region-series-design.md](../specs/2026-09-17-multi-region-series-design.md)
— read it fully before Task 1; this plan argues from it and does not repeat its rationale.

## Global constraints

- **Every task is hermetic and autonomously buildable. No task may touch `src/answer/intent/prompt.ts`
  or `schema.ts`** — one byte invalidates 103 recorded fixtures (`src/answer/llm/client.ts:92`).
  `PROMPT_VERSION` stays 6, `RAW_PARSE_VERSION` stays 3. The only real-LLM cost is the ordinary
  benchmark run the verification block already requires (Task 7's two labelled cases).
- **`INTENT_SCHEMA_VERSION` stays `1`** and `StructuredIntent` gains NO field: a bump breaks live
  embed tokens (`chart/embed-live.ts`) and in-flight pending clarifications
  (`respond/validate-pending.ts`).
- **MS1 is enforced by the ABSENCE of a derivation record**, never by filtering words out of prose,
  and by `deriveDirection`/`deriveFirstLast` receiving single-region slices only. **No cross-region
  claim of any kind:** `deriveMax` must never see this shape's cells.
- **Present-only discipline** (`?? null`, never `hasOwnProperty`) on every new envelope field, per
  [docs/13](../../13-envelope-presence-grammar.md), plus a manifest row (Task 6).
- **Backend tests live in the top-level `tests/` tree** mirroring `src/` (never co-located); `web/`
  tests ARE co-located. Any new *interface* string gets an `nl` and an `en` entry in
  `web/lib/i18n/messages.ts`; backend-built Dutch answer/refusal text stays Dutch and is not one.
  Run `npm run audit:verify` on any change touching validators or reconstruction (Tasks 5, 6).

### Task 1 — Contract + the conditional resolver gate (hermetic)

**Files:** `src/query/types.ts` (add `'region_series'` to `ResultShape`, `RegionSeriesCoverage`, the
present-only `ValidatedResult.regionSeries`, `REGION_SERIES_MAX_REGIONS = 6`,
`REGION_SERIES_MAX_CELLS = 500`); `src/query/resolve.ts` (the gate at `:313-325`);
`src/query/index.ts` (exports); test `tests/query/region-series-resolve.test.ts`.

**Tests first:**
- 2 regions + a 5-year range on `03759ned` → resolves; `regionCodes` in the intent's own order,
  `regionLabels` populated for both.
- Each of these keeps the EXISTING `invalid_intent` + `subReason: 'multi_region_multi_period'`
  refusal: 7 regions + a range; a `regionSet` + a range (a CLASS stays refused); 6 regions × 120
  `KW` periods (over `REGION_SERIES_MAX_CELLS`).
- 2 regions + a range on a no-geo table (`85224NED`) → `invalid_intent`, axis `region`, unchanged.
- 2 regions + a range with `derivation: 'difference'` → the existing arity refusal (`:331`), not the
  new path; same for `'max'` (`:347`).
- A pin that a 1-region range (`series`) and a 1-period multi-region (`comparison`) resolve
  byte-identically to today.

**Invariants:** ADR 011 contract (additive OUTPUT only, version unbumped); principle (c).
**Done when:** the tests pass and **no existing `tests/query/*` test changes**.

### Task 2 — `run.ts`: partition, coverage record, per-region derivations, shape (hermetic)

**Files:** `src/query/run.ts` (the completeness loop `~:437-446`, a new partition block, the
derivation block `~:570-625`, the shape assignment `~:676-687`); test
`tests/query/region-series-run.test.ts`.

**Tests first (against the real hermetic ingest unless noted):**
- 2 regions × 2020–2024 / `population_on_1_january` → 10 cells, `shape === 'region_series'`,
  `regionSeries.complete === true`, cells still period-major/region-minor; **two** `direction` and
  **two** `first_last` records, each `sourceResultIds` holding only its own region's cells; **zero**
  `max` records (the pre-registered `deriveMax` at `:620` is re-gated off this shape — assert the
  kinds, plus a seeded case where it would otherwise have fired).
- A seeded `Confidential` null on one region's middle year → that region lands in
  `regionSeries.partial`, its cells stay WITH the reason (R11), it has **no**
  `direction`/`first_last`, the other region still has both, `complete === false`.
- A deleted row for one region at one period → that region lands in `regionSeries.excluded`,
  contributes **zero** cells, `complete === false`, and the query does **not** refuse.
- Deleting rows until fewer than 2 regions survive → the EXISTING `diagnoseMissing` refusal
  (`freshness`/`not_published`/`outside_loaded_slice`), never `no_data` (which pages the owner).
- A pin that a plain `series` intent with a missing period still refuses exactly as today — the
  all-or-nothing deviation is scoped to this shape only.

**Invariants:** R11 (withheld cells stay present with their reason), R5 (registered functions only),
**MS1**, ADR 011 alternative 3 as revised by the spec.
**Done when:** all pass and the full `tests/query` suite is unchanged-green.

### Task 3 — Chart: multi-series line, and the proof-panel gap (hermetic)

**Files:** `src/chart/build.ts` (the shape gate `:62`, the contiguity gate `:71`, the kind choice
`:74`); `web/lib/answer-proof.ts` (`derivationStep`'s `direction` case, `:279-288`);
`tests/chart/region-series.test.ts`; pins in `web/components/chart.test.tsx` and
`web/lib/answer-proof.test.ts`.

**Tests first:**
- A `region_series` result charts as `kind: 'line'`, one series per region **in intent order** (today
  it returns `null` — the bug this fixes); the `region_set` ranking sort never runs; a non-contiguous
  explicit period enumeration still charts as `null`.
- A partial region's null cell keeps its `nullNotes` line naming region + period + verbatim reason;
  every point carries its `resultId` (R1/R6); `trendHeadline` is absent (multi-region).
- In `web/`: a 2-series `kind: 'line'` spec → `lineFormAllowed` true, `areaFormAllowed` false,
  `hbarFormAllowed` false, `defaultFormFor` → `'line'`, and **`smallMultiplesAvailable` is true**
  (the row-14 finding, asserted through a real render, not re-implemented); `scanForUnboundDigits`
  finds no unbound digit.
- `buildAnswerProof` on a 2-region result renders two DISTINCT direction steps, each naming its own
  region; a single-region result's step text is **byte-identical to today** (regression pin).

**Invariants:** **R6** (verbatim projection, spec order is render order), R1, R11.
**Done when:** both suites pass with no change to `BAR_LABEL_MAX`, `defaultFormFor` or any existing
form rule.

### Task 4 — Answer: template body, coverage line, refusal wording (hermetic)

**Files:** `src/answer/compose/template.ts` (`renderRegionSeries` + the `renderTemplateBody`
branch); `src/answer/compose/format.ts` (`buildRegionSeriesLine`, beside `buildRegionSetLine`);
`src/answer/compose/types.ts` + `compose.ts` (`regionSeriesLine` beside `regionSetLine` at
`:120-129`; `templateOnly` by shape at `:259`); `src/answer/respond/respond.ts` (`:498`);
`src/answer/respond/refusals.ts` (`buildMultiRegionMultiPeriodRefusal`, `:546-558`); tests in
`tests/answer/` plus a new **MS1 block** in `tests/invariants/invariants.test.ts` (beside R5/R9/RS1).

**Tests first:**
- A complete 2-region result renders ONE sentence, one clause per region carrying that region's own
  endpoint values and direction word, and passes `validateAnswerBody`.
- A result with one `partial` region renders **no** clause and **no** trend word for it, still
  passes, and its values are absent from the body but present in the chart spec; a result with **no**
  complete region falls back to the claim-free `cellLine` listing and passes.
- `composeAnswer` makes **zero** LLM calls for this shape (a client stub that throws if called) even
  when the caller passes no `templateOnly` — the guard is on the shape.
- The coverage sentence lands in `regionSeriesLine`, **not** in `body` (mirror the existing
  `assumptionLine`/`regionSetLine` pins), is `null` when `complete`, names a `partial` region by its
  verbatim CBS label and an `excluded` region by its bare CBS code.
- The over-cap / region-class refusal keeps `subReason: 'multi_region_multi_period'` and its offer
  chip (`multiRegionMultiPeriodOfferChip`), gets wording that no longer claims the whole shape is
  unsupported, and still gives the region-CLASS case **no** chip.
- **MS1 block:** a hand-written body with a trend word about a PARTIAL region is rejected (no
  derivation to bind to); a superlative anywhere in a `region_series` body is rejected (no `max`
  record); a comparative across two region names ("Amsterdam groeide meer dan Rotterdam") is
  rejected; `deriveDirection`/`deriveFirstLast` still refuse a multi-region cells array
  (`checkSingleRegion` regression pin — the guard this whole design leans on).

**Invariants:** **R1** (structural exemption only), R3, **R5**, **R9**, R10, R11, **MS1**,
principle (a).
**Done when:** `tests/answer` is green and **no `tests/fixtures/llm/answer` fixture is touched**.

### Task 5 — Validator: region-aware trend backing (hermetic)

**Files:** `src/answer/compose/validate.ts` (`trendBacking` `:905-907`, `expectedTrendForClause`'s
`cellsByYear` `:936`); `tests/answer/validate.test.ts`.

**Tests first:**
- A result with two `direction` records, one `up` and one `down`: a clause claiming "steeg" about the
  DOWN region is rejected (today the first record silently backs it); `expectedTrendForClause`'s
  year lookup is scoped to the clause's region, so a clause whose years resolve through the other
  region's values no longer decides the direction.
- A trend clause naming **no** region, or **two**, on a multi-`direction` result → no backing →
  rejected (fail closed).
- Every single-`direction` (ordinary `series`) case is byte-identical to today — a broad regression
  pin; the existing validator suite must not change.

**Invariants:** **R9**, principle (c).
**Done when:** `npm run audit:verify` passes and no existing validator expectation changed.

### Task 6 — Audit / R8 (hermetic)

**Files:** `src/answer/audit/reconstruct.ts` (the `regionSetLine` block `~:294-307` and the
shape-scoped body re-derivation `:320-331`); `tests/audit/envelope-key-manifest.test.ts`;
`docs/13-envelope-presence-grammar.md`.

**Tests first:**
- A stored `region_series` row reconstructs: body, `regionSeriesLine` and chart spec all re-derive
  byte-identically through the same builders; `answer.source` must be `'template'`.
- A tampered coverage record fails loudly — a `complete` flip, a region moved between
  `partial`/`excluded`, an invented `excluded` entry (three pins); a pre-feature row (no
  `regionSeries`, no `regionSeriesLine`) still reconstructs via `?? null`.
- Manifest rows for `ValidatedResult.regionSeries` and `ComposedAnswer.regionSeriesLine`, with the
  two declared-member counts bumped.

**Invariants:** **R8**.
**Done when:** `npm run audit:verify` passes and the manifest test enumerates both new keys.

### Task 7 — Docs, benchmark cases, stale-doc sweep

**Files:** new `docs/decisions/055-multi-region-series.md`; addenda to
`docs/decisions/011-query-contract.md` (the new shape; why `INTENT_SCHEMA_VERSION` is NOT bumped
even though this IS the cross-product shape its own revisit trigger named; the shape-scoped
deviation from alternative 3) and `054-region-set-query.md` (its "several regions and several
periods remains refused" line is now wrong for NAMED regions); `docs/05-data-rules.md` (R5 + R9
notes naming MS1); `docs/04-architecture.md` capability row; `docs/08-build-plan.md` (new WP);
`docs/09-pricing.md` (one line: still `simple`, one intent call, zero phrasing calls);
`docs/open-questions.md` (the three owner questions; the excluded-region-named-by-code
**Assumption**; a row for `src/query/resolve.ts:673-675` — explicit regions on a no-geo table still
carry no `subReason` and would page the owner, reachable only through the harness today);
`docs/STATUS.md`; `benchmark/intent-labelled-set.json` (spec questions 1 and 4).

**Stale-doc sweep:** `grep -rn "several regions AND several periods\|one.varying.axis\|small multiples" docs/ src/ web/`
and fix every place that still says the capability cannot exist — at minimum ADR 011's revisit
trigger, ADR 054's D1 and revisit trigger, the pass-3 brief's rows 13/14, and the now-wrong comment
at `src/answer/respond/suggestions.ts:268-270` ("a multi-region series is a shape the query layer
refuses"), whose `trend()` chip must also skip the new shape.

**Done when:** the sweep returns no contradicting hit and the benchmark is at or above the gate
(14/14 + 6/6 + 0 fabricated) with the two new cases included.

## Sequencing

Task 1 → Task 2 is a chain. **Tasks 3 and 4 both depend on 2 and are independent of each other — run
them in parallel.** **Task 5 depends on nothing in this plan** (a pure validator hardening whose
tests hand-build their own multi-`direction` result) and can start immediately; merge it before
Task 4 if both touch `tests/answer/validate.test.ts`. Task 6 needs 4; Task 7 is last.

Unlike ADR 054's region-set shape, this capability is **reachable by a real user question the moment
it merges** — the parser already emits the intent (spec §"The intent side"). That makes Task 7's
benchmark run the real go/no-go: the first live confirmation that the parser does in practice what
its own prompt rules require.

## As-built notes (task 5)

Built in worktree `s110-mrs5` (branch `s110/mrs5`), independent of Tasks 1–2 as planned — no
`region_series` shape exists yet, and none was added here. The hand-built test result uses
`shape: 'series'` with two `direction` derivations (one per region, each produced by the real
`deriveDirection` over that region's own cells) since `validate.ts` never reads `result.shape` at
all — the fix is shape-agnostic by construction, so it needs nothing from Tasks 1–2 to be correct
for `region_series` once that shape lands.

**Deviation from the plan's file list:** the plan names `tests/answer/validate.test.ts`; the actual
suite for this module is `tests/answer/compose-validate.test.ts` (there is no `validate.test.ts` in
the repo). Tests were added there, in a new `describe('#264 (task 5): region-aware trend backing for
multi-\`direction\` results')` block.

**Mechanism, as built:**
- `trendBacking()` (took the first `direction`, else first `difference`, record) is replaced by
  `trendCandidates(result, cellsById)`, which collects EVERY `direction`/`difference` derivation as a
  `TrendCandidate` carrying its own `sourceCells` and the `regionCode` those cells share
  (`checkSingleRegion` in `derivations.ts` already guarantees a `direction` record's sources are
  single-region, so `sourceCells[0].regionCode` is that record's region unambiguously).
- `resolveTrendBacking(scopeText, candidates)` picks which candidate backs a claim in one clause (or
  sentence, for the comparative fallback). **Important refinement made mid-build, not in the
  original spec text:** the multi-candidate branch is gated on the candidates spanning **more than
  one DISTINCT region**, not merely "more than one candidate" — an ordinary single-region B13-style
  result carries TWO candidates (an explicit `difference` alongside the pre-registered `direction`)
  and must keep the OLD unconditional "prefer `direction`" priority with no region mention required.
  Gating on candidate *count* instead of distinct-region *count* was tried first and broke the real
  B13 fixture in `compose-pipeline.test.ts` (a real single-region result, "Dat is een toename." named
  no region and was wrongly rejected as ambiguous) — caught by running `tests/answer` in full before
  committing, exactly the check the plan's Task 5 scope asks for. Only when candidates truly span
  ≥2 regions does the "the clause names EXACTLY one candidate's region" rule apply; naming zero or
  two-plus is fail-closed (MS1).
- `expectedTrendForClause` now takes the resolved `TrendCandidate` (not a bare `Trend`) and scopes its
  `cellsByYear` lookup to cells whose `regionCode` matches the backing's own region — a no-op for
  single-region results (all cells already share that region) and the fix for the "a later region
  silently overwrites an earlier one" bug the spec names.

**Tests (`tests/answer/compose-validate.test.ts`, describe block `#264 (task 5)`):** a hand-built
two-region result (Amsterdam rising, Rotterdam genuinely falling, one `direction` record per region
via real `deriveDirection` calls) proves, before the fix, all of: (1) a clause claiming a rise for
Rotterdam was wrongly ACCEPTED (borrowed Amsterdam's backing — the first-record bug); (2) a clause
naming no region was wrongly ACCEPTED; (3) a clause naming two regions was wrongly ACCEPTED, and
separately, that (4) a correctly-attributed two-region answer ("Amsterdam steeg ...; Rotterdam
daalde ...") was wrongly REJECTED (the single global `net` judged both clauses). After the fix, (1)–(3)
are rejected and (4) is accepted with zero problems — all four pins are in the committed test file.
Every pre-existing validator expectation in the file (85 tests) is unchanged and still passes.

**Verification run (final, this task only):**
- `npx vitest run tests/answer/compose-validate.test.ts --maxWorkers=1` → 89 passed (85 pre-existing
  + 4 new), 0 failed.
- `npx vitest run tests/answer --maxWorkers=1` → 828 passed, 0 failed (confirms the B13
  single-region-two-candidate regression found and fixed mid-build stays fixed, and nothing else in
  the answer pipeline moved).
- `npm run typecheck` (root) → clean, no errors.
- `npm run audit:verify` was NOT run (needs the live DB, out of scope for this hermetic worktree task
  per the dispatch brief) — the plan's own "Done when" for Task 5 names it, so a later session with
  DB access should run it once before treating the whole multi-region-series plan as done; this
  task's own hermetic proof is the two vitest runs above.

## As-built notes (tasks 1–2)

Built session 110, branch `s110/mrs12`. Both tasks landed as specified; the
deviations below are the ones a later task owner needs to know about.

1. **Task 1's "no existing `tests/query/*` test changes" could not hold, and
   should not have.** `tests/query/query.test.ts`'s pin *"several regions AND
   several periods at once is out of contract"* used **two** named regions over
   **two** period codes — which is exactly the case this feature accepts. The
   pin now exercises the over-the-cap case (7 named provincies) and keeps its
   `multi_region_multi_period` assertion; nothing else in `tests/query` moved.
2. **The one-varying-axis check moved to AFTER the derivation-arity switch** in
   `resolve.ts`, which is what makes Task 1's own test list true (a
   `difference`/`max` ask over several regions hits its own arity refusal on the
   `derivation` axis, not the generic scope limit). Consequence worth knowing:
   a region CLASS combined with `max`/`difference` over several periods now gets
   the arity message instead of `multi_region_multi_period`. No test pinned that
   combination, and the answer layer's chip builder keys on the sub-reason, so
   that case simply reads as a derivation-arity refusal.
3. **The internal refusal `message` gained a per-case detail suffix** (which cap
   was hit, or that a region class spans several periods). It still contains the
   verbatim `one varying axis per question` that existing tests match on. The
   user-facing wording in `refusals.ts` is untouched — Task 4 owns it.
4. **`src/answer/compose/template.ts` needed an interim `region_series` case.**
   `renderTemplateBody`'s switch is exhaustive over `ResultShape`, so adding the
   member breaks `npm run typecheck` until every renderer knows it. The interim
   branch returns the design's own fail-closed floor — the claim-free per-cell
   listing `renderSeries` produces, each line naming its region, period and
   value, no trend word — so MS1 holds before Task 4 exists. **Task 4 replaces
   this branch with `renderRegionSeries`.**
5. **The floor is literally today's `diagnoseMissing`, so its kind depends on the
   gap class.** A period beyond the freshest gives `freshness` (test-pinned); an
   unpublished period gives `not_published`; a period outside the slice refuses
   in the resolver. A *seeded* interior deleted row still gives `no_data` —
   identical to what a single-region `series` over the same hole gets today,
   which is the point: the floor adds no new refusal vocabulary. The spec's
   "deliberately not `no_data`" is about not *manufacturing* one, and that holds.
   Pinned both ways: the multi-region refusal's `kind` and `axis` are asserted
   equal to the single-region series' over the same coordinate.
6. **"A seeded case where `deriveMax` would otherwise have fired" is not
   constructible.** `deriveMax` refuses any multi-period cells array
   (`derivations.ts`), so no seed makes it fire on this shape; the explicit
   `!isRegionSeries` guard is stated anyway (the rule belongs to `run.ts`, not to
   another function's internals). The test asserts zero `max` records on the
   shape **and** that the same three regions at one period still pre-register
   their comparison `max` — the contrast that proves the exclusion is
   shape-scoped, not a dead branch.
7. **Known red outside `tests/query`, for Tasks 4 and 6 to fix — measured, not
   predicted.** Three existing suites build a 2-named-region-over-a-range intent
   and assert it REFUSES, which is exactly what now answers end to end:
   - `tests/answer/query-refusal-chips.test.ts` — **4 failed / 5 passed** (the
     whole row-13 block, including its flag-off byte-identity pin);
   - `tests/answer/region-set-answer.test.ts` — **1 failed / 11 passed**;
   - `tests/audit/region-set-r8.test.ts` — the row-13 `beforeAll` throws
     *"expected a refusal, got answer"*, so that suite reports **13 passed /
     5 skipped** and the file fails.

   Each needs re-pointing at a still-refused case (over the cap, or a region
   class), the same edit `tests/query/query.test.ts` took in note 1. Tasks 4 and
   6 own them; nothing in `src/` is wrong.

## As-built notes (task 3)

Built in worktree `s110-mrs3` (branch `s110/mrs3`), on top of Tasks 1–2
(`s110/mrs12`, merged into this worktree's base). No deviation from the
plan's file list or done-definition; every test the plan's Task 3 section
names is in the committed suite.

**Chart builder (`src/chart/build.ts`):** three edits, all in `buildChartSpec`.
1. The shape gate (`:62` in the plan's line numbers) now admits
   `'region_series'` alongside the existing three shapes.
2. The `#64` contiguity gate — previously `result.shape === 'series'` only —
   now also runs for `'region_series'`. Its cells are period-major/
   region-minor (N regions × M periods), so the naive `cells.map(c =>
   c.periodCode)` list repeats each code N times; `contiguousPeriodCodes`
   (`src/query/resolve.ts`) already de-duplicates before checking, so no
   region-aware rewrite was needed — the existing function was already the
   right shape for this call.
3. `kind` is `'line'` for `'series'` OR `'region_series'`, `'bar'` otherwise.

Nothing else in the file changed: the group-by-region loop
(`seriesByRegion`), the `region_set`-only ranking sort (explicitly gated on
`result.shape === 'region_set'`, so it never runs here), the `multiRegion =
series.length > 1` flag that already drives both `nullNote`'s region-naming
and the `trendHeadline` suppression, and the bar-arity/duplicate-period/
dims-fingerprint guards were all already generic enough to cover this shape
correctly — confirmed by test, not by inspection alone (see
`tests/chart/region-series.test.ts`).

**New test file `tests/chart/region-series.test.ts`** (6 tests, hand-built
`ValidatedResult`s via `tests/chart/helpers.ts`'s `makeCell`/`makeResult` —
no hermetic DB needed, since `buildChartSpec` reads only `cells`/`shape`/
`derivations`; Task 2's own `tests/query/region-series-run.test.ts` already
proves the DB-backed wiring that produces a *real* `region_series` result).
Covers: kind/series-per-region/order (the row-14 bug, proven by asserting a
non-null spec where today's code returns `null`); every point's `resultId`
traceable to its cell; a non-contiguous explicit period enumeration across
two regions still charts as `null`; a partial region's null cell keeps its
`nullNotes` line naming region + period + verbatim reason; `trendHeadline`
absent on a multi-region chart even with a single-region `direction` record
present; three regions charting three ordered, unsorted series.

**Proof panel (`web/lib/answer-proof.ts`):** the one gap the spec named.
`derivationStep`'s `direction` case took no region-aware information, so N
regions produced N textually identical "Richting van de reeks: …" rows.
Fixed by:
- A new `multiRegion` boolean, computed once in `buildSteps` from
  `result.cells` (`new Set(result.cells.map(c => c.regionCode)).size > 1`) —
  deliberately NOT read from `result.shape` or `result.regionSeries` (both
  absent on rows stored before this feature and on any hand-built result),
  so the region-naming degrades the same honest way for every input shape,
  including a plain `series` result that happens to carry cells from more
  than one region (structurally shouldn't happen, but the function stays
  correct either way — belt, not a new assumption).
- `derivationStep` takes `multiRegion` as a third parameter, used only in the
  `'direction'` case: `` ` voor ${first.regionLabel}` `` is appended to the
  Dutch sentence when `multiRegion` is true and the record's own bound cell
  carries a non-null `regionLabel` (`checkSingleRegion` in
  `src/query/derivations.ts` already guarantees a `direction` record's
  source cells share one region, so `first.regionLabel` unambiguously names
  the whole record). Every other derivation kind (`difference`, `max`,
  `unit_expansion`) is unaffected — none of them can occur on a
  `region_series` result today (see the spec's honesty-rule section: no
  cross-region derivation is ever registered), and their own text already
  names cells directly.
- `web/test/fake-answer.ts`'s `fakeAnswerResponse` `shape` union gained
  `'region_series'` (minimal widening — `'region_set'` was left out, unused
  by this task).

**Pinned in `web/lib/answer-proof.test.ts`** (new test `(4b)`, 21/21 passing
in the file): a hand-built two-region `region_series` result (Amsterdam and
Rotterdam, one real-shaped `direction` derivation each) renders two DISTINCT
"Richting van de reeks voor \<region\>: …" steps; a regression assertion in
the same test proves an ordinary single-region `series` result's step text
is BYTE-IDENTICAL to before this change (no `" voor …"` segment ever
appears when only one region is present) — the existing test `(4)` above it
already pins the exact same single-region sentence and was left untouched.

**Pinned in `web/components/chart.test.tsx`** (new describe block "ChartView
— region_series (ADR 055 task 3)", 4 tests, appended just before the
existing "Task 3 (line/bar/table form switch) fixtures" comment so as not to
disturb line-number-sensitive neighbors): a 3-region, 3-year line spec
renders three `.recharts-line-curve` paths, all three legend toggle buttons
start shown, hiding one drops only its own points (`data-result-id`) and
shows the "1 van 3 reeksen verborgen" disclosure, and the highlight control
(`Markeer <region>`) dims exactly the other two; the small-multiples toggle
is offered and switches to 3 panels (`[data-panel-for]`) — the row-14 bug,
proven positively rather than just asserted absent; the whole-card digit
scan (`scanForUnboundDigits`/`harvestSpecStrings`, both pre-existing local
helpers in the file) is clean; a 6-series spec (`REGION_SERIES_MAX_REGIONS`)
keeps 6 distinct `DEFAULT_PALETTE` colours in order — confirming
`isComparisonShaped` (which requires every series to have exactly one
point) correctly returns `false` for a genuine multi-point-per-series
region_series spec, so the comparison-shaped single-palette-colour rule
(session 110 UX-audit row 11) never fires here. No change was needed in
`web/components/chart.tsx`, `chart-view-state.ts` or `chart-presentation.ts`
to make any of this true — verified by test, matching the spec's own claim
that "web changes actually needed: exactly one, and it is not the chart."

**Verification run (this task only):**
- `npx vitest run tests/chart/region-series.test.ts --maxWorkers=1` → 6
  passed, 0 failed.
- `npx vitest run tests/chart --maxWorkers=1` → 270 passed, 0 failed (17
  files) — confirms nothing else under `src/chart/` moved.
- `cd web && npx vitest run lib/answer-proof.test.ts --maxWorkers=1` → 21
  passed, 0 failed.
- `cd web && npx vitest run components/chart.test.tsx --maxWorkers=1` → 299
  passed, 0 failed.
- `npm run typecheck` (root) → clean, no errors.
- `cd web && npm run typecheck` → clean, no errors.
- `npm run audit:verify` was NOT run — this task never touches
  `src/answer/audit/` (Task 6 owns that), and the dispatch brief scoped this
  worktree to the targeted commands above; a later session should still run
  it once before treating the whole plan as done, per Task 5's own note.

## As-built notes (task 4)

Built session 110 in worktree `s110-mrs4` (branch `s110/mrs4`), on top of the
merged tasks 1–2 and 5. Two commits: the answer layer + its tests, then the
re-pointing of the three suites tasks 1–2 turned red.

**What the body actually reads** (measured against the real hermetic ingest,
not sketched):

> Bevolking op 1 januari per regio: Amsterdam ging van 872.757 in 2020 naar
> 931.298 in 2024 (gestegen); Rotterdam ging van 651.157 in 2020 naar 670.610
> in 2024 (gestegen).

with one region withheld in 2022:

> Bevolking op 1 januari per regio: Amsterdam ging van 872.757 in 2020 naar
> 931.298 in 2024 (gestegen).
> *Voor Rotterdam ontbreekt een cijfer in 1 van de 5 gevraagde jaren; daarom
> noemt dit antwoord geen ontwikkeling voor die regio.*

and, for a region with no row at some requested period:

> *Over GM0344 zegt dit antwoord niets: in onze database ontbreken cijfers voor
> een of meer van de gevraagde jaren.*

1. **Deviation from the spec's sketch: the header carries no period range.**
   The spec sketched `"… per regio, van 2020 tot en met 2024: …"`; as built the
   header is `"${subject} per regio: …"`, mirroring `renderSeries`' proven
   `"… per periode:"` exactly. Every period is still stated — inside each
   region's own clause (`van X in 2020 naar Y in 2024`), which is the
   structure `renderDifference` has always used and the validator has always
   accepted. A bare year after `van` in a header is a numeric token with a
   *different* grounding path, and this floor renderer is not the place to
   take that risk for a fragment the clauses already carry.
2. **A third direction word-form table was needed.** `renderRegionSeries` uses
   the PARTICIPLE (`gestegen`/`gedaald`/`gelijk gebleven`), beside
   `TREND_VERB_BY_DIRECTION` (finite verb, chart headline) and `prompt.ts`'s
   noun form. `'gelijk gebleven'` is deliberately the exact phrase
   `validate.ts`'s `FLAT_WORDS` recognises — the template's own words are
   judged by the same validator every other body is.
3. **MS1 had a real hole that task 5's mechanism did not close, and task 4
   closed it in `validate.ts`.** `resolveTrendBacking` gated its "the clause
   must name exactly one region" rule on *the CANDIDATES spanning more than one
   region*. A `region_series` in which only ONE region is complete carries only
   ONE candidate — so a hand-written clause claiming a trend for the PARTIAL
   region (the one deliberately given no record) silently borrowed the complete
   region's backing and PASSED. The gate is now the RESULT's own distinct
   region count (`multiRegionResult`, computed once in `checkDirectionWords`
   and threaded into the three `resolveTrendBacking` call sites). Single-region
   results — including B13's two-candidate shape, which task 5's note warns
   about — take the unchanged path. Pinned by the first MS1 test.
4. **The MS1 block lives in `tests/answer/region-series-answer.test.ts`, not in
   `tests/invariants/invariants.test.ts`.** The plan's Task 4 named the
   invariants file (beside R5/R9/RS1); the dispatch brief scoped this task's
   test runs to `tests/answer` + `tests/audit/region-set-r8.test.ts`. The four
   pins the plan asks for are all present, verbatim in intent — a trend word
   about a partial region, a superlative, a cross-region comparative, and the
   `deriveDirection`/`deriveFirstLast` multi-region-array regression pin — just
   in the answer suite beside the rendering they judge. A later task may lift
   them into the invariants file; nothing about them depends on where they sit.
5. **The chart half is NOT asserted here.** The plan's Task 4 test list says a
   partial region's values are "absent from the body but present in the chart
   spec"; Task 3 (the chart) is a parallel, unmerged branch, so
   `buildChartSpec` still returns `null` for this shape in this worktree. The
   test asserts the honest half available here: absent from the body, present
   in `result.cells` (R11). Task 3 owns the chart-side assertion.
6. **The refusal wording changed, because the old one became false.** It said
   *"Ik kan meerdere regio's over meerdere periodes nog niet in één antwoord
   combineren"* — which this feature disproves. It now states what IS possible
   and what is still outside it (a whole GROUP of regions, or more regions than
   one answer can carry), as a disjunction: exactly one of the two holds for
   every ask that reaches the builder, and this template layer cannot tell
   which without the resolver's internal detail (a refusal carries no digits,
   #37). Sub-reason, offer chip and the no-chip-for-a-class rule are unchanged.
7. **A stale comment in `derivations.ts` was corrected** (`checkSingleRegion`
   claimed no caller can ever pass a multi-region array "because resolve.ts
   refuses that shape"). `run.ts` now calls these functions per-region *because*
   of this guard — that is the whole of MS1's mechanism.

**For Task 6 (audit / R8), the three things it must know:**

- **The new envelope key is `ComposedAnswer.regionSeriesLine`**, present-only
  (`?? null`): serialized ONLY when `result.regionSeries` exists AND
  `complete === false`. A COMPLETE multi-region series carries **no key at
  all** — `buildRegionSeriesLine` returns `null` for it, exactly like a
  non-region-set answer's `regionSetLine`. The manifest row should be
  `rederived`, and the shape-check argument is the coverage record it is
  derived from (`ValidatedResult.regionSeries`), the same pairing the
  `regionSet` entry uses.
- **The line order is: body, '', assumptionLine, regionSetLine,
  regionSeriesLine, definitionLine, alternatesLine, markingLine,
  attributionLine.** `regionSeriesLine` sits immediately after `regionSetLine`
  in `compose.ts`'s `text` assembly and in the returned object. The two can
  never co-occur (a region CLASS over a range is still refused), but the order
  is fixed here and must be mirrored in `reconstruct.ts`'s re-assembly and in
  `tests/audit/region-set-r8.test.ts`'s own `reassemble()` helper — which does
  NOT yet include the key.
- **The body re-derives byte-identically, and `answer.source` must be
  `'template'`.** `region_series` is template-only BY SHAPE in both
  `composeAnswer` (the guard the test pins) and `respond.ts` (the explicit
  wiring), so the shape-scoped re-derivation block at `reconstruct.ts:320-331`
  extends to it unchanged. Tampering with the coverage record must stop the
  LINE re-deriving: a `complete` flip flips the line between `null` and a
  sentence; moving a region between `partial`/`excluded` changes both which
  name form is used (verbatim label vs bare code) and which sentence it lands
  in; an invented `excluded` entry adds a name to the second sentence. The
  line's digits (`N van de M gevraagde jaren`) come from the SERVED CELLS, not
  from the coverage record, so a tampered `partial` roster and the stored cells
  disagree loudly.

**Verification run (this task only):**
- `npx vitest run tests/answer/region-series-answer.test.ts --maxWorkers=1` →
  13 passed, 0 failed (new file).
- `npx vitest run tests/answer/query-refusal-chips.test.ts --maxWorkers=1` →
  9 passed (was 4 failed / 5 passed).
- `npx vitest run tests/answer/region-set-answer.test.ts --maxWorkers=1` →
  12 passed (was 1 failed / 11 passed).
- `npx vitest run tests/audit/region-set-r8.test.ts --maxWorkers=1` → 18
  passed (was a failing file: 13 passed / 5 skipped after a throwing
  `beforeAll`).
- `npx vitest run tests/answer --maxWorkers=1` → **841 passed, 0 failed**
  (828 before this task + the 13 new).
- `npx vitest run tests/audit/slot-phrasing-r8.test.ts
  tests/benchmark/scorer-teeth.test.ts tests/sources/registry.test.ts
  tests/invariants/invariants.test.ts --maxWorkers=1` → 75 passed — the other
  four suites that exercise `validateAnswerBody`/`composeAnswer`, run because
  note 3 changed the validator.
- `npm run typecheck` (root) → clean.
- `npm run audit:verify` was NOT run (needs the live DB, out of scope for this
  hermetic worktree task) — Task 6's own done-definition names it.

**⚠ A GAP THIS PLAN HAS NO TASK FOR — found in task 4, deliberately not fixed
here.** `regionSetLine` has a whole surface beyond the composer, and the new
sibling key is absent from every one of them, so **today the coverage sentence
would be assembled and stored but never SHOWN**: `web/lib/chat-message.ts`
(`AnswerView`), `web/components/chat.tsx` (`:903` maps it onto the view,
`:1144` renders it), `web/lib/copy-answer.ts` (`:31`),
`web/lib/replay-assemble.ts` (`:127`), `src/threads/replay.ts` (`:35`, `:97`)
and `web/test/fake-answer.ts`. The rendered `answer.text` does contain the line
(compose.ts assembles it), but the chat UI renders the PARTS, not `text` — so a
partial/excluded region would be silently missing from the answer with no
disclosure on screen, which is the one outcome the design's honesty rule exists
to prevent. Task 4's brief scoped it to the backend answer layer and its
`tests/answer` runs, and `web/` has its own co-located suites, so this is left
for whoever owns the web slice (Task 3's file list is the nearest) — but it must
not ship without it.

**Gap closed (session 110, branch `s110/mrsline`):** `regionSeriesLine` is now
carried through every surface named above (`web/lib/chat-message.ts`'s
`AnswerView`, `web/components/chat.tsx`'s live-response mapping and its muted
render right after `regionSetLine`, `web/lib/copy-answer.ts`,
`web/lib/replay-assemble.ts`, `src/threads/replay.ts`'s `ReplayAnswerView` +
`extractAnswerView`, and `web/test/fake-answer.ts`), mirroring the same-day
`regionSetLine` parity fix exactly; `src/billing/history.ts`'s narrower
`answerParts` (dashboard definition expander) was left out again, same
reasoning as that fix.
