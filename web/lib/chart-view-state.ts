// Pure, client-only view-state for chart editing (Phases 1-3, open-questions
// #212). Nothing here calls buildChartSpec again, nothing here is ever
// written into an audit record — this module only ever PROJECTS the
// server-built ChartSpec for on-screen display. See docs/decisions/ for the
// full ADR.
import type { ChartSpec } from '../backend/chart/types.ts';
import type { PresentationOverrides } from './chart-presentation.ts';

export type ChartForm = 'line' | 'area' | 'bar' | 'hbar' | 'table' | 'dumbbell' | 'slope' | 'heatmap';

/** Fix round (Task 5 review, Piece 3): guards an arbitrary value (e.g. the
 * embed route's own `?form=` query-string param) down to a real ChartForm —
 * same convention as messages.ts's own `isLang`. Confirms only that the
 * string is one of the eight real enum members; it says nothing about
 * whether that form is actually ALLOWED for a given spec — see
 * lineFormAllowed/areaFormAllowed/hbarFormAllowed and the phase-5 trio
 * below for that (ChartView's own `initialFormOverride` prop applies both
 * checks, in that order). */
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

/**
 * Phase 5 (chart-fit scorer, session 116): the structural minimum the three
 * phase-5 guards read — how many points each series carries, and whether a
 * point is a real value. A full ChartSpec satisfies it, and so does
 * chart.tsx's own PlottableSpec: both user-chart.tsx (`fallbackForm(
 * state.form, plottable, …)`) and chart-capabilities.ts's `cbsCapabilities`
 * hand these guards a PlottableSpec, never a full spec — a
 * `Pick<ChartSpec, 'series'>` would reject those two call sites
 * (PlottableSeries carries no regionCode, PlottablePoint no decimals/
 * status). Keep every series-reading guard on THIS type, not on ChartSpec,
 * or those call sites stop compiling. The `kind`-only guards above keep
 * their existing `Pick<ChartSpec, 'kind'>`, which both spec shapes already
 * satisfy.
 */
export interface SeriesShape {
  series: readonly { points: readonly { value: number | null }[] }[];
}

/** Bar charts: one label per bar, or none above BAR_LABEL_MAX bars
 * (chart.tsx's valueLabelPlan/hbarLabelsShown). Canonical home for this
 * constant is HERE, not chart.tsx (#229, ADR 041 addendum, session 110):
 * chart-embed-dialog.tsx needs the exact same >15-series default-form rule
 * chart.tsx's own `initialForm` calc uses, and chart.tsx already imports
 * chart-embed-dialog.tsx (for ChartEmbedButton) — a dialog-side import back
 * from chart.tsx would be circular. chart.tsx re-exports this constant so
 * every existing `import { BAR_LABEL_MAX } from './chart.tsx'` call site
 * (chart.test.tsx) keeps working unchanged. */
export const BAR_LABEL_MAX = 15;

/** Session 110 (many-region comparison default, open-questions): a
 * structural test on `spec` itself — never a new field, ChartSpec carries no
 * "shape" concept — true exactly when every series has exactly one point
 * (no time axis; the spec is a single-moment comparison across regions/
 * categories) and there are at least two series (a single series has
 * nothing to compare). A region-set answer (all provincies, all gemeenten
 * in a provincie, …) is the canonical example; a multi-point time series
 * (even a `kind: 'bar'` one) is never comparison-shaped. */
export function isComparisonShaped(spec: Pick<ChartSpec, 'series'>): boolean {
  return spec.series.length >= 2 && spec.series.every((s) => s.points.length === 1);
}

/** Session 110: a comparison-shaped chart of up to this many regions is
 * still perfectly readable as a horizontal bar chart — every label sits on
 * the category axis, so nothing is lost the way it would be crammed onto a
 * vertical bar's x-axis. Above this (e.g. a "alle gemeenten" ~342-member
 * class) even a horizontal bar stops being a usable chart and the table
 * remains the honest view. Deliberately independent of BAR_LABEL_MAX (which
 * only gates whether VALUE labels are drawn on top of the bars, left
 * untouched by this change) — a 16-40 row hbar chart still suppresses its
 * value labels exactly as before, it is just offered as a chart at all. */
export const COMPARISON_HBAR_MAX = 40;

/** Session 110 pass 3 row 3: a horizontal bar chart draws one category
 * (region) row per series on its own y-axis, at a roughly fixed row pitch —
 * a chart height that only follows the CARD'S WIDTH (chart-presentation.ts's
 * `chartHeightForWidth`) leaves that pitch shrinking as more regions are
 * added, which is exactly why the 26-gemeente chart's row pitch (8.1 px)
 * collided with its own 13 px label text (session 110 UX audit pass 3, row
 * 3 repro). ~20 px per row is comfortably taller than a 13 px label. */
