// Insights selection (session 94, ADR 041) — pure, deterministic finding
// scoring. Session 110 addendum (row #19, ADR 041 "Session 110 addendum"):
// recordHigh/recordLow may ONLY be assigned to the series' (or, for a bar
// chart, the cross-series) actual extreme point; every other above-/below-
// mean point that still ranks is aboveAverage/belowAverage instead — a
// mid-series point is never mislabelled as the record it isn't (R9: a
// ranking/extremity claim must match the data).
import { describe, expect, it } from 'vitest';
import type { ChartPoint, ChartSpec } from '../../src/chart/types.ts';
import { scoreFindings, topFinding } from '../../src/chart/insights.ts';

function point(overrides: Partial<ChartPoint> = {}): ChartPoint {
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

describe('scoreFindings — recordHigh/recordLow reserved for the actual extreme', () => {
  it('a flat series with a two-step ramp into its peak: only the true minimum is recordLow, only the true maximum is recordHigh — never a merely-elevated point', () => {
    // Values 10,10,10,10,48,50,10,10,10,10 (mean 17.8, sd≈15.61, hand-
    // verified). True max = index 5 (50); its incoming jump (48→50, delta 2)
    // is tiny next to its own level z-score (2.06), so the level candidate
    // wins the point — unlike a spike with a flat neighbour, where the
    // incoming jump would dominate (see the dedicated jump-beats-level case
    // below). True min = 10, earliest occurrence = index 0 (ties resolve to
    // earliest — the same `>`/`<` reduce already used to pick high/low).
    const values = [10, 10, 10, 10, 48, 50, 10, 10, 10, 10];
    const points = values.map((value, i) =>
      point({ resultId: `p${i}`, periodCode: `202${i}JJ00`, periodLabel: `202${i}`, value, formattedValue: String(value) }),
    );
    const findings = scoreFindings(spec({ series: [{ label: 'Nederland', regionCode: 'NL01', points }] }));

    const recordHighs = findings.filter((f) => f.kind === 'recordHigh');
    const recordLows = findings.filter((f) => f.kind === 'recordLow');
    expect(recordHighs).toHaveLength(1);
    expect(recordLows).toHaveLength(1);
    expect(recordHighs[0]!.periodCode).toBe('2025JJ00'); // index 5, value 50
    expect(recordLows[0]!.periodCode).toBe('2020JJ00'); // index 0, earliest 10

    // Every other point that made the cut and sits above/below the mean
    // without being a jump is framed relative to the mean, never as a
    // record.
    for (const f of findings) {
      if (f.periodCode === '2025JJ00' || f.periodCode === '2020JJ00') continue;
      if (f.kind === 'jumpUp' || f.kind === 'jumpDown') continue;
      expect(['aboveAverage', 'belowAverage']).toContain(f.kind);
    }
  });

  it('a jump that outscores the level record still leaves recordHigh/recordLow at ≤1 per series (a spike with flat neighbours: its incoming jump wins the point instead)', () => {
    // Values 10,10,10,50,10,10,30,10 — the incoming jump into the isolated
    // spike (10→50) outscores the spike's own level z-score, so the spike's
    // surviving finding is jumpUp, not recordHigh — a pre-existing, correct
    // dynamic this change must not disturb. The invariant this row pins is
    // narrower and unconditional: however scoring shakes out, recordHigh/
    // recordLow can never appear more than once each.
    const values = [10, 10, 10, 50, 10, 10, 30, 10];
    const points = values.map((value, i) =>
      point({ resultId: `p${i}`, periodCode: `202${i}JJ00`, periodLabel: `202${i}`, value, formattedValue: String(value) }),
    );
    const findings = scoreFindings(spec({ series: [{ label: 'Nederland', regionCode: 'NL01', points }] }));
    expect(findings.filter((f) => f.kind === 'recordHigh').length).toBeLessThanOrEqual(1);
    expect(findings.filter((f) => f.kind === 'recordLow').length).toBeLessThanOrEqual(1);
  });

  it('a below-mean point that is not the series minimum is belowAverage, not recordLow', () => {
    // 2021: 2 (below mean, NOT the minimum) / 2022: 3.5 (max) / 2023: 1.5
    // (the actual minimum) / 2024: 2.5. Mean = 2.375.
    const points = [
      point({ resultId: 'a', periodCode: '2021JJ00', periodLabel: '2021', value: 2, formattedValue: '2,0' }),
      point({ resultId: 'b', periodCode: '2022JJ00', periodLabel: '2022', value: 3.5, formattedValue: '3,5' }),
      point({ resultId: 'c', periodCode: '2023JJ00', periodLabel: '2023', value: 1.5, formattedValue: '1,5' }),
      point({ resultId: 'd', periodCode: '2024JJ00', periodLabel: '2024', value: 2.5, formattedValue: '2,5' }),
    ];
    const findings = scoreFindings(spec({ series: [{ label: 'Nederland', regionCode: 'NL01', points }] }));
    const at2021 = findings.find((f) => f.periodCode === '2021JJ00')!;
    expect(at2021.kind).toBe('belowAverage');
    // The actual minimum (2023) is not itself the surviving level finding
    // here (it loses to its own bigger incoming jump — unaffected by this
    // change) but no OTHER point may claim 'recordLow'.
    expect(findings.filter((f) => f.kind === 'recordLow').length).toBeLessThanOrEqual(1);
  });

  it('bar comparison: only the highest/lowest bar is recordHigh/recordLow, a mid-pack above-mean bar is aboveAverage', () => {
    const bars = [10, 90, 50, 55, 52]; // mean 51.4
    const spec_ = spec({
      kind: 'bar',
      series: bars.map((value, i) => ({
        label: `Regio ${i}`,
        regionCode: `GM000${i}`,
        points: [point({ resultId: `b${i}`, periodCode: '2024JJ00', periodLabel: '2024', value, formattedValue: String(value) })],
      })),
    });
    const findings = scoreFindings(spec_);
    expect(findings.filter((f) => f.kind === 'recordHigh')).toHaveLength(1);
    expect(findings.filter((f) => f.kind === 'recordLow')).toHaveLength(1);
    expect(findings.find((f) => f.kind === 'recordHigh')!.seriesLabel).toBe('Regio 1'); // 90
    expect(findings.find((f) => f.kind === 'recordLow')!.seriesLabel).toBe('Regio 0'); // 10
    // Regio 3 (55) and Regio 4 (52) sit above the cross-series mean (51.4)
    // but are neither the highest nor the lowest bar.
    const regio3 = findings.find((f) => f.seriesLabel === 'Regio 3');
    if (regio3 !== undefined) expect(regio3.kind).toBe('aboveAverage');
    const regio2 = findings.find((f) => f.seriesLabel === 'Regio 2'); // 50, below mean
    if (regio2 !== undefined) expect(regio2.kind).toBe('belowAverage');
  });

  it('topFinding never returns aboveAverage/belowAverage as the single headline point when a real record exists (a record always outranks a merely-elevated bar)', () => {
    // Bars 40,95,50,55,52 (mean 58.4, sd≈18.98, hand-verified): the highest
    // bar (95) has by far the biggest z-score (1.93) — clearly ahead of the
    // lowest bar (40, z≈0.97) and every mid-pack bar.
    const bars = [40, 95, 50, 55, 52];
    const spec_ = spec({
      kind: 'bar',
      series: bars.map((value, i) => ({
        label: `Regio ${i}`,
        regionCode: `GM000${i}`,
        points: [point({ resultId: `b${i}`, periodCode: '2024JJ00', periodLabel: '2024', value, formattedValue: String(value) })],
      })),
    });
    const winner = topFinding(spec_);
    expect(winner).not.toBeNull();
    expect(winner!.kind).toBe('recordHigh');
    expect(winner!.seriesLabel).toBe('Regio 1');
  });

  it('FindingKind values are digit-free by construction (no numeric token can leak through the kind label itself)', () => {
    const kinds = ['recordHigh', 'recordLow', 'aboveAverage', 'belowAverage', 'jumpUp', 'jumpDown'];
    for (const k of kinds) expect(/\d/.test(k)).toBe(false);
  });

  // Session 110 addendum (audit pass 3, row 16): a comparison (bar) chart is
  // a snapshot ranking, not a time series — it has no period-over-period
  // step to have "jumped" from, so 'jumpUp'/'jumpDown' must never appear;
  // its extremes are the highest/lowest MEMBER, i.e. still recordHigh/
  // recordLow (chart-insights.ts titles these "Hoogste"/"Laagste" instead of
  // "Uitschieter…" — see that module's titleKeyFor).
  it('a comparison chart never emits jumpUp/jumpDown — only record/average kinds', () => {
    const bars = [10, 90, 50, 55, 52, 48, 60];
    const findings = scoreFindings(
      spec({
        kind: 'bar',
        series: bars.map((value, i) => ({
          label: `Regio ${i}`,
          regionCode: `GM000${i}`,
          points: [point({ resultId: `b${i}`, periodCode: '2024JJ00', periodLabel: '2024', value, formattedValue: String(value) })],
        })),
      }),
    );
    expect(findings.length).toBeGreaterThan(1);
    for (const f of findings) expect(['recordHigh', 'recordLow', 'aboveAverage', 'belowAverage']).toContain(f.kind);
    expect(findings.some((f) => f.kind === 'recordHigh')).toBe(true);
    expect(findings.some((f) => f.kind === 'recordLow')).toBe(true);
  });
});
