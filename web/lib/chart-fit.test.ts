// Phase 5 (chart-fit scorer, session 116): `allowedForms` is the ONE list
// both chart.tsx's tabs and the CBS co-pilot's capability bag read — these
// tests pin its fixed order and that the three new shapes appear only when
// their own guards say so (spec §10), never merely because a chart has two
// or more series.
import { describe, expect, it } from 'vitest';
import { allowedForms } from './chart-fit.ts';
import type { ChartPoint, ChartSeries, ChartSpec } from '../backend/chart/types.ts';
import type { PlottableSpec } from '../components/chart.tsx';

function point(periodCode: string, value: number): ChartPoint {
  return {
    resultId: `r-${periodCode}-${value}`,
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

function shaped(kind: 'line' | 'bar', seriesCount: number, pointsPerSeries: number): ChartSpec {
  const series: ChartSeries[] = Array.from({ length: seriesCount }, (_, i) => ({
    label: `S${i}`,
    regionCode: `R${i}`,
    points: Array.from({ length: pointsPerSeries }, (_, p) => point(`202${p}`, i + p)),
  }));
  return {
    schemaVersion: 1,
    kind,
    title: 'Test',
    dims: {},
    dimLabels: {},
    unit: 'euro',
    series,
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

describe('allowedForms', () => {
  it('offers every co-offerable form, in the fixed order, on the two richest spec shapes', () => {
    // No single spec can reach all eight: area needs exactly ONE series
    // (areaFormAllowed) while dumbbell/slope/heatmap need at least TWO. So
    // "qualifies for everything" is pinned on the two shapes that offer the
    // most at once — a 2-series / 2-point spec of each kind. Bar kind: line
    // is blocked (multi-series comparison), area is blocked (bar kind).
    expect(allowedForms(shaped('bar', 2, 2), 2)).toEqual(['bar', 'hbar', 'table', 'dumbbell', 'slope', 'heatmap']);
    // Line kind: hbar is blocked (time series), area is blocked (2 series).
    expect(allowedForms(shaped('line', 2, 2), 2)).toEqual(['line', 'bar', 'table', 'dumbbell', 'slope', 'heatmap']);
  });

  it('keeps the fixed display order — the original five first, then dumbbell, slope, heatmap', () => {
    const forms = allowedForms(shaped('bar', 2, 2), 2);
    const order = ['line', 'area', 'bar', 'hbar', 'table', 'dumbbell', 'slope', 'heatmap'];
    const positions = forms.map((f) => order.indexOf(f));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('offers none of the three phase-5 forms on the sparsest spec shapes', () => {
    // Exactly ['bar', 'table'] is unreachable for a real spec: hbar is on for
    // EVERY bar-kind spec and line for EVERY line-kind spec. The sparsest
    // honest lists are pinned instead. A 1-series / 1-point bar spec: no area
    // (bar kind), no phase-5 form (one series).
    expect(allowedForms(shaped('bar', 1, 1), 1)).toEqual(['line', 'bar', 'hbar', 'table']);
    // A many-region one-point comparison: line and area blocked, no phase-5
    // form (one point each) — bar/hbar/table only.
    expect(allowedForms(shaped('bar', 12, 1), 12)).toEqual(['bar', 'hbar', 'table']);
  });

  it('never offers dumbbell or slope for a normal multi-point time series just because it has 2+ series', () => {
    const forms = allowedForms(shaped('line', 2, 3), 2);
    expect(forms).not.toContain('dumbbell');
    expect(forms).not.toContain('slope');
    // heatmap IS honestly on offer here — ≥2 series × ≥2 points is exactly a
    // grid (spec §10: "more than one thing being compared AND more than one
    // time point") — the two-point forms are what must stay off.
    expect(forms).toEqual(['line', 'bar', 'table', 'heatmap']);
  });

  it('offers none of the three for a single series, however many points', () => {
    expect(allowedForms(shaped('line', 1, 2), 1)).toEqual(['line', 'area', 'bar', 'table']);
    expect(allowedForms(shaped('line', 1, 10), 1)).toEqual(['line', 'area', 'bar', 'table']);
  });

  it('always includes bar and table (never gated), on every shape', () => {
    for (const s of [shaped('line', 1, 1), shaped('line', 2, 2), shaped('bar', 1, 1), shaped('bar', 40, 1), shaped('line', 3, 7)]) {
      const forms = allowedForms(s, s.series.length);
      expect(forms).toContain('bar');
      expect(forms).toContain('table');
    }
  });

  it('accepts chart.tsx\'s PlottableSpec (what cbsCapabilities hands it), not only a full ChartSpec', () => {
    const plottable: PlottableSpec = {
      kind: 'line',
      series: [
        { label: 'Amsterdam', points: [{ periodCode: '2020', periodLabel: '2020', value: 1, formattedValue: '1', provisional: false, resultId: 'a' }, { periodCode: '2021', periodLabel: '2021', value: 2, formattedValue: '2', provisional: false, resultId: 'b' }] },
        { label: 'Rotterdam', points: [{ periodCode: '2020', periodLabel: '2020', value: 3, formattedValue: '3', provisional: false, resultId: 'c' }, { periodCode: '2021', periodLabel: '2021', value: 4, formattedValue: '4', provisional: false, resultId: 'd' }] },
      ],
    };
    expect(allowedForms(plottable, plottable.series.length)).toEqual(['line', 'bar', 'table', 'dumbbell', 'slope', 'heatmap']);
  });
});