export const HBAR_ROW_PX = 20;

/** The tallest an hbar chart is ever allowed to grow to, however many
 * series it is actually handed — `COMPARISON_HBAR_MAX` rows at
 * `HBAR_ROW_PX` each (800px). `defaultFormFor` never OFFERS hbar above
 * `COMPARISON_HBAR_MAX` series, but an explicit `initialFormOverride` (the
 * embed route's own escape hatch) can still hand hbar a spec with more —
 * this cap is enforced here independently rather than assumed from that
 * gate. */
export const HBAR_MAX_HEIGHT_PX = HBAR_ROW_PX * COMPARISON_HBAR_MAX;

/** Session 110 pass 3 row 3: the hbar form's own height floor, applied ON
 * TOP OF whatever height the width-based rule already produced
 * (`baseHeightPx` — chart.tsx's own `chartHeightForWidth` result, or its
 * unmeasured 256px floor) — never below it, since a comparison with few
 * regions is already well served by the width-based height alone. This
 * function only ever GROWS `baseHeightPx`, capped at `HBAR_MAX_HEIGHT_PX`;
 * it has no effect on any other form (chart.tsx calls it only when the
 * currently active form is 'hbar'), so bar/line/area heights are completely
 * untouched by its existence. */
export function hbarChartHeight(seriesCount: number, baseHeightPx: number): number {
  return Math.max(baseHeightPx, Math.min(seriesCount * HBAR_ROW_PX, HBAR_MAX_HEIGHT_PX));
}

/** #229 (ADR 041 addendum, session 110) + the session 110 many-region-
 * comparison fix, REVISED session 110 pass 3 row 1: which form `spec` opens
 * on by default, independent of whatever form a viewer currently has
 * selected — the same calc chart.tsx's own `initialForm` uses for a spec's
 * INITIAL render. A comparison-shaped spec (isComparisonShaped — every
 * series exactly one point, ≥2 series) that is allowed to render as a
 * horizontal bar (hbarFormAllowed) now opens on 'hbar' AT EVERY SERIES
 * COUNT, not only above BAR_LABEL_MAX: a vertical bar names no region on
 * its axis and its value labels start overlapping well below 15 series
 * (pass 3's own 12-province repro), while a horizontal bar puts every
 * region on the category axis regardless of count. Above COMPARISON_HBAR_MAX
 * regions even a horizontal bar stops being a usable chart, so it falls
 * back to Tabel there. A spec that is NOT comparison-shaped (a genuine time
 * series, however many series or points) is completely untouched by this
 * branch and keeps the pre-existing rule: Tabel above BAR_LABEL_MAX, else
 * the spec's own `kind`. Single source of truth — the Embed dialog
 * (chart-embed-dialog.tsx) asks the same question about the publisher's
 * spec without mounting a ChartView, and there is exactly one place this
 * threshold is compared against, never a second, independently-typed copy
 * that could silently drift from the real rule. */
export function defaultFormFor(spec: Pick<ChartSpec, 'kind' | 'series'>): ChartForm {
  if (isComparisonShaped(spec) && hbarFormAllowed(spec)) {
    return spec.series.length <= COMPARISON_HBAR_MAX ? 'hbar' : 'table';
  }
  if (spec.series.length > BAR_LABEL_MAX) {
    return 'table';
  }
  return spec.kind;
}

/** True exactly when `spec`'s OWN default form (`defaultFormFor`) is Tabel.
 * Kept as a thin wrapper — rather than re-implementing the threshold — so
 * every existing caller (the Embed dialog's #229 gate) automatically tracks
 * whatever `defaultFormFor` decides, including the session 110 hbar
 * carve-out: a 16-40 series comparison is no longer table-by-default, so
 * its Embed "Default" option is correctly allowed again. */
export function defaultFormIsTable(spec: Pick<ChartSpec, 'kind' | 'series'>): boolean {
  return defaultFormFor(spec) === 'table';
}

export interface ChartViewState {
  form: ChartForm;
  hiddenKeys: Set<string>;
  /** Shown but visually de-emphasised (opacity), distinct from hidden. A key
   * is never in both sets at once — every transition below enforces that. */
  dimmedKeys: Set<string>;
  highlightedKey: string | null;
  /** Inclusive [fromPeriodCode, toPeriodCode], or null for the full fetched range. */
  periodRange: [string, string] | null;
  /** WP218 (ADR 039): plain user overrides on the stock look; the resolver
   * (chart-presentation.ts) turns them into effective values per render, so a
   * stale override can never apply to a newly-unsafe spec. Cleared by
   * `reset` — owner decision E (session 90): each chart starts fresh. */
  presentation: PresentationOverrides;
  /** #254: index into the ChartView's `alternates` prop, or null for the
   * primary reading. Deliberately NOT derived from the `spec` prop's
   * identity — switching it must never trigger the spec-identity reset
   * effect (chart.tsx ~line 1587), unlike a genuinely new chart. */
  selectedReading: number | null;
}

