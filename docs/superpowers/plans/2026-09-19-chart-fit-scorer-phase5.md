# Chart-fit scorer + dumbbell/slope/heatmap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement
> this plan task-by-task, ONE implementer at a time (no parallel dispatch — this plan's tasks all touch a
> shared, fragile file, `web/components/chart.tsx`, once type-widened; see Global Constraints). Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three new honest chart shapes — dumbbell, slope, heatmap — gated by a small rule-based
"chart-fit scorer" that both the on-screen tab switcher and the chat co-pilot's allowed-shapes list read
from, so the two can never disagree about what's on offer. No LLM, no schema change, no new calculation.

**Architecture:** Widen the existing five-member `ChartForm` union to eight. Add one new yes/no guard
predicate per new form, following the exact pattern the five existing predicates already use
(`lineFormAllowed`/`areaFormAllowed`/`hbarFormAllowed` in `web/lib/chart-view-state.ts`). Collect all
eight predicates into one new function, `allowedForms`, in a new file `web/lib/chart-fit.ts` — this is
"the chart-fit scorer" the spec names; both the panel's tab list and the chat co-pilot's capability
builder are rewired to call it instead of independently hand-maintaining their own copy of the same list
(they already duplicate it today, for the original five forms — this plan removes that duplication rather
than adding a third copy). Slope needs zero new chart-drawing code (it reuses the existing line-chart
render branch verbatim — a two-point line already looks exactly like a slope chart). Dumbbell is a new
Recharts render branch, closely modelled on the existing horizontal-bar branch. Heatmap is a new,
non-Recharts CSS-grid render branch, reusing the existing table view's own row/column data.

**Tech Stack:** Next.js/React/TypeScript, Recharts 3.10 (already a dependency), Vitest + Testing Library
(jsdom) for unit/contract tests, Playwright for e2e (hermetic, LLM-stub-backed).

**Spec:** [docs/superpowers/specs/2026-09-17-chart-copilot-design.md](../specs/2026-09-17-chart-copilot-design.md)
§10 ("§5's phase 5 expanded"). Read that section first — it has the full honesty reasoning per shape and
the owner's "Split" decision (pie/donut/stacked/100%/scatter are explicitly OUT of this plan; ADR 039's
refusal of those four is unchanged).

## Global Constraints

- **No new calculation, no schema change, no new server action, no new DB write.** Every number the three
  new shapes draw is a `ChartPoint.value` the app already fetched and verified for this exact chart —
  identical honesty story to switching from Lijn to Staaf today. If any task finds itself needing a
  number that isn't already on the spec, stop and flag it — that would be scope creep into the deferred
  pie/stacked/scatter work, not this plan.
