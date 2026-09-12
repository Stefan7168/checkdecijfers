import { describe, expect, it } from 'vitest';
import {
  areaFormAllowed,
  chartViewReducer,
  fallbackForm,
  hbarFormAllowed,
  initialViewState,
  isChartForm,
  lineFormAllowed,
  windowSpec,
  type ChartViewState,
} from './chart-view-state.ts';
import type { ChartPoint, ChartSeries, ChartSpec } from '../backend/chart/types.ts';

function point(periodCode: string, value: number): ChartPoint {
  return {
    resultId: `r-${periodCode}`,
    periodCode,
    periodLabel: periodCode,
    value,
    formattedValue: String(value),
    decimals: 0,
    status: 'Definitief',
    provisional: false,
    valueAttribute: 'None',
  };
}

function series(label: string, points: ChartPoint[]): ChartSeries {
  return { label, regionCode: label, points };
}

function spec(kind: 'line' | 'bar', seriesList: ChartSeries[]): ChartSpec {
  return {
    schemaVersion: 1,
    kind,
    title: 'Test',
    dims: {},
    dimLabels: {},
    unit: 'euro',
    series: seriesList,
    provisionalNote: null,
    nullNotes: [],
    definitionLine: null,
    attributionLine: 'CBS · test',
    attribution: {
      tableId: '12345',
      tableTitle: 'Test tabel',
      tableVersion: 1,
      syncedAt: '2026-09-08',
      coveredPeriods: { from: '2015', to: '2024' },
      license: 'CC BY 4.0',
    },
  };
}

describe('initialViewState', () => {
  it('starts with the given form and no filters', () => {
    const state = initialViewState('line');
    expect(state).toEqual<ChartViewState>({
      form: 'line',
      hiddenKeys: new Set(),
      highlightedKey: null,
      periodRange: null,
      presentation: {},
    });
  });
});

describe('chartViewReducer', () => {
  it('setForm switches the form', () => {
    const next = chartViewReducer(initialViewState('line'), { type: 'setForm', form: 'bar' });
    expect(next.form).toBe('bar');
  });

  it('toggleSeries adds then removes a key', () => {
    let state = initialViewState('line');
    state = chartViewReducer(state, { type: 'toggleSeries', key: 's0' });
    expect(state.hiddenKeys.has('s0')).toBe(true);
    state = chartViewReducer(state, { type: 'toggleSeries', key: 's0' });
    expect(state.hiddenKeys.has('s0')).toBe(false);
  });

  it('toggleSeries does not mutate the previous state object', () => {
    const state = initialViewState('line');
    const next = chartViewReducer(state, { type: 'toggleSeries', key: 's0' });
    expect(state.hiddenKeys.has('s0')).toBe(false);
    expect(next).not.toBe(state);
    expect(next.hiddenKeys).not.toBe(state.hiddenKeys);
  });

  it('setHighlight sets and clears the highlighted key', () => {
    let state = initialViewState('line');
    state = chartViewReducer(state, { type: 'setHighlight', key: 's1' });
    expect(state.highlightedKey).toBe('s1');
    state = chartViewReducer(state, { type: 'setHighlight', key: null });
    expect(state.highlightedKey).toBeNull();
  });

  it('toggleSeries clears the highlight when the newly-hidden key was highlighted', () => {
    let state = initialViewState('line');
    state = chartViewReducer(state, { type: 'setHighlight', key: 's0' });
    state = chartViewReducer(state, { type: 'toggleSeries', key: 's0' });
    expect(state.hiddenKeys.has('s0')).toBe(true);
    expect(state.highlightedKey).toBeNull();
  });

  it('toggleSeries leaves an unrelated highlight untouched when hiding a different series', () => {
    let state = initialViewState('line');
    state = chartViewReducer(state, { type: 'setHighlight', key: 's1' });
    state = chartViewReducer(state, { type: 'toggleSeries', key: 's0' });
    expect(state.hiddenKeys.has('s0')).toBe(true);
    expect(state.highlightedKey).toBe('s1');
  });

  it('toggleSeries does not touch the highlight when re-showing the highlighted series', () => {
    let state = initialViewState('line');
    state = chartViewReducer(state, { type: 'toggleSeries', key: 's0' }); // hide s0
    state = chartViewReducer(state, { type: 'setHighlight', key: 's0' }); // highlight while hidden
    state = chartViewReducer(state, { type: 'toggleSeries', key: 's0' }); // show s0 again
    expect(state.hiddenKeys.has('s0')).toBe(false);
    expect(state.highlightedKey).toBe('s0');
  });

  it('setPeriodRange sets and clears the range', () => {
    let state = initialViewState('line');
    state = chartViewReducer(state, { type: 'setPeriodRange', range: ['2018', '2022'] });
    expect(state.periodRange).toEqual(['2018', '2022']);
    state = chartViewReducer(state, { type: 'setPeriodRange', range: null });
    expect(state.periodRange).toBeNull();
  });

  it('reset returns a fresh state for the given initial form, dropping all filters', () => {
    let state = initialViewState('line');
    state = chartViewReducer(state, { type: 'toggleSeries', key: 's0' });
    state = chartViewReducer(state, { type: 'setPeriodRange', range: ['2018', '2022'] });
    state = chartViewReducer(state, { type: 'reset', initialForm: 'bar' });
    expect(state).toEqual<ChartViewState>({
      form: 'bar',
      hiddenKeys: new Set(),
      highlightedKey: null,
      periodRange: null,
      presentation: {},
    });
  });
});

