# Verified-whole pie / stacked / 100%-stacked — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement
> this plan task-by-task, ONE implementer at a time (no parallel dispatch — Task 4 touches
> `web/components/chart.tsx`, the same large, fragile file past sessions have found real bugs in from
> concurrent edits; keeping the whole plan sequential avoids re-litigating that risk for a small gain).
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a CBS/Eurostat chart honestly show pie, stacked, and 100%-stacked forms when its regions are
a complete, CBS-known roster (all provinces, all landsdelen, all gemeenten of one province) — verified on
demand, server-side, that the visible parts really do sum to the real published total. No chart ever
draws an unverified "whole." Donut is a presentation variant of pie, not a fourth form. Scatter and
category-breakdown (non-region) totals stay out of scope — see the design's own scope note.

**Architecture:** A new pure verification function checks that a set of already-fetched region cells sums
(within a named tolerance) to an independently-fetched parent/total cell — the same national-total or
province-total row CBS already publishes and this app already stores whenever it stores the children.
`ChartSpec` gains one new optional field recording which `RegionScope` produced a chart's regions (already
available inside `buildChartSpec`'s own input, just not read today) — this lets the panel decide
structurally, with no query round-trip, whether pie/stacked tabs are even worth offering; the actual
numeric verification runs on demand, server-side, only when the reader picks one of the three forms —
the same "Option A" pattern phase 4's difference arrow and average line already established. Pie uses
Recharts' native `<Pie>`; stacked/100%-stacked use Recharts' native `<Bar stackId>` — both are built-in
Recharts chart types, unlike phase 5's dumbbell (which needed a custom overlay) — so this plan's rendering
tasks lean on library features already proven in this app rather than new geometry code.

**Tech Stack:** Next.js/React/TypeScript, Recharts 3.10 (native `Pie`/stacked `Bar` support, not used
elsewhere in this app yet — new imports), Vitest + Testing Library (jsdom), Playwright (hermetic e2e).

**Spec:** [docs/superpowers/specs/2026-09-17-chart-copilot-design.md](../specs/2026-09-17-chart-copilot-design.md)
§11 ("Phase 5b — the 'verified whole'"). Read that section first — it has the full honesty reasoning, the
tolerance policy, and the owner's scope decision (region hierarchies only). [ADR 039](../decisions/039-chart-presentation-panel.md)
still blanket-refuses scatter; this plan does not touch scatter at all.

## Global Constraints

- **No number is ever drawn that isn't either a real fetched cell's own `value`/`formattedValue`, or pure
  arithmetic over already-verified real numbers (the 100%-stacked percentage).** The verification step
  itself never *computes* the parts or the whole — it only checks a claim about numbers the app already
  fetched and trusts. If a task finds itself needing to invent or estimate a number to make something
  render, stop and flag it.
- **CBS/Eurostat card only** (`web/components/chart.tsx`) — `web/components/user-chart.tsx` (own-data) has
  no region-hierarchy concept at all (its regions, if any, come from the reader's own uploaded file, never
  a CBS-verified roster), so there is nothing to wire there. Do not touch it.
- **`ChartForm` is a widely-narrowed shared type — grep the WHOLE repo, not just the files you edit,
  before calling any task in this plan done.** Session 116 (phase 5) hit this exact trap twice. Known
  narrowing sites, confirmed current as of this plan's writing (re-verify — phase 5 added three members
  since the list below was last true, so file:line numbers below may have shifted):
  - `web/lib/chart-view-state.ts` — the canonical `ChartForm` union and `isChartForm`.
  - `web/lib/chart-commands.ts` — the `setForm` command's zod schema, a hand-written `z.enum([...])`.
  - `src/chart/copilot/types.ts` — `CBS_COPILOT_FORMS` and `CbsCopilotCapabilities['forms']`.
  - `src/chart/copilot/schema.ts` — `cbsViewCommandSchema`'s own `z.enum([...])` for `setForm`.
  - `src/chart/copilot/prompt.ts` — the system prompt's own hand-listed form example (line ~27 as of
    phase 5) — **phase 5 found this the hard way, as a same-task fix discovered late; this plan puts it
    in Task 5's own step list from the start, not as an afterthought.**
  - `web/components/chart.tsx` — `FORM_ORDER`, `formTabRef`, the tablist JSX, `effectiveKind`.
  - `web/lib/chart-fit.ts` — `allowedForms`.
  - Any test file with the form list written out literally.
  Run the FULL typecheck (`npm run typecheck` at the repo root AND `cd web && npm run typecheck`) and
  `cd web && npm run build` before any task that touches the type is called done.
