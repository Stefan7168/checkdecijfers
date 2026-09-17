// Pure, client-only view-state for chart editing (Phases 1-3, open-questions
// #212). Nothing here calls buildChartSpec again, nothing here is ever
// written into an audit record — this module only ever PROJECTS the
// server-built ChartSpec for on-screen display. See docs/decisions/ for the
// full ADR.
import type { ChartSpec } from '../backend/chart/types.ts';
import type { PresentationOverrides } from './chart-presentation.ts';

export type ChartForm = 'line' | 'area' | 'bar' | 'hbar' | 'table';

/** Fix round (Task 5 review, Piece 3): guards an arbitrary value (e.g. the
 * embed route's own `?form=` query-string param) down to a real ChartForm —
 * same convention as messages.ts's own `isLang`. Confirms only that the
 * string is one of the five real enum members; it says nothing about
 * whether that form is actually ALLOWED for a given spec — see
 * lineFormAllowed/areaFormAllowed/hbarFormAllowed for that (ChartView's own
 * `initialFormOverride` prop applies both checks, in that order). */
export function isChartForm(x: unknown): x is ChartForm {
  return x === 'line' || x === 'area' || x === 'bar' || x === 'hbar' || x === 'table';
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

/** #229 (ADR 041 addendum, session 110) + the session 110 many-region-
 * comparison fix: which form `spec` opens on by default, independent of
 * whatever form a viewer currently has selected — the same calc chart.tsx's
 * own `initialForm` uses for a spec's INITIAL render. Above BAR_LABEL_MAX
 * series, a comparison-shaped spec (isComparisonShaped) that is still
 * within COMPARISON_HBAR_MAX regions and allowed to render as a horizontal
 * bar (hbarFormAllowed) opens on 'hbar' — every label is readable on the
 * category axis, so "no chart at all" (the old blanket fall-back to Tabel)
 * was needlessly pessimistic for e.g. a provincie's ~26 gemeenten. Every
 * other case is exactly the pre-session-110 rule: Tabel above
 * BAR_LABEL_MAX, else the spec's own `kind`. Single source of truth — the
 * Embed dialog (chart-embed-dialog.tsx) asks the same question about the
 * publisher's spec without mounting a ChartView, and there is exactly one
 * place this threshold is compared against, never a second, independently-
 * typed copy that could silently drift from the real rule. */
export function defaultFormFor(spec: Pick<ChartSpec, 'kind' | 'series'>): ChartForm {
  if (spec.series.length > BAR_LABEL_MAX) {
    if (isComparisonShaped(spec) && spec.series.length <= COMPARISON_HBAR_MAX && hbarFormAllowed(spec)) {
      return 'hbar';
    }
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
  { type: 'setView'; view: Pick<ChartViewState, 'hiddenKeys' | 'highlightedKey' | 'periodRange'> }
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
        highlightedKey: action.view.highlightedKey,
        periodRange: action.view.periodRange,
      };
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
 * WP218 phase 5 (Global Constraints): "presentation carries over on a type
 * switch ... a form that becomes disallowed after a same-instance spec swap
 * falls back exactly like the existing line->bar guard." One function so
 * both the render (Task 2) and every test share the SAME fallback policy —
 * area falls back to line when line still fits, else bar; hbar falls back
 * to bar; line falls back to bar exactly as before this phase; bar/table are
 * never gated and pass through unchanged.
 */
export function fallbackForm(form: ChartForm, spec: Pick<ChartSpec, 'kind'>, seriesCount: number): ChartForm {
  switch (form) {
    case 'area':
      if (areaFormAllowed(spec, seriesCount)) return 'area';
      return lineFormAllowed(spec, seriesCount) ? 'line' : 'bar';
    case 'hbar':
      return hbarFormAllowed(spec) ? 'hbar' : 'bar';
    case 'line':
      return lineFormAllowed(spec, seriesCount) ? 'line' : 'bar';
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
