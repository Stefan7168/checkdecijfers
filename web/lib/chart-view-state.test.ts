import { describe, expect, it } from 'vitest';
import {
  activeReadingSpec,
  areaFormAllowed,
  BAR_LABEL_MAX,
  chartViewReducer,
  COMPARISON_HBAR_MAX,
  defaultFormFor,
  defaultFormIsTable,
  dumbbellFormAllowed,
  fallbackForm,
  hbarFormAllowed,
  heatmapFormAllowed,
  initialViewState,
  isChartForm,
  isComparisonShaped,
  lineFormAllowed,
  ownDataFallbackForm,
  ownDataPieFormAllowed,
  ownDataStacked100FormAllowed,
  ownDataStackedFormAllowed,
  pieFormAllowed,
  slopeFormAllowed,
  stacked100FormAllowed,
  stackedFormAllowed,
  windowSpec,
  type ChartViewState,
} from './chart-view-state.ts';
import type { ChartPoint, ChartSeries, ChartSpec } from '../backend/chart/types.ts';
import type { RegionScope } from '../backend/query/index.ts';

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
      dimmedKeys: new Set(),
      highlightedKey: null,
      periodRange: null,
      presentation: {},
      selectedReading: null,
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
      selectedReading: null,
      dimmedKeys: new Set(),
    });
  });

  it('setDimmed replaces hiddenKeys and dimmedKeys together', () => {
    const state = { ...initialViewState('line'), hiddenKeys: new Set(['s0']) };
    const next = chartViewReducer(state, { type: 'setDimmed', hiddenKeys: [], dimmedKeys: ['s1'] });
    expect(next.hiddenKeys).toEqual(new Set());
    expect(next.dimmedKeys).toEqual(new Set(['s1']));
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

/** Phase 5 (chart-fit scorer): `fallbackForm` now also reads `series` (for
 * the dumbbell/slope/heatmap cases), so the S1-S4 shapes are materialised
 * into a real spec — `pointsPerSeries` defaults to 3, a plain multi-point
 * time series that qualifies for none of the two-point forms, so the
 * pre-existing area/hbar/line/bar/table expectations are unaffected. */
function shaped(kind: 'line' | 'bar', seriesCount: number, pointsPerSeries = 3): ChartSpec {
  return spec(
    kind,
    Array.from({ length: seriesCount }, (_, i) =>
      series(
        `S${i}`,
        Array.from({ length: pointsPerSeries }, (_, p) => point(`202${p}`, i + p)),
      ),
    ),
  );
}
function specFor(s: { kind: 'line' | 'bar'; seriesCount: number }): ChartSpec {
  return shaped(s.kind, s.seriesCount);
}

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

// Phase 5 (chart-fit scorer, session 116; spec §10): the three new guards
// read the SERIES shape, not `kind` — a two-point comparison of ≥2 things
// (dumbbell/slope) or a ≥2 × ≥2 grid (heatmap).
describe('dumbbellFormAllowed — exactly two points per series, at least two series', () => {
  it('allowed for a genuine 2-series / 2-point-each spec', () => {
    expect(dumbbellFormAllowed(shaped('line', 2, 2), 2)).toBe(true);
    expect(dumbbellFormAllowed(shaped('bar', 3, 2), 3)).toBe(true);
  });
  it('refused for a single series, even with exactly two points', () => {
    expect(dumbbellFormAllowed(shaped('line', 1, 2), 1)).toBe(false);
  });
  it('refused when any series carries three (or more) points', () => {
    expect(dumbbellFormAllowed(shaped('line', 2, 3), 2)).toBe(false);
    const ragged = spec('line', [series('A', [point('2020', 1), point('2021', 2)]), series('B', [point('2020', 3), point('2021', 4), point('2022', 5)])]);
    expect(dumbbellFormAllowed(ragged, 2)).toBe(false);
  });
  it('refused for a one-point comparison (that is hbar territory)', () => {
    expect(dumbbellFormAllowed(shaped('bar', 4, 1), 4)).toBe(false);
  });
  // Task 3 tightening: a dumbbell draws exactly two dots per row, so a
  // missing (null) value has no honest place on it — the form is refused,
  // not drawn with a gap.
  it('refused when any point in any series has a null value (Task 3)', () => {
    const nullEnd = spec('line', [
      series('A', [point('2020', 1), point('2021', 2)]),
      series('B', [point('2020', 3), { ...point('2021', 4), value: null, formattedValue: null }]),
    ]);
    expect(dumbbellFormAllowed(nullEnd, 2)).toBe(false);
    expect(slopeFormAllowed(nullEnd, 2)).toBe(false);
    const nullStart = spec('line', [
      series('A', [{ ...point('2020', 1), value: null, formattedValue: null }, point('2021', 2)]),
      series('B', [point('2020', 3), point('2021', 4)]),
    ]);
    expect(dumbbellFormAllowed(nullStart, 2)).toBe(false);
  });
});

describe('slopeFormAllowed — the same condition as dumbbell, by construction', () => {
  it('agrees with dumbbellFormAllowed on every shape', () => {
    for (const s of [shaped('line', 2, 2), shaped('bar', 3, 2), shaped('line', 1, 2), shaped('line', 2, 3), shaped('bar', 4, 1)]) {
      expect(slopeFormAllowed(s, s.series.length)).toBe(dumbbellFormAllowed(s, s.series.length));
    }
  });
  it('allowed for a 2-series / 2-point spec, refused for 1 series or 3 points', () => {
    expect(slopeFormAllowed(shaped('line', 2, 2), 2)).toBe(true);
    expect(slopeFormAllowed(shaped('line', 1, 2), 1)).toBe(false);
    expect(slopeFormAllowed(shaped('line', 2, 3), 2)).toBe(false);
  });
});

describe('heatmapFormAllowed — at least two series AND at least two points each', () => {
  it('allowed for a 2-series / 2-point spec and for a wider grid', () => {
    expect(heatmapFormAllowed(shaped('line', 2, 2), 2)).toBe(true);
    expect(heatmapFormAllowed(shaped('line', 5, 10), 5)).toBe(true);
  });
  it('refused for a single series (one row is not a grid)', () => {
    expect(heatmapFormAllowed(shaped('line', 1, 10), 1)).toBe(false);
  });
  it('refused when every series has one point (one column is not a grid)', () => {
    expect(heatmapFormAllowed(shaped('bar', 12, 1), 12)).toBe(false);
  });
  it('refused when ANY series is down to a single point', () => {
    const ragged = spec('line', [series('A', [point('2020', 1), point('2021', 2)]), series('B', [point('2020', 3)])]);
    expect(heatmapFormAllowed(ragged, 2)).toBe(false);
  });
  it('refused when any cell would have a null value (Task 3 tightening — nothing honest to colour)', () => {
    const withNull = spec('line', [
      series('A', [point('2020', 1), point('2021', 2), point('2022', 3)]),
      series('B', [point('2020', 3), { ...point('2021', 4), value: null, formattedValue: null }, point('2022', 5)]),
    ]);
    expect(heatmapFormAllowed(withNull, 2)).toBe(false);
  });
  it('refused when the series do not cover the same periods (Task 4 tightening — an intersection with no cell)', () => {
    // Both series have two real-valued points, but only 2020 is shared: the
    // grid would need a 2019 cell for A and a 2021 cell for B that no point
    // backs. The table form shows such a gap as a gap; the heatmap refuses.
    const ragged = spec('line', [
      series('A', [point('2020', 1), point('2021', 2)]),
      series('B', [point('2019', 3), point('2020', 4)]),
    ]);
    expect(heatmapFormAllowed(ragged, 2)).toBe(false);
    // A duplicate period inside one series is not "covering" it twice.
    const duplicated = spec('line', [
      series('A', [point('2020', 1), point('2020', 2)]),
      series('B', [point('2020', 3), point('2021', 4)]),
    ]);
    expect(heatmapFormAllowed(duplicated, 2)).toBe(false);
  });
});

describe('fallbackForm', () => {
  it('area stays area when allowed (S1)', () => {
    expect(fallbackForm('area', specFor(S1), S1.seriesCount)).toBe('area');
  });
  it('area falls back to line when disallowed but line is allowed (S2, S4)', () => {
    expect(fallbackForm('area', specFor(S2), S2.seriesCount)).toBe('line');
    expect(fallbackForm('area', specFor(S4), S4.seriesCount)).toBe('line');
  });
  it('area falls back to bar when neither area nor line is allowed (S3)', () => {
    expect(fallbackForm('area', specFor(S3), S3.seriesCount)).toBe('bar');
  });
  it('hbar stays hbar when allowed (S3, S4)', () => {
    expect(fallbackForm('hbar', specFor(S3), S3.seriesCount)).toBe('hbar');
    expect(fallbackForm('hbar', specFor(S4), S4.seriesCount)).toBe('hbar');
  });
  it('hbar falls back to bar when disallowed (S1, S2)', () => {
    expect(fallbackForm('hbar', specFor(S1), S1.seriesCount)).toBe('bar');
    expect(fallbackForm('hbar', specFor(S2), S2.seriesCount)).toBe('bar');
  });
  it('line falls back to bar exactly like the existing guard (S3), stays line otherwise', () => {
    expect(fallbackForm('line', specFor(S3), S3.seriesCount)).toBe('bar');
    expect(fallbackForm('line', specFor(S1), S1.seriesCount)).toBe('line');
    expect(fallbackForm('line', specFor(S4), S4.seriesCount)).toBe('line');
  });
  it('bar and table are always unchanged, on every spec shape', () => {
    for (const s of [S1, S2, S3, S4]) {
      expect(fallbackForm('bar', specFor(s), s.seriesCount)).toBe('bar');
      expect(fallbackForm('table', specFor(s), s.seriesCount)).toBe('table');
    }
  });

  // Phase 5 (chart-fit scorer): the three new forms — a document state that
  // still says 'dumbbell' after the reader widened the zoom back out (or a
  // spec swap on the same instance) must land on an honest form, never stay
  // on a shape the spec no longer qualifies for.
  it('dumbbell and slope stay themselves while the spec still has exactly two points per series', () => {
    expect(fallbackForm('dumbbell', shaped('line', 2, 2), 2)).toBe('dumbbell');
    expect(fallbackForm('slope', shaped('line', 2, 2), 2)).toBe('slope');
  });
  it('dumbbell falls back to bar once the spec no longer qualifies (three points, or one series)', () => {
    expect(fallbackForm('dumbbell', shaped('line', 2, 3), 2)).toBe('bar');
    expect(fallbackForm('dumbbell', shaped('line', 1, 2), 1)).toBe('bar');
  });
  it('slope falls back to bar once the spec no longer qualifies', () => {
    expect(fallbackForm('slope', shaped('line', 2, 3), 2)).toBe('bar');
    expect(fallbackForm('slope', shaped('bar', 1, 2), 1)).toBe('bar');
  });
  it('heatmap stays heatmap on a ≥2 × ≥2 grid and falls back to table below it', () => {
    expect(fallbackForm('heatmap', shaped('line', 2, 2), 2)).toBe('heatmap');
    expect(fallbackForm('heatmap', shaped('line', 3, 8), 3)).toBe('heatmap');
    expect(fallbackForm('heatmap', shaped('line', 1, 8), 1)).toBe('table');
    expect(fallbackForm('heatmap', shaped('bar', 12, 1), 12)).toBe('table');
  });

  // Phase 5b (verified-whole): the three roster-only forms fall back to
  // table — like the heatmap, "a different way of looking at the same rows".
  it('pie stays pie on a single-moment roster and falls back to table once the window spans several periods or the scope is gone', () => {
    expect(fallbackForm('pie', rosterSpec(ALL_PROVINCIES, 12, 1), 12)).toBe('pie');
    expect(fallbackForm('pie', rosterSpec(ALL_PROVINCIES, 12, 3), 12)).toBe('table');
    expect(fallbackForm('pie', { ...shaped('bar', 12, 1), regionScope: null }, 12)).toBe('table');
  });
  it('stacked and stacked100 stay themselves on any roster (one moment or several) and fall back to table without a scope', () => {
    expect(fallbackForm('stacked', rosterSpec(ALL_PROVINCIES, 12, 1), 12)).toBe('stacked');
    expect(fallbackForm('stacked', rosterSpec(ALL_PROVINCIES, 12, 3), 12)).toBe('stacked');
    expect(fallbackForm('stacked100', rosterSpec(ALL_PROVINCIES, 12, 3), 12)).toBe('stacked100');
    expect(fallbackForm('stacked', { ...shaped('bar', 12, 3), regionScope: null }, 12)).toBe('table');
    expect(fallbackForm('stacked100', { ...shaped('bar', 12, 3), regionScope: null }, 12)).toBe('table');
    // A spec with NO regionScope key at all (a PlottableSpec, a pre-phase-5b
    // stored spec) reads the same as null.
    expect(fallbackForm('stacked', shaped('bar', 12, 3), 12)).toBe('table');
    expect(fallbackForm('pie', shaped('bar', 12, 1), 12)).toBe('table');
  });
});

// Phase 5b (the verified whole, session 117, spec §11): the three guards
// read PROVENANCE — `spec.regionScope`, written by buildChartSpec only for a
// region-class answer (all provincies, all landsdelen, the gemeenten of one
// provincie, …) — plus the series shape. They never look at the region
// codes themselves and never verify the sum (that runs on demand, server
// side, in Task 4).
const ALL_PROVINCIES: RegionScope = { kind: 'all_provincies' };
const ALL_LANDSDELEN: RegionScope = { kind: 'all_landsdelen' };
const GEMEENTEN_IN_UTRECHT: RegionScope = { kind: 'gemeenten_in_provincie', parent: 'PV26' };
const ALL_GEMEENTEN: RegionScope = { kind: 'all_gemeenten' };

/** The twelve real CBS province codes — exactly the roster `all_provincies`
 * resolves to. Used by the provenance test below to build a chart whose
 * codes MATCH a complete roster while its `regionScope` is null. */
const PROVINCE_CODES = ['PV20', 'PV21', 'PV22', 'PV23', 'PV24', 'PV25', 'PV26', 'PV27', 'PV28', 'PV29', 'PV30', 'PV31'] as const;

/** A `shaped` spec stamped with a real roster provenance. */
function rosterSpec(scope: RegionScope, seriesCount: number, pointsPerSeries: number): ChartSpec {
  return { ...shaped('bar', seriesCount, pointsPerSeries), regionScope: scope };
}

/** A hand-picked comparison over the SAME twelve province codes, built the
 * way a `comparison`/`regions: [...]` answer would be: explicit null scope. */
function handPickedProvinces(pointsPerSeries: number): ChartSpec {
  return {
    ...spec(
      'bar',
      PROVINCE_CODES.map((code, i) =>
        series(
          code,
          Array.from({ length: pointsPerSeries }, (_, p) => point(`202${p}`, i + p)),
        ),
      ),
    ),
    regionScope: null,
  };
}

describe('pieFormAllowed — a complete CBS roster, one moment, at least two slices', () => {
  it('allowed for a single-moment roster of every verifiable scope kind', () => {
    expect(pieFormAllowed(rosterSpec(ALL_PROVINCIES, 12, 1), 12)).toBe(true);
    expect(pieFormAllowed(rosterSpec(ALL_LANDSDELEN, 4, 1), 4)).toBe(true);
    expect(pieFormAllowed(rosterSpec(GEMEENTEN_IN_UTRECHT, 26, 1), 26)).toBe(true);
  });
  it('is purely structural: all_gemeenten (no verified-whole parent) still passes the guard — the on-demand check, not this guard, refuses it', () => {
    // The field is provenance, not a pre-filtered "verifiable" list (Task 2's
    // own note); `parentCellRef` returning null for this scope is Task 1/4's
    // concern. The guard reads "is there a scope", nothing more.
    expect(pieFormAllowed(rosterSpec(ALL_GEMEENTEN, 342, 1), 342)).toBe(true);
  });
  it('refused once any series carries more than one point — a pie shows ONE moment', () => {
    expect(pieFormAllowed(rosterSpec(ALL_PROVINCIES, 12, 2), 12)).toBe(false);
    expect(pieFormAllowed(rosterSpec(ALL_PROVINCIES, 12, 3), 12)).toBe(false);
    const ragged: ChartSpec = {
      ...spec('bar', [series('A', [point('2020', 1)]), series('B', [point('2020', 2), point('2021', 3)])]),
      regionScope: ALL_LANDSDELEN,
    };
    expect(pieFormAllowed(ragged, 2)).toBe(false);
  });
  it('refused for a single series, even with a real scope (one slice is not a breakdown)', () => {
    expect(pieFormAllowed(rosterSpec(ALL_PROVINCIES, 1, 1), 1)).toBe(false);
  });
  it('refused for a null scope (a named region, a hand-picked list, a national series) — whatever the shape', () => {
    expect(pieFormAllowed({ ...shaped('bar', 12, 1), regionScope: null }, 12)).toBe(false);
    expect(pieFormAllowed({ ...shaped('bar', 2, 1), regionScope: null }, 2)).toBe(false);
  });
  it('refused when the regionScope key is absent altogether (a PlottableSpec, a spec stored before the field existed)', () => {
    expect(pieFormAllowed(shaped('bar', 12, 1), 12)).toBe(false);
  });
});

describe('stackedFormAllowed / stacked100FormAllowed — a complete CBS roster, any number of moments, at least two series', () => {
  it('allowed for a roster at one moment AND across several periods (one stack per period)', () => {
    expect(stackedFormAllowed(rosterSpec(ALL_PROVINCIES, 12, 1), 12)).toBe(true);
    expect(stackedFormAllowed(rosterSpec(ALL_PROVINCIES, 12, 5), 12)).toBe(true);
    expect(stackedFormAllowed(rosterSpec(ALL_LANDSDELEN, 4, 3), 4)).toBe(true);
    expect(stackedFormAllowed(rosterSpec(GEMEENTEN_IN_UTRECHT, 26, 2), 26)).toBe(true);
  });
  it('stacked100 agrees with stacked on every shape, by construction', () => {
    for (const s of [
      rosterSpec(ALL_PROVINCIES, 12, 1),
      rosterSpec(ALL_PROVINCIES, 12, 5),
      rosterSpec(ALL_LANDSDELEN, 1, 3),
      { ...shaped('bar', 12, 3), regionScope: null },
      shaped('bar', 12, 3),
    ]) {
      expect(stacked100FormAllowed(s, s.series.length)).toBe(stackedFormAllowed(s, s.series.length));
    }
  });
  it('refused for a single series, even with a real scope (nothing to stack)', () => {
    expect(stackedFormAllowed(rosterSpec(ALL_PROVINCIES, 1, 3), 1)).toBe(false);
    expect(stacked100FormAllowed(rosterSpec(ALL_PROVINCIES, 1, 3), 1)).toBe(false);
  });
  it('refused for a null or absent scope, whatever the shape', () => {
    expect(stackedFormAllowed({ ...shaped('bar', 12, 3), regionScope: null }, 12)).toBe(false);
    expect(stackedFormAllowed(shaped('bar', 12, 3), 12)).toBe(false);
    expect(stacked100FormAllowed({ ...shaped('line', 4, 3), regionScope: null }, 4)).toBe(false);
  });
});

// The contract test spec §11 calls for ("provenance, not code-list
// equality"): a chart whose region CODES are exactly the twelve provinces,
// but which was built from a hand-picked list (`regionScope: null`) rather
// than through `resolveRegionSet`, must still refuse all three forms. CBS
// never vouched that those twelve are complete for THIS table/period; only
// the roster path records that. The identical shape WITH the scope is
// allowed — proving it is the provenance field alone, not the codes, that
// the guards read.
describe('provenance, not codes (spec §11 contract): a hand-picked subset matching a complete roster still refuses', () => {
  it('the twelve province codes with a null scope refuse pie, stacked and stacked100', () => {
    const oneMoment = handPickedProvinces(1);
    expect(oneMoment.series.map((s) => s.regionCode)).toEqual([...PROVINCE_CODES]);
    expect(oneMoment.regionScope).toBeNull();
    expect(pieFormAllowed(oneMoment, 12)).toBe(false);
    expect(stackedFormAllowed(oneMoment, 12)).toBe(false);
    expect(stacked100FormAllowed(oneMoment, 12)).toBe(false);
    const severalMoments = handPickedProvinces(3);
    expect(stackedFormAllowed(severalMoments, 12)).toBe(false);
    expect(stacked100FormAllowed(severalMoments, 12)).toBe(false);
    // And fallbackForm sends every one of them to the table.
    for (const form of ['pie', 'stacked', 'stacked100'] as const) {
      expect(fallbackForm(form, oneMoment, 12), form).toBe('table');
    }
  });
  it('the SAME twelve codes and shape, built through the roster path (a real scope), are allowed — only the provenance differs', () => {
    const viaRoster: ChartSpec = { ...handPickedProvinces(1), regionScope: ALL_PROVINCIES };
    expect(pieFormAllowed(viaRoster, 12)).toBe(true);
    expect(stackedFormAllowed(viaRoster, 12)).toBe(true);
    expect(stacked100FormAllowed(viaRoster, 12)).toBe(true);
  });
});

// Own-data chart-fit + verified-whole parity (plan 2026-09-22, Task 3): the
// own-data card's OWN whole-form guards — the SAME shape conditions the three
// CBS guards above AND with their roster check, MINUS that check entirely.
// They are typed on the bare `SeriesShape`, so they cannot even read
// `regionScope`: an own-data chart has no registry to check a whole against,
// the forms are unconditional on shape, and the honesty lives in the note the
// card renders under them (user-chart.tsx), never in a gate. Separately named
// on purpose — never one shared guard with a "verified" flag.
describe('ownDataPieFormAllowed / ownDataStackedFormAllowed / ownDataStacked100FormAllowed — shape only, never provenance (own-data parity, Task 3)', () => {
  it('pie: one moment, at least two series — allowed with no regionScope key at all (a PlottableSpec), an explicit null AND a real roster alike: provenance makes no difference', () => {
    expect(ownDataPieFormAllowed(shaped('bar', 2, 1), 2)).toBe(true);
    expect(ownDataPieFormAllowed(shaped('bar', 12, 1), 12)).toBe(true);
    // Through a typed const, not an inline literal: the guard's parameter is
    // the bare `SeriesShape`, so TypeScript's excess-property check rejects
    // a fresh literal that names `regionScope` at all — the compile-time
    // proof that the guard cannot even see provenance.
    const explicitNull: ChartSpec = { ...shaped('bar', 2, 1), regionScope: null };
    expect(ownDataPieFormAllowed(explicitNull, 2)).toBe(true);
    expect(ownDataPieFormAllowed(rosterSpec(ALL_PROVINCIES, 12, 1), 12)).toBe(true);
    // The guard reads point shape, never `kind`: a line-kind spec whose
    // series each hold one point is pie-shaped too.
    expect(ownDataPieFormAllowed(shaped('line', 3, 1), 3)).toBe(true);
  });
  it('pie: refused once any series carries more than one point (a pie shows ONE moment), and for a single series (one slice is not a breakdown)', () => {
    expect(ownDataPieFormAllowed(shaped('bar', 2, 2), 2)).toBe(false);
    expect(ownDataPieFormAllowed(shaped('bar', 12, 3), 12)).toBe(false);
    const ragged = spec('bar', [series('A', [point('2020', 1)]), series('B', [point('2020', 2), point('2021', 3)])]);
    expect(ownDataPieFormAllowed(ragged, 2)).toBe(false);
    expect(ownDataPieFormAllowed(shaped('bar', 1, 1), 1)).toBe(false);
  });
  it('stacked / stacked100: at least two series, any number of moments — with no scope, a null scope or a real one alike; a single series has nothing to stack', () => {
    for (const s of [shaped('bar', 2, 1), shaped('bar', 12, 5), shaped('line', 2, 3), { ...shaped('bar', 12, 3), regionScope: null }, rosterSpec(ALL_PROVINCIES, 12, 3)]) {
      expect(ownDataStackedFormAllowed(s, s.series.length)).toBe(true);
      expect(ownDataStacked100FormAllowed(s, s.series.length)).toBe(true);
    }
    expect(ownDataStackedFormAllowed(shaped('bar', 1, 3), 1)).toBe(false);
    expect(ownDataStacked100FormAllowed(shaped('bar', 1, 3), 1)).toBe(false);
  });
  it('stacked100 agrees with stacked on every shape, by construction', () => {
    for (const s of [shaped('bar', 2, 1), shaped('bar', 1, 3), shaped('line', 4, 2), rosterSpec(ALL_LANDSDELEN, 1, 3)]) {
      expect(ownDataStacked100FormAllowed(s, s.series.length)).toBe(ownDataStackedFormAllowed(s, s.series.length));
    }
  });
  it('differs from the CBS guards by provenance ALONE: on the shapes the CBS guards refuse for want of a roster, the own-data guards allow; where the CBS guards refuse on SHAPE, so do these', () => {
    // No roster: CBS refuses, own-data allows — the whole point of the pair.
    const oneMoment = handPickedProvinces(1);
    expect(pieFormAllowed(oneMoment, 12)).toBe(false);
    expect(ownDataPieFormAllowed(oneMoment, 12)).toBe(true);
    expect(stackedFormAllowed(oneMoment, 12)).toBe(false);
    expect(ownDataStackedFormAllowed(oneMoment, 12)).toBe(true);
    expect(stacked100FormAllowed(oneMoment, 12)).toBe(false);
    expect(ownDataStacked100FormAllowed(oneMoment, 12)).toBe(true);
    // Shape failures are shared: a multi-moment pie, a single series.
    expect(pieFormAllowed(rosterSpec(ALL_PROVINCIES, 12, 2), 12)).toBe(false);
    expect(ownDataPieFormAllowed(rosterSpec(ALL_PROVINCIES, 12, 2), 12)).toBe(false);
    expect(stackedFormAllowed(rosterSpec(ALL_PROVINCIES, 1, 3), 1)).toBe(false);
    expect(ownDataStackedFormAllowed(rosterSpec(ALL_PROVINCIES, 1, 3), 1)).toBe(false);
  });
});

// The own-data card's fallback policy: `fallbackForm` would send every
// own-data pie/stacked/stacked100 to the table (its cases read the CBS
// guards, false without a roster), so the card could never show one.
describe('ownDataFallbackForm — fallbackForm with the whole forms routed through the own-data guards (Task 3)', () => {
  it('pie/stacked/stacked100 stay when the shape fits — with no regionScope at all — and fall back to table when it does not', () => {
    expect(ownDataFallbackForm('pie', shaped('bar', 2, 1), 2)).toBe('pie');
    expect(ownDataFallbackForm('stacked', shaped('bar', 2, 3), 2)).toBe('stacked');
    expect(ownDataFallbackForm('stacked100', shaped('line', 2, 3), 2)).toBe('stacked100');
    expect(ownDataFallbackForm('pie', shaped('bar', 2, 2), 2)).toBe('table');
    expect(ownDataFallbackForm('pie', shaped('bar', 1, 1), 1)).toBe('table');
    expect(ownDataFallbackForm('stacked', shaped('bar', 1, 3), 1)).toBe('table');
    expect(ownDataFallbackForm('stacked100', shaped('bar', 1, 3), 1)).toBe('table');
  });
  it('the shared policy sends those SAME shapes to the table for want of a roster — the two policies differ on exactly these three forms', () => {
    expect(fallbackForm('pie', shaped('bar', 2, 1), 2)).toBe('table');
    expect(fallbackForm('stacked', shaped('bar', 2, 3), 2)).toBe('table');
    expect(fallbackForm('stacked100', shaped('line', 2, 3), 2)).toBe('table');
  });
  it('every other form delegates to fallbackForm unchanged, over every shape', () => {
    const shapes = [shaped('line', 1, 3), shaped('line', 2, 2), shaped('line', 3, 4), shaped('bar', 1, 1), shaped('bar', 2, 1), shaped('bar', 12, 1), shaped('bar', 2, 3)];
    const others = ['line', 'area', 'bar', 'hbar', 'table', 'dumbbell', 'slope', 'heatmap'] as const;
    for (const s of shapes) {
      for (const form of others) {
        const label = `${form} on ${s.kind} × ${s.series.length} series × ${s.series[0]!.points.length} points`;
        expect(ownDataFallbackForm(form, s, s.series.length), label).toBe(fallbackForm(form, s, s.series.length));
      }
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
  it('accepts every real ChartForm member (eleven since phase 5b)', () => {
    for (const form of ['line', 'area', 'bar', 'hbar', 'table', 'dumbbell', 'slope', 'heatmap', 'pie', 'stacked', 'stacked100']) {
      expect(isChartForm(form)).toBe(true);
    }
  });

  it('rejects anything else, including near-misses and non-strings', () => {
    expect(isChartForm('Line')).toBe(false);
    // Phase 5b made 'pie' real; 'donut' is styling (a pieHole presentation
    // key), never a form, and 'scatter' stays refused (ADR 039).
    expect(isChartForm('donut')).toBe(false);
    expect(isChartForm('scatter')).toBe(false);
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
      view: { hiddenKeys: new Set(['s2']), highlightedKey: 's0', periodRange: ['2020JJ00', '2022JJ00'], dimmedKeys: new Set() },
    });
    expect(state.form).toBe('area');
    expect(state.presentation).toEqual({ lineWidth: 'thick' });
    expect([...state.hiddenKeys]).toEqual(['s2']);
    expect(state.highlightedKey).toBe('s0');
    expect(state.periodRange).toEqual(['2020JJ00', '2022JJ00']);
  });

  it('copies the given Set, so a later mutation of the caller\'s Set never leaks into state', () => {
    const hidden = new Set(['s1']);
    const state = chartViewReducer(initialViewState('line'), { type: 'setView', view: { hiddenKeys: hidden, highlightedKey: null, periodRange: null, dimmedKeys: new Set() } });
    hidden.add('s2');
    expect([...state.hiddenKeys]).toEqual(['s1']);
  });
});

describe('selectedReading', () => {
  it('initialViewState starts on the primary reading (null)', () => {
    expect(initialViewState('line').selectedReading).toBeNull();
  });

  it('setReading updates only selectedReading, leaving form/zoom/presentation untouched', () => {
    const before = { ...initialViewState('line'), form: 'bar' as const, periodRange: ['2025-01', '2025-06'] as [string, string] };
    const after = chartViewReducer(before, { type: 'setReading', index: 0 });
    expect(after.selectedReading).toBe(0);
    expect(after.form).toBe('bar');
    expect(after.periodRange).toEqual(['2025-01', '2025-06']);
  });

  it('reset clears selectedReading back to null, like every other per-chart-instance field', () => {
    const withReading = chartViewReducer(initialViewState('line'), { type: 'setReading', index: 1 });
    const after = chartViewReducer(withReading, { type: 'reset', initialForm: 'line' });
    expect(after.selectedReading).toBeNull();
  });
});

describe('activeReadingSpec', () => {
  const primary = spec('line', [series('NL', [point('2020', 1)])]);
  const altA = spec('line', [series('NL', [point('2020', 2)])]);

  it('null selectedReading returns the primary', () => {
    expect(activeReadingSpec(primary, [{ label: 'alt', spec: altA }], null)).toBe(primary);
  });
  it('a valid index returns that alternate\'s spec', () => {
    expect(activeReadingSpec(primary, [{ label: 'alt', spec: altA }], 0)).toBe(altA);
  });
  it('an out-of-range index falls back to the primary, never throws', () => {
    expect(activeReadingSpec(primary, [{ label: 'alt', spec: altA }], 5)).toBe(primary);
  });
  it('an empty alternates array with a non-null index falls back to the primary', () => {
    expect(activeReadingSpec(primary, [], 0)).toBe(primary);
  });
});

// Session 110: a comparison-shaped spec (isComparisonShaped) — one point per
// series, ≥2 series — is the structural shape a region-set answer (all
// provincies, all gemeenten in a provincie, …) always has. A time series
// (even multi-series bar-kind) never qualifies: it has more than one point
// per series.
describe('isComparisonShaped', () => {
  function comparisonSpec(count: number): ChartSpec {
    return spec(
      'bar',
      Array.from({ length: count }, (_, i) => series(`S${i}`, [point('2020', i)])),
    );
  }

  function timeSeriesSpec(seriesCount: number, pointsPerSeries: number): ChartSpec {
    return spec(
      'bar',
      Array.from({ length: seriesCount }, (_, i) =>
        series(
          `S${i}`,
          Array.from({ length: pointsPerSeries }, (_, p) => point(`202${p}`, i + p)),
        ),
      ),
    );
  }

  it('true for ≥2 series with exactly one point each', () => {
    expect(isComparisonShaped(comparisonSpec(2))).toBe(true);
    expect(isComparisonShaped(comparisonSpec(26))).toBe(true);
  });

  it('false for a single series, however many points', () => {
    expect(isComparisonShaped(comparisonSpec(1))).toBe(false);
    expect(isComparisonShaped(timeSeriesSpec(1, 10))).toBe(false);
  });

  it('false the moment any series carries more than one point — a time series, not a comparison', () => {
    expect(isComparisonShaped(timeSeriesSpec(26, 2))).toBe(false);
  });
});

// #229 (ADR 041 addendum, session 110) + the session 110 many-region-
// comparison fix: the canonical home for the default-form rule, extracted
// out of chart.tsx so the Embed dialog (chart-embed-dialog.tsx) can ask the
// exact same question about a spec without importing the whole chart
// component — see this file's own BAR_LABEL_MAX/defaultFormFor comments for
// why a direct chart.tsx import from there would be circular.
describe('defaultFormFor / defaultFormIsTable', () => {
  function comparisonSpec(count: number): ChartSpec {
    return spec(
      'bar',
      Array.from({ length: count }, (_, i) => series(`S${i}`, [point('2020', i)])),
    );
  }

  function timeSeriesSpec(seriesCount: number): ChartSpec {
    return spec(
      'bar',
      Array.from({ length: seriesCount }, (_, i) =>
        series(`S${i}`, [point('2020', i), point('2021', i + 1)]),
      ),
    );
  }

  it('a single-series spec (not comparison-shaped) at or below BAR_LABEL_MAX: the spec\'s own kind, never Tabel', () => {
    expect(defaultFormFor(comparisonSpec(1))).toBe('bar');
    expect(defaultFormIsTable(comparisonSpec(1))).toBe(false);
  });

  it('a comparison-shaped spec opens on hbar at EVERY series count up to COMPARISON_HBAR_MAX, not only above BAR_LABEL_MAX — pass 3 row 1: a vertical bar names no region and its labels collide well below 15 series', () => {
    expect(defaultFormFor(comparisonSpec(2))).toBe('hbar');
    expect(defaultFormFor(comparisonSpec(12))).toBe('hbar');
    expect(defaultFormFor(comparisonSpec(BAR_LABEL_MAX))).toBe('hbar');
    expect(defaultFormIsTable(comparisonSpec(2))).toBe(false);
    expect(defaultFormIsTable(comparisonSpec(BAR_LABEL_MAX))).toBe(false);
  });

  it('16 (BAR_LABEL_MAX + 1) comparison-shaped series: hbar, not Tabel — the session 110 fix', () => {
    expect(defaultFormFor(comparisonSpec(BAR_LABEL_MAX + 1))).toBe('hbar');
    expect(defaultFormIsTable(comparisonSpec(BAR_LABEL_MAX + 1))).toBe(false);
  });

  it(`${COMPARISON_HBAR_MAX} (COMPARISON_HBAR_MAX) comparison-shaped series: still hbar`, () => {
    expect(defaultFormFor(comparisonSpec(COMPARISON_HBAR_MAX))).toBe('hbar');
  });

  it(`${COMPARISON_HBAR_MAX + 1} (COMPARISON_HBAR_MAX + 1) comparison-shaped series: back to Tabel — even a horizontal bar stops being readable`, () => {
    expect(defaultFormFor(comparisonSpec(COMPARISON_HBAR_MAX + 1))).toBe('table');
    expect(defaultFormIsTable(comparisonSpec(COMPARISON_HBAR_MAX + 1))).toBe(true);
  });

  it('a 342-series comparison (the "alle gemeenten" class) stays Tabel — far above COMPARISON_HBAR_MAX', () => {
    expect(defaultFormFor(comparisonSpec(342))).toBe('table');
  });

  it('a 26-series TIME SERIES (multi-point, not comparison-shaped) still defaults to Tabel above BAR_LABEL_MAX — the hbar carve-out never applies to a time series', () => {
    const s = timeSeriesSpec(26);
    expect(isComparisonShaped(s)).toBe(false);
    expect(defaultFormFor(s)).toBe('table');
    expect(defaultFormIsTable(s)).toBe(true);
  });

  it('a comparison-shaped spec whose kind is not bar (never actually produced today, but hbarFormAllowed still gates it) falls back to Tabel, not hbar', () => {
    const s = comparisonSpec(BAR_LABEL_MAX + 1);
    const lineKindComparison: ChartSpec = { ...s, kind: 'line' };
    expect(defaultFormFor(lineKindComparison)).toBe('table');
  });
});
