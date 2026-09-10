// Insights (session 94): buildFindings is pure and honesty-bound — every
// digit in a caption/title is a substring of one of the spec's own strings
// (R1/R3/R6, same discipline as chart-story.test.ts), scoring never invents
// a number (it only ranks and selects among values the spec already
// carries), and a chart with nothing to distinguish yields no findings (no
// trigger) — mirrors buildStorySteps' own honesty contract.
import { describe, expect, it } from 'vitest';
import type { ChartSpec } from '../backend/chart/types.ts';
import { buildFindings, INSIGHTS_MAX_FINDINGS } from './chart-insights.ts';

function point(overrides: Partial<ChartSpec['series'][0]['points'][0]> = {}) {
  return {
    resultId: 'r1',
    periodCode: '2024JJ00',
    periodLabel: '2024',
    value: 42,
    formattedValue: '42,0',
    decimals: 1,
    status: 'Definitief',
    provisional: false,
    valueAttribute: 'None',
    ...overrides,
  };
}

function spec(overrides: Partial<ChartSpec> = {}): ChartSpec {
  return {
    schemaVersion: 1,
    kind: 'line',
    title: 'Testreeks',
    dims: { Kenmerk: '000000' },
    dimLabels: { Kenmerk: 'Alle kenmerken' },
    unit: '%',
    series: [{ label: 'Nederland', regionCode: 'NL01', points: [point()] }],
    provisionalNote: null,
    nullNotes: [],
    definitionLine: null,
    attributionLine: 'Bron: CBS StatLine, tabel 12345NED.',
    attribution: {
      tableId: '12345NED',
      tableTitle: 'Test',
      tableVersion: 1,
      syncedAt: '2026-07-01',
      coveredPeriods: { from: '2020', to: '2024' },
      license: 'CC BY 4.0',
    },
    ...overrides,
  };
}

// Hand-verified: mean 2.375, sd≈0.7395. z-scores 2021≈0.51, 2022≈1.52 (high),
// 2023≈1.18 (low), 2024≈0.17. Jump scores: →2022≈2.03, →2023≈2.71 (biggest),
// →2024≈1.35. After dedup-by-point every point keeps its higher-scoring
// candidate: 2021 stays its (only) record candidate; 2022/2023/2024 all lose
// to their own incoming jump. Ranked desc: 2023, 2022, 2024, 2021 — all 4
// clear the cap, then re-sorted chronologically for the final order.
function fourPointSpec(overrides: Partial<ChartSpec> = {}): ChartSpec {
  return spec({
    series: [
      {
        label: 'Nederland',
        regionCode: 'NL01',
        points: [
          point({ resultId: 'a', periodCode: '2021JJ00', periodLabel: '2021', value: 2, formattedValue: '2,0' }),
          point({ resultId: 'b', periodCode: '2022JJ00', periodLabel: '2022', value: 3.5, formattedValue: '3,5' }),
          point({ resultId: 'c', periodCode: '2023JJ00', periodLabel: '2023', value: 1.5, formattedValue: '1,5' }),
          point({ resultId: 'd', periodCode: '2024JJ00', periodLabel: '2024', value: 2.5, formattedValue: '2,5', provisional: true, status: 'Voorlopig' }),
        ],
      },
    ],
    ...overrides,
  });
}

function specStrings(s: ChartSpec): string[] {
  return [
    s.title,
    s.unit,
    ...s.series.map((se) => se.label),
    ...s.series.flatMap((se) => se.points.flatMap((p) => [p.formattedValue ?? '', p.periodLabel])),
  ].filter(Boolean);
}

function expectDigitsBound(s: ChartSpec, lang: 'nl' | 'en'): void {
  const strings = specStrings(s);
  for (const finding of buildFindings(s, lang)) {
    const tokens = `${finding.title} ${finding.caption}`.match(/\d[\d.,]*/g) ?? [];
    for (const tok of tokens) {
      expect(strings.some((str) => str.includes(tok)), `token "${tok}" in "${finding.caption}" is not a spec string`).toBe(true);
    }
  }
}