describe('lineFormAllowed', () => {
  it('allows line form for a line-kind spec regardless of series count', () => {
    expect(lineFormAllowed({ kind: 'line' }, 1)).toBe(true);
    expect(lineFormAllowed({ kind: 'line' }, 5)).toBe(true);
  });

  it('allows line form for a single-series bar-kind spec', () => {
    expect(lineFormAllowed({ kind: 'bar' }, 1)).toBe(true);
  });

  it('blocks line form for a multi-series bar-kind (comparison) spec', () => {
    expect(lineFormAllowed({ kind: 'bar' }, 2)).toBe(false);
    expect(lineFormAllowed({ kind: 'bar' }, 8)).toBe(false);
  });
});

// WP218 phase 5: four representative spec shapes exercised against every
// guard and against `fallbackForm` — S1/S2 are line-kind (a single time
// series, a multi-series time series), S3/S4 are bar-kind (a multi-region
// comparison, a single-region "comparison" of one). Naming matches the
// phase-5 plan (docs/superpowers/plans/2026-09-09-wp218-phase-5-chart-types.md)
// so a reviewer can cross-reference the guards table 1:1.
const S1 = { kind: 'line' as const, seriesCount: 1 }; // single-series time series
const S2 = { kind: 'line' as const, seriesCount: 2 }; // multi-series time series
const S3 = { kind: 'bar' as const, seriesCount: 2 }; // multi-region comparison
const S4 = { kind: 'bar' as const, seriesCount: 1 }; // single-region comparison

describe('areaFormAllowed — single-series time series only (fill encodes magnitude)', () => {
  it('S1 (single-series line): allowed', () => {
    expect(areaFormAllowed({ kind: S1.kind }, S1.seriesCount)).toBe(true);
  });
  it('S2 (multi-series line): blocked — filled areas would cover each other', () => {
    expect(areaFormAllowed({ kind: S2.kind }, S2.seriesCount)).toBe(false);
  });
  it('S3 (multi-region comparison): blocked — a comparison has no time axis', () => {
    expect(areaFormAllowed({ kind: S3.kind }, S3.seriesCount)).toBe(false);
  });
  it('S4 (single-region comparison): blocked — still a comparison, not a time series', () => {
    expect(areaFormAllowed({ kind: S4.kind }, S4.seriesCount)).toBe(false);
  });
});

