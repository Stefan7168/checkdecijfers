import { describe, expect, it } from 'vitest';
import {
  chartViewReducer,
  initialViewState,
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