describe('buildFindings — a single time series', () => {
  it('selects real movers (jumps + the one non-jump record), not chronological start/latest', () => {
    const findings = buildFindings(fourPointSpec(), 'nl');
    expect(findings.map((f) => f.periodCode)).toEqual(['2021JJ00', '2022JJ00', '2023JJ00', '2024JJ00']);
    expect(findings.map((f) => f.kind)).toEqual(['recordLow', 'jumpUp', 'jumpDown', 'jumpUp']);
  });

  it('carries R1 traceability (resultId) and the point to ring, matching the spec cell', () => {
    const findings = buildFindings(fourPointSpec(), 'nl');
    const jump2023 = findings.find((f) => f.periodCode === '2023JJ00')!;
    expect(jump2023.resultId).toBe('c');
    expect(jump2023.point).toEqual({ seriesKey: 's0', periodCode: '2023JJ00' });
  });

  it('marks a provisional point\'s caption, verbatim to the story convention', () => {
    const findings = buildFindings(fourPointSpec(), 'nl');
    const latest = findings.find((f) => f.periodCode === '2024JJ00')!;
    expect(latest.caption).toContain('(voorlopig cijfer)');
  });

  it('never repeats the same point under two findings', () => {
    const findings = buildFindings(fourPointSpec(), 'nl');
    const ids = findings.map((f) => `${f.seriesKey}-${f.periodCode}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every digit shown is a verbatim spec string (R1/R3/R6 honesty)', () => {
    expectDigitsBound(fourPointSpec(), 'nl');
    expectDigitsBound(fourPointSpec(), 'en');
  });

  it('caps at INSIGHTS_MAX_FINDINGS for a long, volatile series', () => {
    const values = [10, 10, 10, 50, 10, 10, 30, 10];
    const points = values.map((value, i) =>
      point({ resultId: `p${i}`, periodCode: `202${i}JJ00`, periodLabel: `202${i}`, value, formattedValue: String(value) }),
    );
    const findings = buildFindings(spec({ series: [{ label: 'Nederland', regionCode: 'NL01', points }] }), 'nl');
    expect(findings.length).toBeLessThanOrEqual(INSIGHTS_MAX_FINDINGS);
    // The dramatic spike (index 3, value 50) must survive the cap — it is
    // unambiguously the most extreme point in the series.
    expect(findings.some((f) => f.periodCode === '2023JJ00')).toBe(true);
  });

  it('returns [] for a single point (nothing to compare)', () => {
    expect(buildFindings(spec(), 'nl')).toEqual([]);
  });

  it('skips null-valued points (an honest gap, never a fabricated finding)', () => {
    const points = [
      point({ resultId: 'a', periodCode: '2021JJ00', periodLabel: '2021', value: 10, formattedValue: '10' }),
      point({ resultId: 'b', periodCode: '2022JJ00', periodLabel: '2022', value: null, formattedValue: null, valueAttribute: 'Geheim' }),
      point({ resultId: 'c', periodCode: '2023JJ00', periodLabel: '2023', value: 90, formattedValue: '90' }),
    ];
    const findings = buildFindings(spec({ series: [{ label: 'Nederland', regionCode: 'NL01', points }] }), 'nl');
    expect(findings.every((f) => f.periodCode !== '2022JJ00')).toBe(true);
  });
});

describe('buildFindings — multi-series', () => {
  it('prefixes the series label in the caption (the only way to tell series apart)', () => {
    const series = [
      {
        label: 'Amsterdam',
        regionCode: 'GM0363',
        points: [
          point({ resultId: 'a1', periodCode: '2021JJ00', periodLabel: '2021', value: 10, formattedValue: '10' }),
          point({ resultId: 'a2', periodCode: '2022JJ00', periodLabel: '2022', value: 90, formattedValue: '90' }),
        ],
      },
      {
        label: 'Rotterdam',
        regionCode: 'GM0599',
        points: [
          point({ resultId: 'r1', periodCode: '2021JJ00', periodLabel: '2021', value: 20, formattedValue: '20' }),
          point({ resultId: 'r2', periodCode: '2022JJ00', periodLabel: '2022', value: 22, formattedValue: '22' }),
        ],
      },
    ];
    const findings = buildFindings(spec({ series }), 'nl');
    expect(findings.some((f) => f.caption.startsWith('Amsterdam —'))).toBe(true);
    expect(findings.some((f) => f.caption.startsWith('Rotterdam —'))).toBe(true);
  });

  it('returns [] with fewer than 2 series contributing (nothing to compare)', () => {
    expect(buildFindings(spec(), 'nl')).toEqual([]);
  });
});

describe('buildFindings — comparison (bar)', () => {
  function barSpec(values: number[]): ChartSpec {
    return spec({
      kind: 'bar',
      series: values.map((value, i) => ({
        label: `Regio ${i}`,
        regionCode: `GM000${i}`,
        points: [point({ resultId: `b${i}`, periodCode: '2024JJ00', periodLabel: '2024', value, formattedValue: String(value) })],
      })),
    });
  }

  it('picks the highest and lowest bar, captioned with the region label', () => {
    const findings = buildFindings(barSpec([10, 90, 50, 55, 52]), 'nl');
    expect(findings.some((f) => f.kind === 'recordHigh' && f.caption.startsWith('Regio 1:'))).toBe(true);
    expect(findings.some((f) => f.kind === 'recordLow' && f.caption.startsWith('Regio 0:'))).toBe(true);
  });

  it('returns [] when every bar is equal — no story rather than the same bar told twice', () => {
    expect(buildFindings(barSpec([50, 50, 50, 50]), 'nl')).toEqual([]);
  });

  it('returns [] with a single bar (nothing to compare)', () => {
    expect(buildFindings(barSpec([50]), 'nl')).toEqual([]);
  });
});

describe('buildFindings — no series at all', () => {
  it('returns []', () => {
    expect(buildFindings(spec({ series: [] }), 'nl')).toEqual([]);
  });
});
