// ADR 055 Task 3 — chart: a `region_series` result charts as a multi-series
// line (R6, R1, R11). Before this task the shape gate in src/chart/build.ts
// returned null for 'region_series' (UX-audit pass-3 row 14's bug) — that is
// the bug this file proves fixed. Hand-built ValidatedResults (helpers.ts)
// are used throughout, exactly like build-spec.test.ts's own 'series' and
// 'region_set' cases: buildChartSpec reads only cells/shape/derivations, none
// of which need the real hermetic ingest to exercise honestly (Task 2's own
// tests/query/region-series-run.test.ts already proves the DB-backed wiring
// that produces a real `region_series` ValidatedResult; this file proves what
// the chart builder does with one).
import { describe, expect, it } from 'vitest';
import { buildChartSpec } from '../../src/chart/index.ts';
import { DERIVED_DATA_MARKING } from '../../src/query/index.ts';
import type { DerivationRecord, ResultCell } from '../../src/query/index.ts';
import { makeCell, makeResult } from './helpers.ts';

const AMSTERDAM = 'GM0363';
const ROTTERDAM = 'GM0599';
const DEN_HAAG = 'GM0518';

/** Two regions x N years, period-major/region-minor — the real query
 * layer's own cell order (run.ts), which the chart builder must never
 * re-sort for a 'region_series' shape (unlike 'region_set'). */
function twoRegionCells(years: string[], overrides: Partial<ResultCell> = {}): ResultCell[] {
  const cells: ResultCell[] = [];
  for (const year of years) {
    cells.push(makeCell({ regionCode: AMSTERDAM, periodCode: year, value: 100, ...overrides }));
    cells.push(makeCell({ regionCode: ROTTERDAM, periodCode: year, value: 200, ...overrides }));
  }
  return cells;
}

function directionRecord(sourceResultIds: string[], firstId: string, lastId: string): DerivationRecord {
  return {
    kind: 'direction',
    explicit: false,
    sourceResultIds,
    unit: '%',
    marking: DERIVED_DATA_MARKING,
    direction: 'up',
    monotonic: true,
    netChange: 1,
    firstResultId: firstId,
    lastResultId: lastId,
  };
}

describe('buildChartSpec — a region_series result charts as a multi-series line', () => {
  it('charts as kind: line, one series per region, in cell (intent) order — today this returns null', () => {
    const cells = twoRegionCells(['2020JJ00', '2021JJ00', '2022JJ00']);
    const result = makeResult('region_series', cells);
    const spec = buildChartSpec(result);
    expect(spec).not.toBeNull();
    expect(spec!.kind).toBe('line');
    expect(spec!.series).toHaveLength(2);
    expect(spec!.series.map((s) => s.regionCode)).toEqual([AMSTERDAM, ROTTERDAM]);
    // Never re-sorted: the region_set ranking-sort block must not touch this
    // shape — three years each, still in period order.
    for (const s of spec!.series) {
      expect(s.points.map((p) => p.periodCode)).toEqual(['2020JJ00', '2021JJ00', '2022JJ00']);
    }
  });

  it('every point carries its resultId, traceable to the source cell (R1)', () => {
    const cells = twoRegionCells(['2020JJ00', '2021JJ00']);
    const result = makeResult('region_series', cells);
    const spec = buildChartSpec(result)!;
    const cellIds = new Set(result.cells.map((c) => c.resultId));
    for (const s of spec.series) {
      for (const p of s.points) {
        expect(p.resultId).toBeTruthy();
        expect(cellIds.has(p.resultId)).toBe(true);
      }
    }
  });

  it('a non-contiguous explicit period enumeration still charts as null, exactly like a single-region series (#64)', () => {
    // 2020 and 2022 named explicitly, 2021 skipped — the SAME dishonest-line
    // risk #64 forbids for a single-region series, now checked across the
    // shared period axis of a multi-region result.
    const cells = twoRegionCells(['2020JJ00', '2022JJ00']);
    const result = makeResult('region_series', cells);
    expect(buildChartSpec(result)).toBeNull();
  });

  it("a partial region's null cell keeps its nullNotes line naming region + period + verbatim reason", () => {
    const cells = twoRegionCells(['2020JJ00', '2021JJ00', '2022JJ00']);
    // Rotterdam's 2021 value withheld — the region_series 'partial' case
    // (Task 2): the cell stays present with its reason (R11).
    const withheld = cells.map((c) =>
      c.regionCode === ROTTERDAM && c.periodCode === '2021JJ00'
        ? { ...c, value: null, valueAttribute: 'Geheim' }
        : c,
    );
    const result = makeResult('region_series', withheld);
    const spec = buildChartSpec(result)!;
    expect(spec).not.toBeNull();
    const note = spec.nullNotes.find((n) => n.includes('Geheim'));
    expect(note).toBeDefined();
    expect(note).toContain('Regio GM0599'); // the withheld cell's own region label
    expect(note).toContain('2021');
    // The point itself is still present, null value and all.
    const rtdPoint = spec.series.find((s) => s.regionCode === ROTTERDAM)!.points.find((p) => p.periodCode === '2021JJ00')!;
    expect(rtdPoint.value).toBeNull();
    expect(rtdPoint.valueAttribute).toBe('Geheim');
  });

  it('trendHeadline is absent (multi-region): a direction derivation over one region alone never becomes a whole-chart headline', () => {
    const cells = twoRegionCells(['2020JJ00', '2021JJ00', '2022JJ00']);
    const amsIds = cells.filter((c) => c.regionCode === AMSTERDAM).map((c) => c.resultId);
    const derivations = [directionRecord(amsIds, amsIds[0]!, amsIds[amsIds.length - 1]!)];
    const result = makeResult('region_series', cells, {}, derivations);
    const spec = buildChartSpec(result)!;
    expect(spec.attribution.trendHeadline).toBeUndefined();
  });

  it('three regions charts three lines, still zero cross-region claim in the spec (no ranking-sort artefact)', () => {
    const years = ['2020JJ00', '2021JJ00'];
    const cells: ResultCell[] = [];
    for (const year of years) {
      cells.push(makeCell({ regionCode: AMSTERDAM, periodCode: year, value: 10 }));
      cells.push(makeCell({ regionCode: ROTTERDAM, periodCode: year, value: 20 }));
      cells.push(makeCell({ regionCode: DEN_HAAG, periodCode: year, value: 30 }));
    }
    const result = makeResult('region_series', cells);
    const spec = buildChartSpec(result)!;
    expect(spec.kind).toBe('line');
    expect(spec.series).toHaveLength(3);
    expect(spec.series.map((s) => s.regionCode)).toEqual([AMSTERDAM, ROTTERDAM, DEN_HAAG]);
  });
});
