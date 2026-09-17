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