- **CBS/Eurostat card only, own-data deferred — corrected from an earlier draft of this plan.** An
  earlier version of this section assumed both cards could get the three new shapes for free, since the
  guard predicates are pure functions of a shared `ChartSpec` type. That's true of the GUARDS, but not of
  the rendering: `web/components/user-chart.tsx` (the own-data card) is a genuinely separate component
  with its OWN copy of the Recharts render branches — it does not reuse `web/components/chart.tsx`'s
  `ChartView`, only a few of its exported pure helpers. Shipping the three new forms in the chat/panel
  capability list for the own-data tier without matching render code in `user-chart.tsx` would be exactly
  the bug this architecture exists to prevent: the chat offering something the panel can't do. So — same
  as phase 4's storytelling primitives — this plan is **CBS/Eurostat card only**
  (`web/components/chart.tsx`, which is also what the embed/gallery/Ontdek surfaces already share per ADR
  041); own-data support is a separate, later task, tracked as its own open-questions.md row at session
  wrap-up (mirroring [#289](../../open-questions.md)'s own precedent). `ownDataCapabilities` in
  `web/lib/chart-capabilities.ts` must NOT gain the three new forms in this plan — only `cbsCapabilities`
  does (see Task 1 Step 5).
- **`ChartForm` is a widely-narrowed shared type — grep the WHOLE repo, not just the files you edit,
  before calling any task in this plan done.** Session 115 hit this exact trap widening a different shared
  union (`DerivationRecord` + `'mean'`): three unrelated files broke, each found by a different, partly
  accidental means. Known narrowing sites to check for `ChartForm` (this list is a floor, not a ceiling —
  confirm it's complete yourself with `grep -rn "'line'.*'area'.*'bar'.*'hbar'.*'table'" .` and by reading
  every compiler error, not just the ones in files you touched):
  - `web/lib/chart-view-state.ts` — the canonical `ChartForm` union and `isChartForm`.
  - `web/lib/chart-commands.ts` — the `setForm` command's zod schema, a hand-written `z.enum([...])`.
  - `src/chart/copilot/types.ts` — `CBS_COPILOT_FORMS` and `CbsCopilotCapabilities['forms']`'s own
    hand-written literal union (currently duplicates `ChartForm` rather than importing it).
  - `src/chart/copilot/schema.ts` — `cbsViewCommandSchema`'s own `z.enum([...])` for `setForm`.
  - `src/attachments/copilot/types.ts` — the own-data tier's own capabilities forms type (check whether
    it duplicates the same five-member literal union; if so it needs the same three new members).
  - `web/components/chart.tsx` — `FORM_ORDER`, `formTabRef`, the tablist JSX, `effectiveKind`.
  - Any test file with `'line' | 'area' | 'bar' | 'hbar' | 'table'` or `['line', 'area', 'bar', 'hbar',
    'table']` written out literally.
  Run the FULL typecheck (`npm run typecheck` at the repo root AND `cd web && npm run typecheck`, not a
  scoped single-file check) and `cd web && npm run build` before any task that touches the type is called
  done — session 115 found a real error `next build` caught that a scoped typecheck had already called
  clean.
- **One implementer at a time, no parallel dispatch.** All five tasks below eventually touch
  `web/components/chart.tsx`, a single very large, carefully-conventioned file (past sessions have found
  real bugs from parallel edits colliding there, e.g. session 115's era-shading modal-only-mount bug).
  Dispatch tasks in the order below, sequentially, never two implementers on this plan at once.
- **Follow existing conventions exactly, do not invent a second mechanism.** Every new render branch must
  reuse the existing honesty machinery already in `chart.tsx`: displayed numbers come only from a point's
  own `formattedValue` (never Recharts' own number formatting of `value`), every displayed number carries
  `data-label-for="<resultId>"`, custom tooltips/axis ticks follow the same pattern as the existing
  line/hbar branches, and `pres` (presentation overrides — colour, thickness, grid) is honoured the same
  way for the new shapes as for the old ones wherever it applies.
- **i18n:** every new user-facing string (tab labels, disabled-reason text, the chat's `chart.copilot.*`
  fallback chip if one is added) needs both an `nl` and an `en` entry in `web/lib/i18n/messages.ts`
  (CLAUDE.md convention — interface strings are bilingual; this is UI chrome, not CBS pipeline output).

## Task 1: Widen `ChartForm`, add the three guard predicates, build the chart-fit scorer

**Files:**
- Modify: `web/lib/chart-view-state.ts` (the `ChartForm` union, `isChartForm`, three new guard
  predicates, `fallbackForm`)
- Create: `web/lib/chart-fit.ts` (the scorer)
- Modify: `web/lib/chart-commands.ts:431` (the `setForm` zod enum)
- Modify: `src/chart/copilot/types.ts` (`CBS_COPILOT_FORMS`, `CbsCopilotCapabilities['forms']`)
- Modify: `src/chart/copilot/schema.ts:25` (the `setForm` zod enum)
- Modify: `web/lib/chart-capabilities.ts` (`formsFor` — call the new scorer instead of hand-duplicating
  the five-predicate list)
- Modify (if the grep in Global Constraints finds a duplicate union there):
  `src/attachments/copilot/types.ts`
- Test: `web/lib/chart-view-state.test.ts` (or wherever the existing `lineFormAllowed` etc. are already
  tested — extend that file), `web/lib/chart-fit.test.ts` (new)

**Interfaces:**
- Consumes: the existing `ChartSpec`/`ChartPoint` types (`src/chart/schema.ts` /
  `web/backend/chart/types.ts`, unchanged) and the existing guard-predicate pattern.
- Produces: `ChartForm` widened to `'line' | 'area' | 'bar' | 'hbar' | 'table' | 'dumbbell' | 'slope' |
  'heatmap'`; `dumbbellFormAllowed(spec, seriesCount)`, `slopeFormAllowed(spec, seriesCount)`,
  `heatmapFormAllowed(spec, seriesCount)` (all exported from `chart-view-state.ts`, same shape as the
  existing three); `allowedForms(spec, seriesCount): ChartForm[]` exported from the new
  `web/lib/chart-fit.ts` — Task 2, 3, 4, 5 all import this instead of re-deriving the list.

- [ ] **Step 1: Widen the `ChartForm` union and `isChartForm`**

In `web/lib/chart-view-state.ts`, replace:

```ts
export type ChartForm = 'line' | 'area' | 'bar' | 'hbar' | 'table';
```

with:

```ts
export type ChartForm = 'line' | 'area' | 'bar' | 'hbar' | 'table' | 'dumbbell' | 'slope' | 'heatmap';
```

Replace the body of `isChartForm`:

```ts
export function isChartForm(x: unknown): x is ChartForm {
  return (
    x === 'line' ||
    x === 'area' ||
    x === 'bar' ||
    x === 'hbar' ||
    x === 'table' ||
    x === 'dumbbell' ||
    x === 'slope' ||
    x === 'heatmap'
  );
}
```

- [ ] **Step 2: Add the three new guard predicates**

Add directly below the existing `hbarFormAllowed` function in `web/lib/chart-view-state.ts`:

```ts
/**
 * Phase 5 (chart-fit scorer, session 116, ADR 039 unchanged for pie/stacked/
 * scatter — see docs/superpowers/specs/2026-09-17-chart-copilot-design.md
 * §10): dumbbell and slope share one condition — every series narrowed down
 * to EXACTLY two points (e.g. a region's value at the start and end of a
 * period range someone picked), comparing at least two things. Both dots on
 * both forms are real, already-verified cells; nothing is computed. Shared
 * here so the two forms can never silently drift apart from each other —
 * see slopeFormAllowed immediately below.
 */
export function dumbbellFormAllowed(spec: Pick<ChartSpec, 'series'>, seriesCount: number): boolean {
  return seriesCount >= 2 && spec.series.every((s) => s.points.length === 2);
}

/**
 * Phase 5: identical condition to dumbbellFormAllowed, kept as its own named
 * export — matching the one-guard-per-form convention every other form in
 * this file follows — rather than every slope call site reaching for a
 * function named after a different form.
 */
export function slopeFormAllowed(spec: Pick<ChartSpec, 'series'>, seriesCount: number): boolean {
  return dumbbellFormAllowed(spec, seriesCount);
}

/**
 * Phase 5: a heat-map grid needs at least two things being compared AND at
 * least two time points each, or it isn't a grid at all — a single row or a
 * single column is already better served by the existing hbar/bar/line
 * forms. Every cell it draws is one series' own real point value; nothing is
 * combined or summed across cells (unlike the still-deferred pie/stacked
 * work, §10).
 */
export function heatmapFormAllowed(spec: Pick<ChartSpec, 'series'>, seriesCount: number): boolean {
  return seriesCount >= 2 && spec.series.every((s) => s.points.length >= 2);
}
```

- [ ] **Step 3: Widen `fallbackForm`**

The current signature is `fallbackForm(form: ChartForm, spec: Pick<ChartSpec, 'kind'>, seriesCount:
number): ChartForm`. Widen the `spec` parameter's type to `Pick<ChartSpec, 'kind' | 'series'>` (every
real caller already passes a full `ChartSpec`, so this is additive) and add three new `case`s:

```ts
export function fallbackForm(
  form: ChartForm,
  spec: Pick<ChartSpec, 'kind' | 'series'>,
  seriesCount: number,
): ChartForm {
  switch (form) {
    case 'area':
      if (areaFormAllowed(spec, seriesCount)) return 'area';
      return lineFormAllowed(spec, seriesCount) ? 'line' : 'bar';
    case 'hbar':
      return hbarFormAllowed(spec) ? 'hbar' : 'bar';
    case 'line':
      return lineFormAllowed(spec, seriesCount) ? 'line' : 'bar';
    case 'dumbbell':
      return dumbbellFormAllowed(spec, seriesCount) ? 'dumbbell' : 'bar';
    case 'slope':
      return slopeFormAllowed(spec, seriesCount) ? 'slope' : 'bar';
    case 'heatmap':
      return heatmapFormAllowed(spec, seriesCount) ? 'heatmap' : 'table';
    case 'bar':
    case 'table':
      return form;
  }
}
```

Run `cd web && npm run typecheck` now — every call site of `fallbackForm`/`lineFormAllowed`/etc. that
narrows over the old five-member union will fail to compile; note every failure, they are the "known
narrowing sites" list in Global Constraints plus whatever else the compiler finds.

- [ ] **Step 4: Write the scorer, `web/lib/chart-fit.ts`**

```ts
// Phase 5 (chart-fit scorer, session 116, owner "Split" decision — ADR 039's
// refusal of pie/donut/stacked/100%/scatter is UNCHANGED, see
// docs/superpowers/specs/2026-09-17-chart-copilot-design.md §10). The ONE
// place "is this shape honestly offered for this chart" is answered — both
// the on-screen tab switcher (chart.tsx) and the chat co-pilot's
// allowed-shapes list (chart-capabilities.ts) call this instead of each
// keeping their own hand-written copy of the same list, so the two can
// never disagree about what's on offer. No model, no cost, pure functions
// over the spec already on screen — nothing here computes a NEW number.
import type { ChartSpec } from '../backend/chart/types.ts';
import {
  areaFormAllowed,
  dumbbellFormAllowed,
  hbarFormAllowed,
  heatmapFormAllowed,
  lineFormAllowed,
  slopeFormAllowed,
  type ChartForm,
} from './chart-view-state.ts';

/**
 * Every shape currently honestly offered for `spec`, in the app's fixed
 * display order. `bar` and `table` are never gated (pre-existing
 * convention). The three phase-5 shapes trail the original five so the
 * five keep their familiar, already-shipped tab order and positions.
 */
export function allowedForms(spec: Pick<ChartSpec, 'kind' | 'series'>, seriesCount: number): ChartForm[] {
  const forms: ChartForm[] = [];
  if (lineFormAllowed(spec, seriesCount)) forms.push('line');
  if (areaFormAllowed(spec, seriesCount)) forms.push('area');
  forms.push('bar');
  if (hbarFormAllowed(spec)) forms.push('hbar');
  forms.push('table');
  if (dumbbellFormAllowed(spec, seriesCount)) forms.push('dumbbell');
  if (slopeFormAllowed(spec, seriesCount)) forms.push('slope');
  if (heatmapFormAllowed(spec, seriesCount)) forms.push('heatmap');
  return forms;
}
```

- [ ] **Step 5: Give `cbsCapabilities` the scorer, leave `ownDataCapabilities` untouched**

`formsFor` (lines 27-35 as of this plan's writing) is currently called by BOTH `ownDataCapabilities` and
`cbsCapabilities`. Per the corrected Global Constraint above, only the CBS tier gets the three new forms
in this plan — so do NOT widen `formsFor` itself (that would also widen `ownDataCapabilities`'s output,
the own-data tier, which has no matching render code yet). Instead:

1. Leave `formsFor` and `ownDataCapabilities` completely unchanged.
2. In `cbsCapabilities`'s own body, replace its call to `formsFor(spec, spec.series.length)` with a direct
   call to the new scorer: `allowedForms(spec, spec.series.length)`.
3. Add `import { allowedForms } from './chart-fit.ts';` to this file's imports. Do not remove
   `areaFormAllowed, hbarFormAllowed, lineFormAllowed` from the existing `./chart-view-state.ts` import —
   `formsFor`/`ownDataCapabilities` still use them unchanged.

Result: `cbsCapabilities` (the CBS/Eurostat tier, `chart.tsx`'s own chat doorway) offers all eight forms
where the scorer allows; `ownDataCapabilities` (the own-data tier, `user-chart.tsx`'s chat doorway) still
offers exactly the original five, unchanged, until a later plan adds matching render code there.

- [ ] **Step 6: Widen the `setForm` command schemas**

In `web/lib/chart-commands.ts`, change the line-431 zod literal:

```ts
z.enum(['line', 'area', 'bar', 'hbar', 'table'])
```

to:

```ts
z.enum(['line', 'area', 'bar', 'hbar', 'table', 'dumbbell', 'slope', 'heatmap'])
```

In `src/chart/copilot/schema.ts`, change the line-25 zod literal the same way. In
`src/chart/copilot/types.ts`, widen `CBS_COPILOT_FORMS` to the eight-member tuple and
`CbsCopilotCapabilities['forms']`'s inline union type to match. `validateCommand`'s own `setForm` case
(`chart-commands.ts` around line 326) already calls `fallbackForm` — once Step 3 lands, it validates the
three new forms automatically; do not hand-write a parallel check.

- [ ] **Step 7: Check `src/attachments/copilot/types.ts` for a duplicate forms union**

If `CopilotCapabilities['forms']` there is its own hand-written five-member literal union (rather than an
import of `ChartForm`), widen it identically. If it already imports `ChartForm`, nothing to do here — note
which was true in the task report.

- [ ] **Step 8: Unit tests**

In the guard-predicate test file (wherever `lineFormAllowed`/`areaFormAllowed`/`hbarFormAllowed` are
already tested — find it before writing new tests, and add to it rather than starting a second file), add
cases for each new predicate: allowed for a genuine 2-series/2-point-each spec (dumbbell/slope), refused
for a 1-series spec, refused for a 3-point-per-series spec; heatmap allowed for a 2-series/2-point spec,
refused for a 1-series spec, refused for a 1-point-per-series spec. Also test the three new `fallbackForm`
cases (a `'dumbbell'` document state whose spec no longer qualifies falls back to `'bar'`; `'heatmap'`
falls back to `'table'`).

Create `web/lib/chart-fit.test.ts`: `allowedForms` returns the full eight-member order for a spec that
qualifies for everything; returns exactly `['bar', 'table']` for a spec that qualifies for nothing extra
(single series, single point, bar kind); returns `[...][without 'dumbbell'/'slope'/'heatmap']` for a
normal multi-point time series (3+ points per series) — the three new forms must NOT appear just because
there are 2+ series.

- [ ] **Step 9: Full verification and commit**

Run `npm run typecheck` (root) AND `cd web && npm run typecheck` AND `cd web && npm run build` — fix every
failure the widened union surfaces, not only the ones in files this task otherwise touches. Run the full
`web` test suite. Commit: `feat(chart): widen ChartForm, add dumbbell/slope/heatmap guards + the chart-fit
scorer (phase 5 task 1)`.

## Task 2: Slope — wire the tab, reuse the line render branch

**Depends on:** Task 1 (`slopeFormAllowed`, widened `ChartForm`, `allowedForms`).

**Files:**
- Modify: `web/components/chart.tsx`
- Modify: `web/lib/i18n/messages.ts` (new tab label + disabled-reason strings, nl + en)
- Test: `web/components/chart.test.tsx` (extend)

**Interfaces:**
- Consumes: `slopeFormAllowed` (Task 1), the existing `effectiveKind`/tablist/render-ternary structure
  already in `chart.tsx`.
- Produces: a working `'slope'` tab, selectable whenever `slopeFormAllowed(spec, spec.series.length)` is
  true, rendering via the EXACT SAME JSX subtree the `'line'` tab already renders (no new Recharts code).

**Why zero new render code is correct, not a shortcut:** a slope chart IS a line chart restricted to
exactly two time points per line — that is precisely `slopeFormAllowed`'s own condition. The existing line
branch already draws whatever points a spec carries; feeding it a 2-point-per-series spec already produces
the classic "parallel sloped lines" look. `area`'s `effectiveKind` already maps to `'line'` for exactly
this reason (see the existing comment at `chart.tsx` around line 2723 — "area's effectiveKind is ALSO
'line', same data model") — this task adds `'slope'` to that same mapping.

- [ ] **Step 1: Add `canUseSlope` and extend `FORM_ORDER`**

Near the existing `const canUseHbar = hbarFormAllowed(spec);` (around line 2231), add:

```ts
const canUseSlope = slopeFormAllowed(spec, spec.series.length);
```

Import `slopeFormAllowed` from `./chart-view-state.ts` alongside the existing guard imports (~line 172).

Extend the `FORM_ORDER` array (around line 2820) — append after `'table'`, matching the scorer's own
trailing order from Task 1:

```ts
const FORM_ORDER: ChartForm[] = [
  ...(canUseLine ? (['line'] as const) : []),
  ...(canUseArea ? (['area'] as const) : []),
  'bar',
  ...(canUseHbar ? (['hbar'] as const) : []),
  'table',
  ...(canUseSlope ? (['slope'] as const) : []),
];
```

(Dumbbell and heatmap are added to this same array by Tasks 3 and 4 respectively — each task appends its
own conditional spread after this task's, in the same fixed order the scorer uses: dumbbell, then slope,
then heatmap. Since this task runs first, write only the `slope` spread now.)

- [ ] **Step 2: Extend `effectiveKind` and the render ternary**

Change:

```ts
const effectiveKind: ChartSpec['kind'] = activeForm === 'table' ? spec.kind : activeForm === 'line' || activeForm === 'area' ? 'line' : 'bar';
```

to:

```ts
const effectiveKind: ChartSpec['kind'] =
  activeForm === 'table' ? spec.kind : activeForm === 'line' || activeForm === 'area' || activeForm === 'slope' ? 'line' : 'bar';
```

Find the render ternary's line-branch condition (`{activeForm === 'line' ? (` around line 3446) and widen
it to `{activeForm === 'line' || activeForm === 'slope' ? (` — the entire existing JSX subtree between
that line and the matching `) : activeForm === 'area' ? (` stays completely unchanged; slope reuses it
verbatim.

- [ ] **Step 3: Add the tab button + disabled-reason text**

Add a `slopeTabRef` (`useRef<HTMLButtonElement>(null)`) alongside the existing `lineTabRef`/etc. (~line
1836), add `slope: slopeTabRef` to the `formTabRef` record (~line 2827-2833), and add a tab `<button>`
mirroring the existing hbar tab's structure (aria-selected/tabIndex/disabled/title/className pattern,
~lines 4385-4393) with `disabled={!canUseSlope}`, `aria-describedby={canUseSlope ? undefined :
\`${domId}-slope-reason\`}`, and a screen-reader-only reason span mirroring the existing `!canUseHbar`
block (~line 4424) when disabled. Use new message keys `chart.form.slope` (tab label) and
`chart.slopeDisabledReason` (the disabled tooltip/reason — one digit-free sentence explaining "needs
exactly two time points selected").

- [ ] **Step 4: Add the two i18n message keys**

In `web/lib/i18n/messages.ts`, add both `nl` and `en` entries:
- `chart.form.slope`: nl `"Helling"`, en `"Slope"`.
- `chart.slopeDisabledReason`: nl `"Beschikbaar zodra je precies twee momenten vergelijkt."`, en
  `"Available once you're comparing exactly two points in time."`.

- [ ] **Step 5: Tests**

In `web/components/chart.test.tsx`, add: a spec with 2 series × 2 points each renders the slope tab
enabled and clicking it shows the same line-chart canvas structure as the line tab does for that spec; a
spec with 2 series × 5 points each renders the slope tab disabled with the reason text reachable via
`aria-describedby`; switching to slope then undoing returns to the prior form (reuses the existing
`setForm` command/history machinery unchanged — no new command-log behavior to test here, only that the
UI reaches it).

- [ ] **Step 6: Full verification and commit**

`cd web && npm run typecheck && npm run test -- chart.test chart-view-state && npm run build`. Commit:
`feat(chart): slope chart — reuses the line render, exactly two time points (phase 5 task 2)`.

## Task 3: Dumbbell — new render branch

**Depends on:** Task 1 (`dumbbellFormAllowed`) and Task 2 (this task appends to the same `FORM_ORDER`
array and tablist region Task 2 just edited — read the file fresh, do not assume the line numbers above
are still exact after Task 2's edits).

**Files:**
- Modify: `web/components/chart.tsx`
- Modify: `web/lib/i18n/messages.ts`
- Test: `web/components/chart.test.tsx` (extend)

**What it draws:** one row per series (region/category on the vertical axis, exactly like the existing
hbar branch), two dots per row at that series' two point values, joined by a connecting line — Recharts
has no native "dumbbell" chart, so build it as a `ComposedChart` with `layout="vertical"` containing (a) a
`Bar` whose `dataKey` returns a two-element `[min, max]` tuple per row (Recharts' own "range bar" support —
this draws the connecting segment) rendered with near-zero visual weight (a thin bar, or a custom `shape`
drawing just a line — mirror the existing `RegionBar` custom-shape convention used by the hbar branch,
~line 3787-3791, rather than inventing a new styling mechanism), and (b) a `Scatter` layer plotting both
endpoint dots on top, coloured and labelled exactly like the hbar branch's own end-of-bar value labels
(every drawn number is that point's own `formattedValue`, bound via `data-label-for`).

**Row-building:** add a new pure helper (co-locate it near the file's other row-builders such as
`buildRegionRows`, or extract to `web/lib/chart-dumbbell-rows.ts` if `chart.tsx` already delegates its
other row-shaping to `web/lib/` — check which convention the hbar branch's own `regionChartRowsAll` uses
and follow it) with this shape:

```ts
interface DumbbellRow {
  key: string;
  label: string;
  from: { value: number; formattedValue: string; resultId: string; periodLabel: string };
  to: { value: number; formattedValue: string; resultId: string; periodLabel: string };
}

function buildDumbbellRows(spec: Pick<ChartSpec, 'series'>): DumbbellRow[] {
  return spec.series.map((s, i) => {
    const [from, to] = s.points; // dumbbellFormAllowed already guarantees exactly 2
    return {
      key: `s${i}`,
      label: s.label,
      from: { value: from!.value!, formattedValue: from!.formattedValue, resultId: from!.resultId, periodLabel: from!.periodLabel },
      to: { value: to!.value!, formattedValue: to!.formattedValue, resultId: to!.resultId, periodLabel: to!.periodLabel },
    };
  });
}
```

(Adjust field names to match `ChartPoint`'s real field names exactly — re-read `src/chart/schema.ts`'s
`chartPointSchema` before writing this; the sketch above uses the field names the phase-5 feasibility
check already confirmed exist, `value`/`formattedValue`, but confirm `resultId`/`periodLabel` spelling
against the real schema before typing them into a commit. A point's `value` can be `null` per the schema —
`dumbbellFormAllowed` does NOT currently check for null values; add that check now: a row with either
point's `value === null` must be excluded from the drawn rows, same as every other form already skips
null points, so this task also tightens `dumbbellFormAllowed`/`slopeFormAllowed`/`heatmapFormAllowed` from
Task 1 to require both/all points non-null, and adds a test for a spec with a null point being correctly
refused.)

- [ ] **Step 1: Tighten Task 1's guards for null points**

In `web/lib/chart-view-state.ts`, update `dumbbellFormAllowed` and `heatmapFormAllowed` to also require
every point's `value !== null`:

```ts
export function dumbbellFormAllowed(spec: Pick<ChartSpec, 'series'>, seriesCount: number): boolean {
  return seriesCount >= 2 && spec.series.every((s) => s.points.length === 2 && s.points.every((p) => p.value !== null));
}
```

```ts
export function heatmapFormAllowed(spec: Pick<ChartSpec, 'series'>, seriesCount: number): boolean {
  return seriesCount >= 2 && spec.series.every((s) => s.points.length >= 2 && s.points.every((p) => p.value !== null));
}
```

Add a regression test in `chart-view-state.test.ts`/`chart-fit.test.ts` for a 2-series/2-point spec where
one point is `value: null` — both guards must now return `false`.

- [ ] **Step 2: `buildDumbbellRows`**

Write the helper as specified above, field names corrected against the real `chartPointSchema`. Place it
next to `chart.tsx`'s other row-builders, following whichever of "inline in chart.tsx" vs "own
`web/lib/` file" the existing `buildRegionRows`/`regionChartRowsAll` pattern already uses.

- [ ] **Step 3: The render branch**

Add imports `ComposedChart, Scatter` to the existing `from 'recharts'` import block (~line 29-49). Add
`canUseDumbbell = dumbbellFormAllowed(spec, spec.series.length)` near `canUseSlope`. Extend `FORM_ORDER`
(re-read the file to find Task 2's exact current line) to insert `...(canUseDumbbell ? (['dumbbell'] as
const) : [])` — per the fixed scorer order, insert this spread BEFORE the `slope` spread Task 2 added
(dumbbell, then slope, then heatmap — matching `chart-fit.ts`'s `allowedForms` order from Task 1).

Add a new render branch in the main ternary, modelled closely on the existing hbar branch (mirror its
`layout="vertical"`, `YAxis type="category"` with `RegionAxisTick`/`hbarYAxisWidth`, `XAxis type="number"`
with `domain={[0, 'auto']}` unless `pres.zeroBaseline` says otherwise — match whatever the hbar branch
does exactly, and the custom tooltip pattern) — condition it on `activeForm === 'dumbbell'`, data from
`buildDumbbellRows(spec)`, containing the range-`Bar` + `Scatter` pair described above. Every drawn label
uses each point's own `formattedValue`, with `data-label-for` on both the from-dot and the to-dot.

- [ ] **Step 4: Tab button + i18n**

Same pattern as Task 2 Step 3/4: `dumbbellTabRef`, `formTabRef` entry, tab button, disabled-reason span,
message keys `chart.form.dumbbell` (nl `"Dumbbell"`, en `"Dumbbell"` — this is a chart-type name without
an established Dutch translation; keep it as-is in both, matching how `chart.form.hbar`'s existing label
was handled if it also borrowed an English term — check and follow that precedent) and
`chart.dumbbellDisabledReason` (nl `"Beschikbaar zodra je precies twee momenten vergelijkt."`, en
`"Available once you're comparing exactly two points in time."` — same condition text as slope's, since
the two guards are identical; word it so it reads naturally for a dumbbell chart specifically if the
identical wording reads oddly next to slope's tab).

- [ ] **Step 5: Tests**

`chart.test.tsx`: a 2-series/2-point-each spec renders the dumbbell tab enabled; clicking it renders two
dots per row with each dot's own `formattedValue` text and correct `data-label-for` binding (reuse this
file's existing digit-honesty scan helpers over the dumbbell canvas specifically); a spec with a null
point in one series renders the tab disabled; a 3-point-per-series spec renders the tab disabled.

- [ ] **Step 6: Full verification and commit**

`cd web && npm run typecheck && npm run test -- chart.test chart-view-state chart-fit && npm run build`.
Commit: `feat(chart): dumbbell chart — a new ComposedChart range-bar + scatter render (phase 5 task 3)`.

## Task 4: Heatmap — new CSS-grid render branch

**Depends on:** Task 1 (`heatmapFormAllowed`, tightened for nulls by Task 3) and Task 3 (this task appends
to the same `FORM_ORDER`/tablist region again — re-read the file fresh).

**Files:**
- Modify: `web/components/chart.tsx`
- Modify: `web/lib/i18n/messages.ts`
- Test: `web/components/chart.test.tsx` (extend)

**What it draws:** NOT a Recharts chart — a plain HTML/CSS grid, reusing the exact rows/columns the
`'table'` form already builds (find that form's existing row-building code in `chart.tsx` — it is the
`else` branch of the main render ternary, the `<BarChart>`-free fallback; if `'table'` is actually rendered
via a wholly separate code path rather than inside the same ternary as the Recharts branches, locate that
path instead and reuse ITS row/column model, not a re-derivation). Each grid cell shows one point's own
`formattedValue` as text, with its background colour set from that SAME point's `value` via a simple
linear scale between the visible min and max value across the grid (a purely visual encoding — the
NUMBER shown is always the real `formattedValue`, the colour is never the only way a value is
communicated, matching this app's existing colour-blind-safe-plus-pattern convention elsewhere in
`chart.tsx`, e.g. the hatch patterns already used in `<defs>` for series that need a non-colour cue).

- [ ] **Step 1: Locate and reuse the table form's existing row/column model**

Read `chart.tsx`'s `'table'` rendering path in full before writing anything. Identify the exact data
structure it already builds (rows × periods, or rows × series — whichever the existing table uses) and
its exact field names. Do not build a second, parallel row-shaping function if the table's own is
reusable as-is or with a thin wrapper — reuse it directly, matching this plan's "it's the same rows the
table view already shows, recoloured" design commitment (spec §10).

- [ ] **Step 2: A colour-scale helper**

Add a small pure function, e.g. in `web/lib/chart-heatmap.ts` (new) or inline if it is under ~15 lines and
has no other reason to live elsewhere:

```ts
/** Maps `value` linearly onto `min..max` to a 0..1 intensity — callers turn
 * this into a CSS colour (e.g. `color-mix` against the series' own colour
 * token, or a fixed sequential scale token if this app already has one;
 * check web/lib/chart-presentation.ts and the design tokens in
 * web/app/globals.css for an existing heat/intensity scale before adding a
 * new one). Returns 0.5 when min === max (every cell the same colour,
 * nothing to contrast). */
export function heatmapIntensity(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return (value - min) / (max - min);
}
```

Before wiring this into JSX, check `web/lib/chart-presentation.ts` and `web/app/globals.css` for any
existing sequential/heat colour-scale token this app already defines (a house-style palette likely already
exists for this, given the templates/house-styles work tracked as this phase's own follow-up,
[#275](../../open-questions.md)) — reuse it if present rather than inventing a new one; if genuinely
nothing exists, a single CSS custom property interpolated via `color-mix(in oklch, var(--heatmap-low),
var(--heatmap-high) <percent>%)` is the cheapest correct option, added to the existing theme token file
alongside the other `--chart-*`/`--accent` tokens, both light and dark mode.

- [ ] **Step 3: The render branch**

Add `canUseHeatmap = heatmapFormAllowed(spec, spec.series.length)` near the other guards. Extend
`FORM_ORDER` with `...(canUseHeatmap ? (['heatmap'] as const) : [])`, appended last per the scorer's fixed
order (dumbbell, slope, heatmap). Add a branch to the main render ternary for `activeForm === 'heatmap'`:
a `<div>` grid (CSS grid, `grid-template-columns`/`grid-template-rows` sized off series/period counts,
mirroring how the table form already sizes its own layout) where each cell is a `<div>` with
`background-color` from Step 2's helper and the point's own `formattedValue` as its text content, plus
`data-label-for="<resultId>"` exactly like every other numeric label in this file. Row headers = series
labels (reuse the table's own label text, not a re-derivation); column headers = period labels (reuse the
table's own header row). Respect `pres` where it applies (e.g. font/label scale if the table form already
does) — a heatmap has no line thickness/grid-line settings, so most `pres` keys are simply inapplicable
here, same as they already are for the table form today (check how the table form's own tab handles
`resolvePresentation().applicable` and mirror it for consistency).

- [ ] **Step 4: Tab button + i18n**

Same pattern as Tasks 2/3. Message keys `chart.form.heatmap` (nl `"Warmtekaart"`, en `"Heatmap"`) and
`chart.heatmapDisabledReason` (nl `"Beschikbaar zodra je minstens twee reeksen en twee momenten
vergelijkt."`, en `"Available once you're comparing at least two series across at least two points in
time."`).

- [ ] **Step 5: Tests**

`chart.test.tsx`: a 2×2+ qualifying spec renders the heatmap tab enabled and a grid with the right cell
count, each cell's text equal to its point's `formattedValue`, each cell's `data-label-for` bound
correctly, and this file's existing digit-honesty scan passes over the heatmap canvas; a 1-series spec
renders the tab disabled; a spec with a null point renders the tab disabled (reusing Task 3's null-value
guard tightening, since `heatmapFormAllowed` was updated there too).

- [ ] **Step 6: Full verification and commit**

`cd web && npm run typecheck && npm run test -- chart.test chart-view-state chart-fit && npm run build`.
Commit: `feat(chart): heatmap — a CSS-grid render over the table's own rows (phase 5 task 4)`.

## Task 5: Contract test, property test, and e2e coverage for all three new shapes

**Depends on:** Tasks 1-4 (needs the finished, mergeable state of every prior task).

**Files:**
- Modify: `web/components/chart-commands-contract.test.tsx`
- Modify: `web/lib/chart-commands.test.ts`
- Modify: `web/e2e/chart-copilot.spec.ts`

**Interfaces:**
- Consumes: everything Tasks 1-4 produced — `allowedForms`, the three guards, the three new tabs, the
  widened `setForm` command.
- Produces: no new production code — this task is coverage only.

- [ ] **Step 1: Contract test — chat vocabulary ⊆ panel vocabulary**

In `web/components/chart-commands-contract.test.tsx`, extend whatever list already pins "every form the
chat can offer must have a matching panel tab" to include `'dumbbell' | 'slope' | 'heatmap'` — find the
existing list (it already covers `'line' | 'area' | 'bar' | 'hbar' | 'table'` for `setForm`) and widen it
rather than adding a second, parallel list.

- [ ] **Step 2: Property test — apply/invert still returns the original state**

In `web/lib/chart-commands.test.ts`, find `randomCommand()` (the fast-check generator) and confirm its
`setForm` case already draws from the full `ChartForm` union rather than a hard-coded five-member array —
if it hard-codes the array (check before assuming), widen it to the eight-member list so the existing
apply-then-invert property test automatically covers switching into and out of the three new forms; do
not write a separate, new property test for this.

- [ ] **Step 3: e2e — Playwright, hermetic**

In `web/e2e/chart-copilot.spec.ts`, add cases mirroring the existing form-switch coverage for line/area/
hbar: (1) a chart whose spec qualifies for dumbbell/slope/heatmap shows all three tabs enabled, clicking
each renders the expected canvas structure (assert on real rendered text/attributes, not just "the chart
doesn't crash" — see the session 115 lesson referenced in `docs/lessons-learned.md`, "era-shading vacuous
test," about tests that only assert non-crashing); (2) typing "toon dit als een dumbbell" (or the English
equivalent) in the chat box on a qualifying chart produces a `setForm` command chip and the canvas matches
what clicking the tab directly would show; (3) a chart whose spec does NOT qualify (a normal multi-point
time series) shows all three tabs disabled with their reason reachable, and asking the chat for one of
them returns a refusal naming the click path, matching the existing refusal-copy pattern for other
not-available requests.

- [ ] **Step 4: Full verification, whole-branch review, and commit**

Run the complete verification block: root typecheck, `cd web && npm run typecheck`, the full `web` test
suite (solo, not alongside other heavy processes — this machine has 8 GB, per the existing
`feedback_verify_exit_codes` lesson), `cd web && npm run build`, then the Playwright e2e suite. Commit:
`test(chart): contract/property/e2e coverage for dumbbell, slope, heatmap (phase 5 task 5)`.

After Task 5 is reviewed clean, proceed to a final whole-branch review on the most capable available
model (per `subagent-driven-development`'s own process) before merging/pushing to `main`, exactly as
phases 1-4 did. Update `docs/STATUS.md`, `docs/status-archive.md`, `docs/08-build-plan.md`, the chart
co-pilot ADR's "as built" section, and `docs/lessons-learned.md` as part of the session wrap-up ritual —
CLAUDE.md's definition of done applies to this plan exactly as it did to phase 4.
