// Pure, client-only view-state for chart editing (Phases 1-3, open-questions
// #212). Nothing here calls buildChartSpec again, nothing here is ever
// written into an audit record — this module only ever PROJECTS the
// server-built ChartSpec for on-screen display. See docs/decisions/ for the
// full ADR.
import type { ChartSpec } from '../backend/chart/types.ts';
import type { PresentationOverrides } from './chart-presentation.ts';

export type ChartForm = 'line' | 'area' | 'bar' | 'hbar' | 'table';

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
}

export type ChartViewAction =
  | { type: 'setForm'; form: ChartForm }
  | { type: 'toggleSeries'; key: string }
  | { type: 'setHighlight'; key: string | null }
  | { type: 'setPeriodRange'; range: [string, string] | null }
  | { type: 'setPresentation'; patch: PresentationOverrides }
  | { type: 'resetPresentation' }
  | { type: 'reset'; initialForm: ChartForm };

export function initialViewState(initialForm: ChartForm): ChartViewState {
  return { form: initialForm, hiddenKeys: new Set(), highlightedKey: null, periodRange: null, presentation: {} };
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
    case 'reset':
      return initialViewState(action.initialForm);
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
