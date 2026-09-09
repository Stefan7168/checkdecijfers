# WP218 Phase 5 — More Chart Types (Area, Horizontal Bar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Offer two more honest chart types — a filled **area** for a single time series (zero baseline forced) and a **horizontal bar** for region comparisons (long municipality names readable) — by growing the existing Lijn / Staaf / Tabel switch in place, greying out a type that does not fit THIS chart with a one-line reason, and explaining once why pie, stacked, scatter and ranked charts are never offered.

**Architecture:** Per the research read-back (`.superpowers/sdd/chart-type-picker-research.md`, copied to `docs/session-briefs/2026-09-09-session-91-chart-type-picker-research.md` in the docs task): ONE control, grown — `ChartForm` widens to `'line' | 'area' | 'bar' | 'hbar' | 'table'`, each new form has a pure guard predicate like `lineFormAllowed`, the tablist gains two tabs with the existing disabled-with-reason pattern (`title` + `aria-describedby`), and the renderer gets an `AreaChart` branch and a `layout="vertical"` `BarChart` branch over a transposed, verbatim-projected row set. Presentation overrides (colours, thickness, labels) carry over across a switch (users expect that); the resolver's honesty locks extend to the new forms. Owner decision D on open-questions #218 ("find the best practice first") — answered by the research; refused types stay refused (R1/R5/R6/R9/R10/#48).

**Tech Stack:** Recharts 3.10 (`AreaChart`/`Area`, `BarChart layout="vertical"`), React 19, Vitest + jsdom.

## Global Constraints