export type ChartViewAction =
  | { type: 'setForm'; form: ChartForm }
  | { type: 'toggleSeries'; key: string }
  | { type: 'setHighlight'; key: string | null }
  | { type: 'setPeriodRange'; range: [string, string] | null }
  | { type: 'setPresentation'; patch: PresentationOverrides }
  | { type: 'resetPresentation' }
  | /** Story mode (session 92): restore the reader's own hidden/highlight/zoom
   * state in ONE action when the story closes — three separate dispatches
   * would render three intermediate views. `form` and `presentation` are
   * deliberately not part of this: the story never touches them. */
  { type: 'setView'; view: Pick<ChartViewState, 'hiddenKeys' | 'dimmedKeys' | 'highlightedKey' | 'periodRange'> }
  | { type: 'setDimmed'; hiddenKeys: string[]; dimmedKeys: string[] }
  | { type: 'toggleDim'; key: string }
  | /** #237/ADR 046: `initialPresentation` is the gallery's `initialPresentation`
     * prop (ChartView), so a spec-swap reset (a fresh chart mounted on the
     * SAME instance) lands back on the STORY's look, not a bare stock chart —
     * distinct from `onReset` ("Standaard"), which always clears to `{}`
     * regardless of what the chart mounted with. Omitted (undefined) behaves
     * exactly as before this field existed. */
  { type: 'reset'; initialForm: ChartForm; initialPresentation?: PresentationOverrides }
  | { type: 'setReading'; index: number | null };

export function initialViewState(
  initialForm: ChartForm,
  initialPresentation: PresentationOverrides = {},
): ChartViewState {
  // Fix-wave finding 9: copy, never store the caller's object by reference —
  // the gallery passes `templateById(look).overrides`, a SHARED module
  // constant every card with the same look points at. `setPresentation`'s
  // own merge (`{ ...state.presentation, ...patch }`) never mutates in
  // place, so this was never actually corrupted by a later edit, but storing
  // the reference directly was still one accidental in-place mutation away
  // from silently reskinning every other chart sharing that template.
  return {
    form: initialForm,
    hiddenKeys: new Set(),
    dimmedKeys: new Set(),
    highlightedKey: null,
    periodRange: null,
    presentation: { ...initialPresentation },
    selectedReading: null,
  };
}

export function chartViewReducer(state: ChartViewState, action: ChartViewAction): ChartViewState {
  switch (action.type) {
    case 'setForm':
      return { ...state, form: action.form };
    case 'toggleSeries': {
      const next = new Set(state.hiddenKeys);
      const hiding = !next.has(action.key);
      if (next.has(action.key)) next.delete(action.key);
      else next.add(action.key);
      // Hiding the currently-highlighted series must clear the highlight in
      // the same action: otherwise `highlightedKey` keeps pointing at a
      // series that is no longer drawn, leaving every OTHER visible series
      // dimmed to 0.25 opacity with nothing actually highlighted on screen
      // (#212 review finding). Re-showing a series never touches the
      // highlight -- only the hide direction is coupled.
      const highlightedKey = hiding && state.highlightedKey === action.key ? null : state.highlightedKey;
      return { ...state, hiddenKeys: next, highlightedKey };
    }
    case 'setHighlight':
      return { ...state, highlightedKey: action.key };
    case 'setPeriodRange':
      return { ...state, periodRange: action.range };
    case 'setPresentation':
      return { ...state, presentation: { ...state.presentation, ...action.patch } };
    case 'resetPresentation':
      return { ...state, presentation: {} };
    case 'setView':
      return {
        ...state,
        hiddenKeys: new Set(action.view.hiddenKeys),
        dimmedKeys: new Set(action.view.dimmedKeys),
        highlightedKey: action.view.highlightedKey,
        periodRange: action.view.periodRange,
      };
    case 'setDimmed':
      return { ...state, hiddenKeys: new Set(action.hiddenKeys), dimmedKeys: new Set(action.dimmedKeys) };
    case 'toggleDim': {
      const dimmed = new Set(state.dimmedKeys);
      const hidden = new Set(state.hiddenKeys);
      hidden.delete(action.key);
      if (dimmed.has(action.key)) dimmed.delete(action.key);
      else dimmed.add(action.key);
      return { ...state, hiddenKeys: hidden, dimmedKeys: dimmed };
    }
    case 'setReading':
      return { ...state, selectedReading: action.index };
    case 'reset':
      return initialViewState(action.initialForm, action.initialPresentation);
    default:
      return state;
  }
}