describe('hbarFormAllowed — comparisons only (bar-kind specs)', () => {
  it('S1 (single-series line): blocked', () => {
    expect(hbarFormAllowed({ kind: S1.kind })).toBe(false);
  });
  it('S2 (multi-series line): blocked', () => {
    expect(hbarFormAllowed({ kind: S2.kind })).toBe(false);
  });
  it('S3 (multi-region comparison): allowed', () => {
    expect(hbarFormAllowed({ kind: S3.kind })).toBe(true);
  });
  it('S4 (single-region comparison): allowed', () => {
    expect(hbarFormAllowed({ kind: S4.kind })).toBe(true);
  });
});

describe('guards table — S1/S2/S3/S4 x forms (line/area/bar/hbar/table)', () => {
  it('S1: only hbar is disallowed', () => {
    expect(lineFormAllowed({ kind: S1.kind }, S1.seriesCount)).toBe(true);
    expect(areaFormAllowed({ kind: S1.kind }, S1.seriesCount)).toBe(true);
    expect(hbarFormAllowed({ kind: S1.kind })).toBe(false);
  });
  it('S2: area and hbar are disallowed', () => {
    expect(lineFormAllowed({ kind: S2.kind }, S2.seriesCount)).toBe(true);
    expect(areaFormAllowed({ kind: S2.kind }, S2.seriesCount)).toBe(false);
    expect(hbarFormAllowed({ kind: S2.kind })).toBe(false);
  });
  it('S3: line and area are disallowed', () => {
    expect(lineFormAllowed({ kind: S3.kind }, S3.seriesCount)).toBe(false);
    expect(areaFormAllowed({ kind: S3.kind }, S3.seriesCount)).toBe(false);
    expect(hbarFormAllowed({ kind: S3.kind })).toBe(true);
  });
  it('S4: only area is disallowed', () => {
    expect(lineFormAllowed({ kind: S4.kind }, S4.seriesCount)).toBe(true);
    expect(areaFormAllowed({ kind: S4.kind }, S4.seriesCount)).toBe(false);
    expect(hbarFormAllowed({ kind: S4.kind })).toBe(true);
  });
  // bar and table are never gated — every spec shape may always show as
  // either, mirroring the existing FORM_ORDER (`['line'?, 'bar', 'table']`).
});

describe('fallbackForm', () => {
  it('area stays area when allowed (S1)', () => {
    expect(fallbackForm('area', { kind: S1.kind }, S1.seriesCount)).toBe('area');
  });
  it('area falls back to line when disallowed but line is allowed (S2, S4)', () => {
    expect(fallbackForm('area', { kind: S2.kind }, S2.seriesCount)).toBe('line');
    expect(fallbackForm('area', { kind: S4.kind }, S4.seriesCount)).toBe('line');
  });
  it('area falls back to bar when neither area nor line is allowed (S3)', () => {
    expect(fallbackForm('area', { kind: S3.kind }, S3.seriesCount)).toBe('bar');
  });
  it('hbar stays hbar when allowed (S3, S4)', () => {
    expect(fallbackForm('hbar', { kind: S3.kind }, S3.seriesCount)).toBe('hbar');
    expect(fallbackForm('hbar', { kind: S4.kind }, S4.seriesCount)).toBe('hbar');
  });
  it('hbar falls back to bar when disallowed (S1, S2)', () => {
    expect(fallbackForm('hbar', { kind: S1.kind }, S1.seriesCount)).toBe('bar');
    expect(fallbackForm('hbar', { kind: S2.kind }, S2.seriesCount)).toBe('bar');
  });
  it('line falls back to bar exactly like the existing guard (S3), stays line otherwise', () => {
    expect(fallbackForm('line', { kind: S3.kind }, S3.seriesCount)).toBe('bar');
    expect(fallbackForm('line', { kind: S1.kind }, S1.seriesCount)).toBe('line');
    expect(fallbackForm('line', { kind: S4.kind }, S4.seriesCount)).toBe('line');
  });
  it('bar and table are always unchanged, on every spec shape', () => {
    for (const s of [S1, S2, S3, S4]) {
      expect(fallbackForm('bar', { kind: s.kind }, s.seriesCount)).toBe('bar');
      expect(fallbackForm('table', { kind: s.kind }, s.seriesCount)).toBe('table');
    }
  });
});