- **`ChartSpec` is stored forever (R8) — the new provenance field follows ADR 014's documented
  "optional-v1-field rule"** (`docs/decisions/014-chart-spec-v1-and-renderer.md`, confirmed current):
  emit the new field only when applicable (so untouched/old specs stay byte-identical), add it via
  `.optional()` in the zod schema (never remove/rename an existing field, never bump `schemaVersion`), and
  — the gotcha ADR 014 itself documents — because this field WILL be emitted for real, ongoing region-set
  answers (not just a rare edge case), `src/answer/audit/reconstruct.ts` and its
  `known-divergences.ts` companion need the matching tolerance entry, or every future region-set answer's
  audit-reconstruction check will falsely flag a divergence. Task 2 owns this.
- **One implementer at a time, no parallel dispatch**, per this plan's own header note.
- **i18n:** every new user-facing string (tab labels, disabled-reason text, refusal copy) needs both `nl`
  and `en` entries in `web/lib/i18n/messages.ts`.
- **Follow existing conventions exactly.** The guard-predicate pattern (`web/lib/chart-view-state.ts`),
  the on-demand-derivation server-action pattern (`web/app/chart-derivation-actions.ts`,
  `requestChartDerivation`), and the registered-pure-function pattern (`src/query/derivations.ts`) are all
  proven, reviewed code in this exact codebase — reuse their shape, don't invent a second mechanism.

## Task 1: The verification function — does a roster's parts sum to its real total?

**Files:**
- Create: `src/query/whole-verification.ts`
- Test: `tests/query/whole-verification.test.ts` (match this repo's existing root-level test-path
  convention for `src/query/` — check `tests/query/derivations.test.ts` or similar exists first and
  mirror its structure/fixtures exactly)

**Interfaces:**
- Consumes: `RegionScope` (`src/query/types.ts` — **read the real type definition before writing code
  that narrows over it; this plan's own investigation only confirmed three variants —
  `'all_provincies'`, `'all_landsdelen'`, `'gemeenten_in_provincie'` (the last carrying a `parent: string`
  field) — from reading `src/query/region-set.ts`'s own `switch` statement, not the type declaration
  itself. If `RegionScope` has more variants, this task's own switch must be exhaustive over the REAL
  type, and any variant with no defined "parent total" concept is out of this phase's scope — refuse it
  structurally, do not guess a parent for it.**), a cell shape compatible with `ResultCell`
  (`src/query/types.ts`) carrying at minimum `value: number | null`, `decimals: number`,
  `valueAttribute: string`, `periodCode: string`.
- Produces: `parentCellRef(scope: RegionScope): { kind: 'group'; group: string } | { kind: 'code'; code: string }`
  — for `'all_provincies'`/`'all_landsdelen'`, the parent is the **national total group**, `'NL'` (same
  constant convention as `PROVINCE_GROUP`/`LANDSDEEL_GROUP` in `src/query/region-set.ts`) — return
  `{ kind: 'group', group: 'NL' }`. For `'gemeenten_in_provincie'`, the parent is the named province's OWN
  cell — return `{ kind: 'code', code: scope.parent }`. `wholeSumTolerance(wholeValue: number, wholeDecimals: number): number`
  and `verifyPartsSumToWhole(parts: readonly PartCell[], whole: PartCell): VerifyOutcome` — used by Task 4's
  server action.

- [ ] **Step 1: Read the real `RegionScope` type**

Read `src/query/types.ts`'s `RegionScope` definition in full (search for `export type RegionScope` or
`interface RegionScope`). Confirm the three variants this plan assumes, and note any others. If there are
others, add them to this task's own switch as explicitly "no parent-total concept, never offered" cases —
do not silently ignore an unhandled variant (a TypeScript exhaustiveness check, not a runtime `default`
branch, should catch it).

- [ ] **Step 2: `parentCellRef`**