- **Refused for every dataset, never rendered:** pie/donut, stacked bar/area, 100 %, scatter, sorted/ranked bars, smoothed/step curves. The panel's Grafiek tab gets ONE collapsed note (`<details>`) `Waarom geen taart- of gestapelde grafiek?` with three digit-free sentences (a pie or a stack draws a total or a share no CBS cell backs; a scatter needs two measures; sorting is a ranking claim), nl + en.
- **Area = single-series time series only** (`spec.kind === 'line' && seriesCount === 1`): the fill encodes magnitude, so the Y axis is FORCED to start at zero (`zeroBaseline` locked `'zero'`, reason `Een gevuld vlak begint altijd bij nul.`); `connectNulls={false}` keeps gaps; the same hollow R11 markers; refused on multi-series (reason: filled areas would cover each other's markers and gaps) and on comparisons (an area needs a time axis).
- **Horizontal bar = comparisons only** (`spec.kind === 'bar'`): one bar per REGION in the spec's order (R6: never sorted), the region label on the category axis, the number axis from zero with `tick={false}` (no invented ticks), the value label at the bar's end (`data-label-for`), hatch for provisional; refused on time series (the chronological axis reads left→right). Value labels locked shown; `xLabels` not applicable (labels sit on the category axis).
- **Presentation carries over** on a type switch (the reducer keeps `presentation`; the resolver re-runs the locks per form). A form that becomes disallowed after a same-instance spec swap falls back exactly like the existing line→bar guard (area → line if allowed else bar; hbar → bar).
- Every visible number stays a spec string bound via `data-label-for`; the whole-card membership scans must pass in both new forms; the SVG export works unchanged; digit-free copy for tab labels/reasons/note, nl + en via the catalogue (`chart.form.area` = `Vlak`, `chart.form.hbar` = `Liggend`; en `Area`, `Horizontal bar`).
- Small multiples stay line-only (offered only when the active form is `line`). Zoom (Vanaf/Tot) stays for line-kind specs (so also in area form). Web suite green, typecheck clean. Commit only on `wp218-chart-styling`, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: Model — forms, guards, resolver, region rows

**Files:** modify `web/lib/chart-view-state.ts` (+ test), `web/lib/chart-presentation.ts` (+ test), `web/components/chart.tsx` (ONLY the pure helper `buildRegionRows` next to `buildRows`, exported) + `chart.test.tsx` (pure test).

```ts
// chart-view-state.ts
export type ChartForm = 'line' | 'area' | 'bar' | 'hbar' | 'table';
export function areaFormAllowed(spec: Pick<ChartSpec, 'kind'>, seriesCount: number): boolean; // kind line && seriesCount === 1
export function hbarFormAllowed(spec: Pick<ChartSpec, 'kind'>): boolean;                       // kind bar
export function fallbackForm(form: ChartForm, spec, seriesCount): ChartForm;                    // area→(line if lineFormAllowed else bar); hbar→bar; line→bar when !lineFormAllowed; bar/table unchanged
// chart-presentation.ts
PresentationContext.form: ChartForm (widened); resolver: 'area' → like line but zeroBaseline locked 'zero' (LOCK_REASONS.zeroBaselineArea); 'hbar' → like bar minus xLabels (not applicable), reasons unchanged.
// chart.tsx (pure)
export interface RegionRow { label: string; value: number | null; value_display: string | null; value_provisional: boolean; value_resultId: string | null; colorIndex: number }
export function buildRegionRows(spec: PlottableSpec, colorFor: (i: number) => string): { rows: RegionRow[]; colors: string[] }; // one row per series (region) in spec order, first point only (a comparison has exactly one period per region), null-safe
```

Tests: guards table (S1/S2/S3/S4 × forms); `fallbackForm`; resolver locks for area/hbar and `applicable` sets; `buildRegionRows` keeps spec order, carries display/resultId/provisional verbatim, empty series → null row; the reducer accepts `setForm: 'area' | 'hbar'` (no other change).

Commit `feat(chart): area and horizontal-bar forms in the model — guards, locks, region rows (WP218 phase 5)`.

---

### Task 2: Render — tabs, area branch, horizontal-bar branch

**Files:** modify `web/components/chart.tsx` (+ test), `web/lib/i18n/messages.ts` (tab labels + reasons, nl/en).

- `activeForm = fallbackForm(state.form, spec, seriesMeta.length)`; `effectiveKind` = `'line'` for line/area, `'bar'` for bar/hbar, `spec.kind` for table (drives `valueLabelPlan`/`annotationMarkers` exactly as today).
- Tablist order `Lijn · Vlak · Staaf · Liggend · Tabel`; `FORM_ORDER` lists only the tabs allowed for this spec (disabled ones are skipped by the arrow keys, as today); each disabled tab has `title` + `aria-describedby` → an `sr-only` reason: line (existing reason), area on multi-series (`Een gevuld vlak per reeks zou de reeksen over elkaar leggen en gaten verbergen.`), area on a comparison (`Een vlak past alleen bij een reeks in de tijd.`), hbar on a time series (`Liggende staven passen alleen bij een vergelijking tussen regio’s.`). Keys `chart.form.*`, `chart.formReason.*`, nl + en.
- **Area branch:** `<AreaChart data={rows} margin …>` with the same grid/axes/tooltip/reference lines as the line branch, `<Area type="linear" dataKey={s.key} stroke={s.color} fill={s.color} fillOpacity={dimmed ? 0.1 : 0.25} strokeWidth={LINE_WIDTH_PX[…]} connectNulls={false} dot={SeriesDot(…)} activeDot={false} isAnimationActive={false} />`, `YAxis domain={[0, 'auto']}` always (the lock guarantees `pres.zeroBaseline === 'zero'` — read it from `pres` so the render and the policy cannot drift).
- **Horizontal-bar branch:** `const { rows: regionRows } = buildRegionRows(viewSpec, colorFor)` filtered by `hiddenKeys` (hide = drop the row; order kept); `<BarChart layout="vertical" data={visibleRegionRows} margin={{ top: 8, right: rightMarginForLabels, left: 8, bottom: 8 }}>` with `<XAxis type="number" domain={[0, 'auto']} tick={false} axisLine tickLine stroke />`, `<YAxis type="category" dataKey="label" width={min(160, max(48, labelWidthPx(longest region label)))} interval={0} tick={{ fill: AXIS_COLOR }} axisLine tickLine />`, grid per `pres.grid` (`horizontal`/`vertical` swap meaning — keep the user's setting semantic: `both`/`horizontal`/`none`), `<Tooltip>` with a small `RegionTooltip` (header = region label, line `{periodLabel}: {value_display}` + ` *` when provisional, `data-label-for`), one `<Bar dataKey="value" isAnimationActive={false} shape={RegionBar(…)}>` where `RegionBar` draws `<rect>` filled with the row's region colour (hatch pattern id per row when provisional), `fillOpacity` dimmed when a highlight is active on another region, `data-point="value"`, `data-result-id`, role/tabIndex/keyboard activation for click-to-annotate (as `SeriesBar`), and the value label `<text x={x + width + 4} y={y + height / 2 + 4} textAnchor="start" data-role="bar-label" data-label-for>` — labels always (locked), unless more than `BAR_LABEL_MAX` regions (then none, as today). Right margin reserves `labelWidthPx(longest display)`.
- Legend: unchanged component (hide/highlight per region) in both new forms; `hiddenDisclosure` unchanged. Small multiples: `smallMultiplesAvailable = activeForm === 'line' && seriesMeta.length > 1`. Download menu: offered in area/hbar as in line/bar.
- Panel: `ChartConfigPanel` gets the `<details>` note in the Grafiek tab (Task 3 does the copy; here just mount nothing new).

Tests (append to chart.test.tsx): tab set + disabled reasons per spec shape (S1: Liggend disabled; S2: Vlak + Liggend disabled; S3: Lijn + Vlak disabled); keyboard order skips disabled tabs; area renders `.recharts-area-area` (or the class Recharts emits — check `innerHTML`) with the Y domain from zero and hollow markers on provisional points; `Y-as vanaf nul` control absent/locked in area form with the reason; hbar renders one `rect[data-point]` per region in spec order (assert `data-result-id` order equals the spec's series order), region labels as y-axis text nodes, value labels `data-label-for` bound, hidden region → row gone, highlight → other rows dimmed (`fill-opacity`), provisional region hatched; the whole-card membership scan passes in area AND hbar forms (copy the walker); the SVG export contains the region label texts and the value labels; a spec swap from S1 (area chosen) to S2 falls back to line; an S3 (hbar chosen) swapped to S1 falls back to bar. No existing assertion weakened.

Commit `feat(chart): Vlak (area) and Liggend (horizontal bar) as honest extra chart types in the Weergave switch (WP218 phase 5, owner D)`.

---

### Task 3: Panel note + copy

**Files:** modify `web/components/chart-config-panel.tsx` (+ test), `web/lib/i18n/messages.ts`.

In the Grafiek tab, after the controls, a `<details className="text-xs text-muted-foreground"><summary>Waarom geen taart- of gestapelde grafiek?</summary><p>…</p></details>` with: `Een taart- of gestapelde grafiek tekent een totaal of een aandeel dat in geen enkele CBS-cel staat. Een spreidingsgrafiek heeft twee meetwaarden per punt nodig, en deze grafiek heeft er één. Sorteren op waarde is een rangorde die niet gemeten is.` — careful: the last sentences must stay digit-free (`één` is fine, `twee` is fine — no numerals). English: `A pie or a stacked chart draws a total or a share that no CBS cell contains. A scatter plot needs two measures per point, and this chart has one. Sorting by value asserts a ranking that was never measured.` Test: the note renders collapsed, opens on click, digit scan still clean in both languages.

Commit `feat(chart): explain once why pie, stacked, scatter and ranked charts are never offered (WP218 phase 5)`.

---

### Task 4: Docs (folded into the branch-end docs pass)

ADR 039 addendum (phase 5 as built: the form set, guards, the transposed region rows, the locks), `docs/08-build-plan.md` phase 5 ✅, `docs/open-questions.md` #218 (D answered by research → built), copy the research brief into `docs/session-briefs/2026-09-09-session-91-chart-type-picker-research.md`, `docs/12-huisstijl.md` Charts (five forms), `docs/05-data-rules.md` verified-by cells (R6 order in hbar, #48 in area/hbar).

## Self-review

Owner D ✔ (research → one grown control, greyed-with-reason, never-offered explained); invariants ✔ (order kept, zero baseline forced, labels bound, scans in both forms); carry-over of settings ✔ (reducer unchanged); i18n ✔ (catalogue keys). Names consistent: `areaFormAllowed`, `hbarFormAllowed`, `fallbackForm`, `buildRegionRows`, `RegionRow`, `RegionBar`, `RegionTooltip`, `LOCK_REASONS.zeroBaselineArea`.