describe('chartViewReducer — setForm accepts the two new forms (no other change)', () => {
  it('setForm switches to area', () => {
    const next = chartViewReducer(initialViewState('line'), { type: 'setForm', form: 'area' });
    expect(next.form).toBe('area');
  });
  it('setForm switches to hbar', () => {
    const next = chartViewReducer(initialViewState('bar'), { type: 'setForm', form: 'hbar' });
    expect(next.form).toBe('hbar');
  });
});

// Fix round (Task 5 review, Piece 3): the embed route's own `?form=` guard.
describe('isChartForm (fix round, Piece 3)', () => {
  it('accepts every real ChartForm member', () => {
    for (const form of ['line', 'area', 'bar', 'hbar', 'table']) {
      expect(isChartForm(form)).toBe(true);
    }
  });

  it('rejects anything else, including near-misses and non-strings', () => {
    expect(isChartForm('Line')).toBe(false);
    expect(isChartForm('pie')).toBe(false);
    expect(isChartForm('')).toBe(false);
    expect(isChartForm(undefined)).toBe(false);
    expect(isChartForm(null)).toBe(false);
    expect(isChartForm(42)).toBe(false);
  });
});

describe('windowSpec', () => {
  it('returns the same reference when range is null', () => {
    const s = spec('line', [series('NL', [point('2020', 1), point('2021', 2)])]);
    expect(windowSpec(s, null)).toBe(s);
  });

  it('filters every series to the inclusive period range, preserving order', () => {
    const s = spec('line', [
      series('NL', [point('2018', 1), point('2019', 2), point('2020', 3), point('2021', 4)]),
    ]);
    const windowed = windowSpec(s, ['2019', '2020']);
    expect(windowed.series[0].points.map((p) => p.periodCode)).toEqual(['2019', '2020']);
    // Original untouched.
    expect(s.series[0].points).toHaveLength(4);
  });

  it('does not mutate the original spec object', () => {
    const s = spec('line', [series('NL', [point('2020', 1)])]);
    const before = JSON.stringify(s);
    windowSpec(s, ['2020', '2020']);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('preserves every other field (attribution, unit, kind) unchanged', () => {
    const s = spec('bar', [series('NL', [point('2020', 1)])]);
    const windowed = windowSpec(s, ['2020', '2020']);
    expect(windowed.attribution).toBe(s.attribution);
    expect(windowed.unit).toBe(s.unit);
    expect(windowed.kind).toBe(s.kind);
  });
});

describe('presentation slice (WP218)', () => {
  it('starts empty', () => {
    expect(initialViewState('line').presentation).toEqual({});
  });
  it('setPresentation merges a patch shallowly (a later key wins, others survive)', () => {
    let s = initialViewState('line');
    s = chartViewReducer(s, { type: 'setPresentation', patch: { lineWidth: 'thick' } });
    s = chartViewReducer(s, { type: 'setPresentation', patch: { grid: 'none' } });
    expect(s.presentation).toEqual({ lineWidth: 'thick', grid: 'none' });
    s = chartViewReducer(s, { type: 'setPresentation', patch: { lineWidth: 'thin' } });
    expect(s.presentation.lineWidth).toBe('thin');
  });
  it('setPresentation replaces seriesColors wholesale (the panel computes the new map)', () => {
    let s = initialViewState('line');
    s = chartViewReducer(s, { type: 'setPresentation', patch: { seriesColors: { 0: '#ff0000', 1: '#00ff00' } } });
    s = chartViewReducer(s, { type: 'setPresentation', patch: { seriesColors: { 1: '#0000ff' } } });
    expect(s.presentation.seriesColors).toEqual({ 1: '#0000ff' });
  });
  it('resetPresentation clears only the presentation, keeping form/zoom/hidden series', () => {
    let s = initialViewState('line');
    s = chartViewReducer(s, { type: 'setForm', form: 'bar' });
    s = chartViewReducer(s, { type: 'toggleSeries', key: 's0' });
    s = chartViewReducer(s, { type: 'setPresentation', patch: { grid: 'none' } });
    s = chartViewReducer(s, { type: 'resetPresentation' });
    expect(s.presentation).toEqual({});
    expect(s.form).toBe('bar');
    expect(s.hiddenKeys.has('s0')).toBe(true);
  });
  it('reset (a spec swap on the same mounted chart) clears the presentation — owner decision E: each chart starts fresh', () => {
    let s = initialViewState('line');
    s = chartViewReducer(s, { type: 'setPresentation', patch: { lineWidth: 'thick' } });
    s = chartViewReducer(s, { type: 'reset', initialForm: 'line' });
    expect(s.presentation).toEqual({});
  });

  // #237/ADR 046: a chart mounted with `initialPresentation` (the gallery's
  // story template) must fall back to THAT on a spec swap, not to `{}` —
  // otherwise a gallery story that ever re-mounted with a new spec on the
  // same instance would drop its look. Owner decision E above is untouched:
  // `onReset` (the "Standaard" button, `resetPresentation`) still always
  // clears to `{}` regardless of what the chart mounted with.
  it('initialViewState honours an initial presentation, and reset falls back to it (not {}) when given one', () => {
    const initial = { markers: 'ends' as const };
    let s = initialViewState('line', initial);
    expect(s.presentation).toEqual(initial);
    s = chartViewReducer(s, { type: 'setPresentation', patch: { lineWidth: 'thick' } });
    s = chartViewReducer(s, { type: 'reset', initialForm: 'line', initialPresentation: initial });
    expect(s.presentation).toEqual(initial);
  });

  it('reset with no initialPresentation still clears to {} (unchanged default)', () => {
    let s = initialViewState('line');
    s = chartViewReducer(s, { type: 'setPresentation', patch: { lineWidth: 'thick' } });
    s = chartViewReducer(s, { type: 'reset', initialForm: 'line' });
    expect(s.presentation).toEqual({});
  });
});

describe('setView (story mode: restore the reader\'s own view in one action)', () => {
  it('replaces hiddenKeys, highlightedKey and periodRange together and leaves form and presentation alone', () => {
    let state = initialViewState('line');
    state = chartViewReducer(state, { type: 'setForm', form: 'area' });
    state = chartViewReducer(state, { type: 'setPresentation', patch: { lineWidth: 'thick' } });
    state = chartViewReducer(state, { type: 'toggleSeries', key: 's1' });
    state = chartViewReducer(state, {
      type: 'setView',
      view: { hiddenKeys: new Set(['s2']), highlightedKey: 's0', periodRange: ['2020JJ00', '2022JJ00'] },
    });
    expect(state.form).toBe('area');
    expect(state.presentation).toEqual({ lineWidth: 'thick' });
    expect([...state.hiddenKeys]).toEqual(['s2']);
    expect(state.highlightedKey).toBe('s0');
    expect(state.periodRange).toEqual(['2020JJ00', '2022JJ00']);
  });

  it('copies the given Set, so a later mutation of the caller\'s Set never leaks into state', () => {
    const hidden = new Set(['s1']);
    const state = chartViewReducer(initialViewState('line'), { type: 'setView', view: { hiddenKeys: hidden, highlightedKey: null, periodRange: null } });
    hidden.add('s2');
    expect([...state.hiddenKeys]).toEqual(['s1']);
  });
});