```ts
// The one region-scope roster this app already knows how to resolve
// (src/query/region-set.ts) that also has a real, independently-published
// CBS "whole" cell it can be checked against. 'all_provincies' and
// 'all_landsdelen' both partition the country, so their whole is the
// national total (the 'NL' dimension_group — same convention
// PROVINCE_GROUP/LANDSDEEL_GROUP already use in region-set.ts);
// 'gemeenten_in_provincie' partitions ONE province, so its whole is that
// province's own cell, not the national one.
export type ParentCellRef = { kind: 'group'; group: string } | { kind: 'code'; code: string };

const NATIONAL_TOTAL_GROUP = 'NL';

export function parentCellRef(scope: RegionScope): ParentCellRef | null {
  switch (scope.kind) {
    case 'all_provincies':
    case 'all_landsdelen':
      return { kind: 'group', group: NATIONAL_TOTAL_GROUP };
    case 'gemeenten_in_provincie':
      return { kind: 'code', code: scope.parent };
    // Add an explicit case per any other real RegionScope variant found in Step 1,
    // each returning `null` (no verified-whole concept for that scope) unless a
    // real parent-total relationship is found for it too.
  }
}
```

(Adjust field/variant names to match the REAL `RegionScope` type from Step 1 — the sketch above encodes
this plan's own best understanding from reading `region-set.ts`'s switch statement, not the type
declaration.)

- [ ] **Step 3: Tolerance + the verification check**

```ts
/** CBS rounds parts and totals independently, so a genuinely correct roster
 * can still be off by a small amount from its published total. Tolerance is
 * the LARGER of half a unit at the total's own published precision, or 0.5%
 * of the total's own value — named and adjustable in one place per the
 * design's own "not empirically tuned yet" note (spec §11). */
export function wholeSumTolerance(wholeValue: number, wholeDecimals: number): number {
  const halfUnitAtPrecision = 0.5 / 10 ** wholeDecimals;
  const halfPercent = Math.abs(wholeValue) * 0.005;
  return Math.max(halfUnitAtPrecision, halfPercent);
}

export interface PartCell {
  value: number | null;
  decimals: number;
  valueAttribute: string;
}

export type VerifyOutcome =
  | { verified: true }
  | { verified: false; reason: 'withheld_member' | 'sum_mismatch' | 'missing_whole' };

/** `whole` may be `null` when the parent cell could not be fetched at all
 * (e.g. CBS hasn't published that period's national total yet) — refuses
 * with 'missing_whole', never treats "no total" as "matches anyway". Any
 * part with `value === null` refuses with 'withheld_member' — CBS marking a
 * cell withheld/not-yet-published means "unknown", never "contributes
 * zero" (the same rule phase 5's heatmap guard already established for a
 * different case, session 116). */
export function verifyPartsSumToWhole(parts: readonly PartCell[], whole: PartCell | null): VerifyOutcome {
  if (whole === null || whole.value === null) return { verified: false, reason: 'missing_whole' };
  if (parts.some((p) => p.value === null)) return { verified: false, reason: 'withheld_member' };
  const sum = parts.reduce((total, p) => total + (p.value as number), 0);
  const tolerance = wholeSumTolerance(whole.value, whole.decimals);
  return Math.abs(sum - whole.value) <= tolerance
    ? { verified: true }
    : { verified: false, reason: 'sum_mismatch' };
}
```

- [ ] **Step 4: Tests**

`parentCellRef`: each real `RegionScope` variant from Step 1 maps to the expected `ParentCellRef` (or
`null` for an unhandled one). `wholeSumTolerance`: a few concrete (value, decimals) → tolerance pairs,
hand-computed. `verifyPartsSumToWhole`: a genuine match (parts sum within tolerance); a genuine mismatch
(sum clearly off, e.g. one part doubled); a withheld part (`value: null`) refuses with
`'withheld_member'` even though the OTHER parts would have summed correctly; a `null` whole refuses with
`'missing_whole'`; a boundary case exactly at the tolerance edge (verify the `<=` behavior deliberately,
not accidentally).

- [ ] **Step 5: Full verification and commit**

`npm run typecheck` (root), the new test file. Commit:
`feat(query): parentCellRef + verifyPartsSumToWhole — the verified-whole check (phase 5b task 1)`.

## Task 2: `ChartSpec` gains a `regionScope` provenance field

**Depends on:** nothing from Task 1 (independent files) — sequenced after it only per this plan's
"one implementer at a time" rule, not a real dependency.

**Files:**
- Modify: `src/chart/schema.ts` (the zod schema — add the new optional field)
- Modify: `src/chart/types.ts` (the `ChartSpec` TypeScript type, if separately declared from the zod
  inference — confirm the real relationship between these two files before editing)