/**
 * Owner decision B (architecture panel, session 88): switching a
 * multi-region "comparison" chart (spec.kind === 'bar', >1 series — one
 * point per region, no time axis) to line form is blocked outright, because
 * a line drawn across regions implies a trend that was never measured. A
 * time series (spec.kind === 'line') may always be shown as a bar; a
 * single-series bar (one region) may always be shown as a line.
 */
export function lineFormAllowed(spec: Pick<ChartSpec, 'kind'>, seriesCount: number): boolean {
  return !(spec.kind === 'bar' && seriesCount > 1);
}

/**
 * WP218 phase 5 (Global Constraints): a filled area encodes magnitude, so it
 * is offered ONLY for a single time series — a multi-series area would cover
 * other series' markers and gaps, and a comparison (bar-kind) has no time
 * axis for a fill to trace across.
 */
export function areaFormAllowed(spec: Pick<ChartSpec, 'kind'>, seriesCount: number): boolean {
  return spec.kind === 'line' && seriesCount === 1;
}

/**
 * WP218 phase 5 (Global Constraints): a horizontal bar is offered ONLY for a
 * comparison (bar-kind spec) — a time series reads chronologically
 * left-to-right, which a category axis of regions would break.
 */
export function hbarFormAllowed(spec: Pick<ChartSpec, 'kind'>): boolean {
  return spec.kind === 'bar';
}

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
export function dumbbellFormAllowed(spec: SeriesShape, seriesCount: number): boolean {
  return seriesCount >= 2 && spec.series.every((s) => s.points.length === 2);
}

/**
 * Phase 5: identical condition to dumbbellFormAllowed, kept as its own named
 * export — matching the one-guard-per-form convention every other form in
 * this file follows — rather than every slope call site reaching for a
 * function named after a different form.
 */
export function slopeFormAllowed(spec: SeriesShape, seriesCount: number): boolean {
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
export function heatmapFormAllowed(spec: SeriesShape, seriesCount: number): boolean {
  return seriesCount >= 2 && spec.series.every((s) => s.points.length >= 2);
}

/**
 * WP218 phase 5 (Global Constraints): "presentation carries over on a type
 * switch ... a form that becomes disallowed after a same-instance spec swap
 * falls back exactly like the existing line->bar guard." One function so
 * both the render (Task 2) and every test share the SAME fallback policy —
 * area falls back to line when line still fits, else bar; hbar falls back
 * to bar; line falls back to bar exactly as before this phase; bar/table are
 * never gated and pass through unchanged. Phase 5 (chart-fit scorer):
 * dumbbell and slope fall back to bar (a two-point comparison that no longer
 * qualifies is still honestly a bar chart); heatmap falls back to table (the
 * grid IS the table's own rows, recoloured — when the grid no longer reads,
 * the table is the view it came from).
 */
export function fallbackForm(
  form: ChartForm,
  spec: Pick<ChartSpec, 'kind'> & SeriesShape,
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

/**
 * Projects `spec` to only the periods within the inclusive [from, to]
 * period-code range — the ONLY new "chart editing" primitive that touches
 * spec data, and it is pure filtering: every point kept is copied verbatim
 * (R6 verbatim-projection is preserved), nothing is recomputed, order is
 * preserved. Returns the SAME reference when range is null (no-op fast
 * path), so callers can safely pass this straight into React state without
 * an extra identity check.
 */
export function windowSpec(spec: ChartSpec, range: [string, string] | null): ChartSpec {
  if (!range) return spec;
  const [from, to] = range;
  return {
    ...spec,
    series: spec.series.map((s) => ({
      ...s,
      points: s.points.filter((p) => p.periodCode >= from && p.periodCode <= to),
    })),
  };
}

/** Pure: given the fetched primary spec, the alternates array and the
 * current selectedReading, which ChartSpec should the chart actually
 * RENDER data from. Out-of-range index (e.g. the alternates array shrank
 * on a re-render) falls back to the primary — never throws, never shows a
 * blank chart. */
export function activeReadingSpec(
  primary: ChartSpec,
  alternates: { label: string; spec: ChartSpec }[],
  selectedReading: number | null,
): ChartSpec {
  if (selectedReading === null) {
    return primary;
  }
  if (selectedReading >= 0 && selectedReading < alternates.length) {
    return alternates[selectedReading].spec;
  }
  return primary;
}