- Modify: `src/chart/build.ts` (`buildChartSpec` — read `result.regionSet?.scope` and set the new field)
- Modify: `src/answer/audit/known-divergences.ts` (or wherever `reconstruct.ts`'s tolerance list lives —
  confirmed by this plan's own investigation to be the real pattern; read `src/answer/audit/reconstruct.ts`
  first to see exactly how an existing optional field like `annotations`/`trendHeadline` is already
  handled there, and mirror it)
- Test: wherever `buildChartSpec` and `reconstruct.ts` are already tested — extend, don't create parallel
  files

**Interfaces:**
- Consumes: `ValidatedResult.regionSet?.scope` (`RegionSetCoverage.scope: RegionScope`,
  `src/query/types.ts` — already present on every result built from a region-set answer; confirmed by
  this plan's own investigation that `buildChartSpec` receives the whole `ValidatedResult` and simply
  doesn't read this field today).
- Produces: `ChartSpec.regionScope: RegionScope | null` (present — explicitly `null`, not omitted, for
  every spec; a region-set-built spec gets the real scope, every other spec gets `null`) — Task 3's guard
  predicates read this field.

- [ ] **Step 1: Confirm the real shapes before writing code**

Read `src/chart/build.ts:68`'s `buildChartSpec` function in full, `src/chart/schema.ts`'s
`chartSpecSchema`, `src/chart/types.ts`'s `ChartSpec` type, and `src/query/types.ts`'s
`RegionSetCoverage`/`RegionScope`. Confirm: (a) `buildChartSpec` really does receive the whole
`ValidatedResult` as its one parameter (not something already narrower); (b) the exact field path to read
the scope from (this plan's own investigation found `result.regionSet?.scope`, but confirm the literal
field/property names against the real type, not this plan's paraphrase).

- [ ] **Step 2: Add `regionScope` to the schema and type**

Add to `chartSpecSchema` (`src/chart/schema.ts`), matching this file's own `z.strictObject` /
`.optional()` / `.nullable()` conventions used by the existing `annotations`/`trendHeadline` optional
fields (mirror whichever of the two is the closer precedent — `annotations` is itself `optional()` and an
array; `trendHeadline` is `optional()` and a string — this new field is present-but-nullable on every
spec per this task's own Interfaces note above, so read both before picking the exact zod shape). You will
need a `regionScopeSchema` sub-schema mirroring `RegionScope`'s real shape from Task 1/Step 1's findings —
keep it a faithful, minimal zod mirror of the TypeScript type, not a reinvention.

- [ ] **Step 3: Wire `buildChartSpec`**

In `src/chart/build.ts`, set the new field from `result.regionSet?.scope ?? null` (adjust to the real
field path confirmed in Step 1) on every returned `ChartSpec`. Every EXISTING call site/test that builds
a `ChartSpec` from a non-region-set result must still produce `regionScope: null` — run the full existing
`src/chart/build.ts` test suite and confirm nothing broke before writing new tests.

- [ ] **Step 4: The `reconstruct.ts` tolerance entry**

Per this plan's Global Constraints note: once `regionScope` is actually emitted for real region-set
answers (not a hypothetical edge case), the audit-reconstruction check
(`src/answer/audit/reconstruct.ts`) will see it on freshly-rebuilt specs but not on any already-stored
historical spec (which predates this field) — read how the EXISTING `annotations`/`trendHeadline` fields
are already tolerated there (`known-divergences.ts` or wherever `reconstruct.ts`'s own comments point) and
add the matching entry for `regionScope`. Add a test that reconstructing a region-set answer's audit row
does NOT falsely flag a divergence for this new field.

- [ ] **Step 5: Tests**

A region-set-built `ChartSpec` (any of the three roster kinds) has the real `RegionScope` in
`regionScope`. A non-region-set-built spec (a plain single-region or hand-picked-multi-region answer) has
`regionScope: null`. An already-stored spec fixture (predating this field, missing it entirely) still
parses via `chartSpecSchema` unchanged — confirms the optional-field rule genuinely holds.

- [ ] **Step 6: Full verification and commit**

`npm run typecheck` (root), the full `src/chart` + `src/answer/audit` test suites (find their real npm
script names — likely part of the root `npm run test` suite; run scoped first, then the note in this
plan's own Task 5 still asks for the full suite before merge). Commit:
`feat(chart): ChartSpec gains a regionScope provenance field (phase 5b task 2)`.

## Task 3: Widen `ChartForm`, add the three guards, a donut presentation key, wire the scorer

**Depends on:** Task 2 (`ChartSpec.regionScope`).

**Files:**
- Modify: `web/lib/chart-view-state.ts` (`ChartForm`, `isChartForm`, three new guards, `fallbackForm`)
- Modify: `web/lib/chart-fit.ts` (`allowedForms`)
- Modify: `web/lib/chart-presentation.ts` (a new `pieHole` — or equivalently-named — presentation key for
  the donut look; read this file's existing presentation-key pattern, e.g. how `lineWidth`/`markers` are
  declared, and mirror it exactly)
- Modify: `web/lib/chart-commands.ts` (the `setForm` zod enum), `src/chart/copilot/types.ts`
  (`CBS_COPILOT_FORMS`), `src/chart/copilot/schema.ts` (the `setForm` zod enum)
- Modify: `web/lib/i18n/messages.ts` (tab labels, disabled reasons, the donut presentation control's
  label — nl + en)
- Test: `web/lib/chart-view-state.test.ts`, `web/lib/chart-fit.test.ts`

**Interfaces:**
- Consumes: `ChartSpec.regionScope` (Task 2), `parentCellRef` (Task 1 — NOT called here; this task's
  guards are purely structural, "does this spec have a non-null regionScope + the right period/series
  shape," never a query — the actual sum-check is Task 4's on-demand server action).
- Produces: `ChartForm` widened to include `'pie' | 'stacked' | 'stacked100'`. `pieFormAllowed(spec,
  seriesCount)`, `stackedFormAllowed(spec, seriesCount)`, `stacked100FormAllowed(spec, seriesCount)`
  exported from `chart-view-state.ts`. `allowedForms` (`chart-fit.ts`) extended with all three, in that
  fixed order, appended after `heatmap` (dumbbell, slope, heatmap, pie, stacked, stacked100).

- [ ] **Step 1: The three guards**

```ts
/**
 * Phase 5b (verified-whole, session 117): a pie/stacked/100%-stacked shape
 * is only ever OFFERED when the chart's own regions are a complete,
 * CBS-known roster — never guessed from the code list (a reader could
 * hand-pick exactly the province codes without CBS ever vouching they're
 * complete for THIS table/period). This is a purely structural check: it
 * reads `spec.regionScope` (set by buildChartSpec only for a genuine
 * region-set answer, phase 5b task 2) and does NOT verify the actual sum —
 * that numeric check runs on demand, server-side, only when the reader
 * picks one of these three forms (spec §11's "Option A" pattern).
 */
function hasVerifiableRegionScope(spec: Pick<ChartSpec, 'regionScope'>): boolean {
  return spec.regionScope != null;
}

/** Pie can only show ONE moment — every series must carry exactly one
 * point, the same "comparison-shaped" condition `isComparisonShaped`
 * already checks for a different form (session 110). */
export function pieFormAllowed(spec: Pick<ChartSpec, 'regionScope' | 'series'>, seriesCount: number): boolean {
  return hasVerifiableRegionScope(spec) && seriesCount >= 2 && spec.series.every((s) => s.points.length === 1);
}

/** Stacked/100%-stacked can show several moments (one stack per period) —
 * only the roster-completeness structural check applies here, not a
 * point-count restriction. */
export function stackedFormAllowed(spec: Pick<ChartSpec, 'regionScope' | 'series'>, seriesCount: number): boolean {
  return hasVerifiableRegionScope(spec) && seriesCount >= 2;
}

export function stacked100FormAllowed(spec: Pick<ChartSpec, 'regionScope' | 'series'>, seriesCount: number): boolean {
  return stackedFormAllowed(spec, seriesCount);
}
```

(Type the `spec` parameter on `SeriesShape`-or-equivalent if `Pick<ChartSpec, 'series'>` does not compile
against the same two real callers phase 5's own Task 1 found — `cbsCapabilities` and any `PlottableSpec`
caller. Check this BEFORE writing the final signature; phase 5 hit this exact issue and had to introduce
`SeriesShape` — reuse that existing exported type from `web/lib/chart-view-state.ts` if it's still the
right fit, rather than re-deriving the same fix.)

- [ ] **Step 2: Widen `ChartForm`, `isChartForm`, `fallbackForm`**

Add `'pie' | 'stacked' | 'stacked100'` to the `ChartForm` union and `isChartForm`. Extend `fallbackForm`
with three new cases: `pie`/`stacked`/`stacked100` each fall back to `'table'` when their own guard no
longer holds (matching `heatmap`'s existing fallback-to-table convention from phase 5, since these three
are also "a different way of looking at the same rows," not line/bar-like).

- [ ] **Step 3: Extend the scorer**

In `web/lib/chart-fit.ts`, add the three guards to `allowedForms`, appended in order after `heatmap`:
`dumbbell, slope, heatmap, pie, stacked, stacked100`.

- [ ] **Step 4: The donut presentation key**

Read `web/lib/chart-presentation.ts`'s existing key pattern (e.g. how `markers`/`lineWidth` are declared
— name, allowed values, which forms it applies to via `resolvePresentation().applicable`). Add a new key
(e.g. `pieHole: 'none' | 'donut'`) applicable ONLY when `form === 'pie'`. No new `ChartForm` member for
donut — this is the mechanism spec §11 calls for ("donut is styling, not a form").

- [ ] **Step 5: Widen the shared `setForm` schemas**

`web/lib/chart-commands.ts`'s zod enum, `src/chart/copilot/types.ts`'s `CBS_COPILOT_FORMS` +
`CbsCopilotCapabilities['forms']`, `src/chart/copilot/schema.ts`'s zod enum — all gain the three new
members. `validateCommand`'s own `setForm` case already routes through `fallbackForm` (confirmed by phase
5) — no hand-written parallel check needed.

- [ ] **Step 6: i18n**

`chart.form.pie` (nl `"Taartdiagram"`, en `"Pie chart"`), `chart.form.stacked` (nl `"Gestapeld"`, en
`"Stacked"`), `chart.form.stacked100` (nl `"100% gestapeld"`, en `"100% stacked"`), each with a matching
`*DisabledReason` key explaining the roster-completeness condition in one digit-free sentence, and a label
for the new donut presentation toggle.

- [ ] **Step 7: Tests**

Guards: a spec with a real `regionScope` (all three roster kinds from Task 1/2) and matching
comparison/multi-period shape is allowed; a spec with `regionScope: null` (any hand-picked or single-region
chart) is refused even if its region codes happen to numerically match a complete roster — **this is the
contract test from spec §11 that must exist somewhere; if it belongs more naturally in Task 5's contract
test, note that here and do not duplicate it.** `allowedForms` order test extended. `fallbackForm`'s three
new cases.

- [ ] **Step 8: Full verification and commit**

`npm run typecheck` (root + web), `cd web && npm run build`. Commit: `feat(chart): widen ChartForm with
pie/stacked/stacked100, the three guards, donut as a pie presentation key (phase 5b task 3)`.

## Task 4: On-demand verification server action + Recharts rendering

**Depends on:** Task 1 (`parentCellRef`/`verifyPartsSumToWhole`), Task 3 (the three guards, the widened
`ChartForm`, the donut presentation key).

**Files:**
- Create: `web/app/chart-whole-verification-actions.ts` (mirror `web/app/chart-derivation-actions.ts`'s
  own shape — server action file naming convention in this codebase)
- Modify: `web/components/chart.tsx` (tab wiring, render branches, trigger-verification-on-tab-select)
- Test: `web/components/chart.test.tsx`

**Interfaces:**
- Consumes: `parentCellRef`/`verifyPartsSumToWhole` (Task 1, via the `web/backend` symlink — confirm the
  real import path other `src/query/` consumers in `web/` already use, e.g. how
  `chart-derivation-actions.ts` imports `src/query/derivations.ts`, and mirror it exactly), `canUsePie`/
  `canUseStacked`/`canUseStacked100` (Task 3).
- Produces: a client-callable server action, `requestWholeVerification(spec: ChartSpec, periodCodes:
  string[]): Promise<WholeVerificationOutcome>` where `WholeVerificationOutcome` reports per-period
  verified/refused (matching spec §11's "checked independently per period" rule) — read
  `chart-derivation-actions.ts`'s own request/response shape and ownership/GDPR-redaction check (phase
  4's final review found and fixed a REAL missing-ownership-check bug in that exact file's sibling
  pattern — this new action reads the same class of client-supplied id, so it needs the same check from
  the start, not found late by a review) before writing this one.

- [ ] **Step 1: Read the precedent server action in full**

Read `web/app/chart-derivation-actions.ts` (`requestChartDerivation`) completely: its request/response
shape, how it loads the audit record, its ownership + GDPR-redaction check (`loadAuditRecord`,
`record.userId !== userId`, `isRedacted(record.response)` — session 115's own real-bug-fix pattern), and
how it re-derives cells from `specCellsByResultId` (`src/chart/spec-cells.ts`). This new action follows
the identical shape.

- [ ] **Step 2: `requestWholeVerification`**

For each requested `periodCode`: find the chart's own already-plotted parts for that period (via
`specCellsByResultId` or equivalent), call `parentCellRef(spec.regionScope)` (refuse the whole request if
`spec.regionScope` is null — the client should never call this without a real scope, but never trust
that), fetch the parent cell for that SAME table/measure/period (a real query — read
`src/query/region-set.ts`'s `codesInGroups` and how a single cell is fetched elsewhere in `src/query/` for
the exact query-building convention to reuse, rather than hand-rolling new SQL), then call
`verifyPartsSumToWhole`. Return a per-period outcome map. No audit row is written (matches phase 4's
difference/average precedent — a view command, not a new answer).

- [ ] **Step 3: Wire the client trigger**

In `chart.tsx`, when the reader selects `'pie'`/`'stacked'`/`'stacked100'` (mirroring how phase 4's
difference-arrow/average-line controls trigger `requestChartDerivation` on demand — read that call site
and mirror its loading/error-state handling), call `requestWholeVerification` for the period(s) the
current view shows. Render only the verified periods; for pie (single period only, per Task 3's guard),
an unverified result REFUSES the whole form with the reason from spec §11 ("kies een andere periode" class
of copy); for stacked/100%-stacked, omit only the unverified period's stack from the drawn bars, per
spec §11's own precise rule — do not silently draw an unverified stack.

- [ ] **Step 4: Pie rendering**

Add `Pie`, `PieChart`, `Cell` (Recharts' own per-slice colour prop) to the existing `from 'recharts'`
import block. New render branch, `activeForm === 'pie'`: one `<Pie>` per verified period (only one period
ever shown at once per Task 3's guard), `dataKey` the region's real `value`, `innerRadius` driven by the
`pieHole` presentation key (`0` for plain pie, a real percentage for donut), each slice labelled with its
own `formattedValue` (never Recharts' own percentage formatting) and `data-label-for="<resultId>"`,
following this file's existing custom-tooltip/custom-label conventions rather than Recharts' defaults (the
same "no invented numbers" discipline every other form already follows).

- [ ] **Step 5: Stacked / 100%-stacked rendering**

New render branch(es) for `'stacked'`/`'stacked100'`: a `<BarChart>` with one `<Bar stackId="whole">` per
region series (Recharts' own native stacking), one bar per verified period. For `stacked100`, transform
each period's values to percentages of that period's own verified total AFTER the on-demand check
succeeds (pure arithmetic over already-verified reals, per spec §11) — never before, never for an
unverified period. Value labels show the real underlying number (and, for `stacked100`, the computed
percentage) via `formattedValue`-based text, `data-label-for` on every segment.

- [ ] **Step 6: Tab buttons + i18n wiring**

Same pattern as phase 5's tab buttons (`ref`, `role="tab"`, `aria-selected`, `disabled`, `title`,
`aria-describedby`, the sr-only reason span) for all three new tabs, in `FORM_ORDER`'s fixed order (pie,
stacked, stacked100, after heatmap).

- [ ] **Step 7: Tests**

A region-set-built spec (real `regionScope`) with a verification stub/fixture confirming success: all
three tabs enabled, each renders real slices/bars with correct `data-label-for` bindings and
`formattedValue` text, digit-honesty scan passes. A verification-fails case: the form refuses with its
reason, falls back per Task 3's `fallbackForm`. A multi-period stacked chart with one period's
verification failing: that period's stack is omitted, the others render. A non-region-set spec: all three
tabs disabled regardless of what the region codes happen to be.

- [ ] **Step 8: Full verification and commit**

`npm run typecheck` (root + web), the full `web` test suite (solo), `cd web && npm run build` (the real
Turbopack build — if run from a worktree, confirm `node_modules` is a real install, not a symlink, per
phase 5's own documented gotcha). Commit: `feat(chart): pie/stacked/stacked100 rendering + on-demand
whole-verification server action (phase 5b task 4)`.

## Task 5: Chat-doorway wiring (including the prompt fix, from the start) + contract/property/e2e coverage

**Depends on:** Tasks 1-4 (needs the finished, mergeable state of everything).

**Files:**
- Modify: `src/chart/copilot/prompt.ts` (the system prompt's hand-listed form example + version bump —
  **done here as a planned step, not discovered late as phase 5's Task 1 had to**)
- Modify: `web/components/chart-commands-contract.test.tsx`
- Modify: `web/lib/chart-commands.test.ts`
- Modify: `web/e2e/chart-copilot.spec.ts`

**Interfaces:**
- Consumes: everything Tasks 1-4 produced.
- Produces: no new production code except the prompt.ts fix — this task is chat-vocabulary wiring +
  coverage.

- [ ] **Step 1: The CBS co-pilot prompt**

`src/chart/copilot/prompt.ts`: widen the `setForm` example's hand-listed forms to include `pie`,
`stacked`, `stacked100` (read the current line — phase 5 left it at 8 members after its own fix; this
task widens it to 11). Bump `CBS_COPILOT_PROMPT_VERSION` by 1 (this file's own established convention,
confirmed twice now — phase 5 bumped 1→2 for the identical reason). Check for and update any test that
pins the version number.

- [ ] **Step 2: Contract test — chat vocabulary ⊆ panel vocabulary, AND provenance-not-just-codes**

Extend whatever list already pins "every form the chat can offer must have a matching panel tab"
(`web/components/chart-commands-contract.test.tsx`) to include `pie`/`stacked`/`stacked100`. Add the
provenance-specific test spec §11 calls for (may already exist from Task 3/Step 7 — check before
duplicating): a spec whose region CODES numerically match a complete roster but whose `regionScope` is
`null` (built as a hand-picked or LLM-assembled selection, never through `resolveRegionSet`) must still
refuse all three forms — the guard checks provenance, not code-list equality.

- [ ] **Step 3: Property test**

Check `randomCommand()`'s `setForm` case (`web/lib/chart-commands.test.ts`) — phase 5 found this
hard-coded to a literal array not automatically covering new forms, and found that a naive "widen to
every form" breaks the property's own `validateCommand` invariant when the shared test context's spec
shape doesn't structurally qualify for the new forms (phase 5's own dumbbell/slope needed exactly two
periods; pie/stacked/stacked100 need a real `regionScope`, which the existing shared `ctx` almost
certainly does not have). Do NOT naively widen the literal to include the three new forms unless the
shared `ctx`'s spec is given a real `regionScope` first — check this before changing anything, and if the
shared context can't realistically carry one, add a separate targeted round-trip test on its own
region-set-shaped context instead, the same way phase 5's own Task 5 handled the identical problem.

- [ ] **Step 4: e2e — Playwright, hermetic**

In `web/e2e/chart-copilot.spec.ts`, add cases: a region-set-built chart (all provinces, or however this
repo's existing e2e fixtures already build one — check for an existing "alle provincies"-shaped fixture
before inventing a new one) shows all three new tabs enabled; clicking each triggers verification and
renders real slices/bars with real text (not just "doesn't crash" — the session 116 lesson about vacuous
tests applies here too); typing a chat message that asks for one of the three forms produces the matching
`setForm` chip and the same rendered result as the tab click; a NON-region-set chart (a single region, or
a hand-picked multi-region selection) shows all three tabs disabled with reasons reachable, and the same
chat request refuses naming the click path.

- [ ] **Step 5: Full verification, whole-branch review, and commit**

Root typecheck, `cd web && npm run typecheck`, the full `web` test suite (solo), `cd web && npm run
build`, the full Playwright e2e suite. Commit: `test(chart): chat-doorway wiring + contract/property/e2e
coverage for pie/stacked/stacked100 (phase 5b task 5)`.

After Task 5 is reviewed clean, proceed to a final whole-branch review on the most capable available
model, exactly as phases 1-5 did. Update `docs/STATUS.md`, `docs/status-archive.md`,
`docs/08-build-plan.md`, the chart co-pilot ADR's "as built" section, `docs/open-questions.md` (record
scatter as the one remaining split-out capability, still not started), and `docs/lessons-learned.md` as
part of the session wrap-up ritual.
