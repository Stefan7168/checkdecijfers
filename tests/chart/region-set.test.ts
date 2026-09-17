// #253 Task 5 — chart: a `region_set` result charts as a sorted bar (R6, R1,
// R11). Before this task the shape gate in src/chart/build.ts returned null
// for 'region_set' — that was the bug this file proves fixed, against REAL
// region_set ValidatedResults from the hermetic ingest (ADR 009), the same
// fixture DB and mutation technique tests/query/region-set-run.test.ts uses
// — hand-built cells would not exercise the real deriveRegionRanking wiring
// this task depends on.
//
// Test ORDER is load-bearing from "an incomplete set" onwards, mirroring
// region-set-run.test.ts: those cases mutate this file's own private PGlite
// (createIngestedDb gives every caller its own), each on a province the
// earlier/later cases do not depend on.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildChartSpec } from '../../src/chart/index.ts';
import { runQuery } from '../../src/query/index.ts';
import type { DerivationRecord, StructuredIntent, ValidatedResult } from '../../src/query/index.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';

let db: Db;
let close: () => Promise<void>;

const POPULATION_MEASURE = 'M000352';

function population(extra: Partial<StructuredIntent>): StructuredIntent {
  return {
    schemaVersion: 1,
    target: { kind: 'canonical', key: 'population_on_1_january' },
    period: { kind: 'codes', codes: ['2025JJ00'] },
    derivation: 'none',
    ...extra,
  };
}

async function answer(intent: StructuredIntent): Promise<ValidatedResult> {
  const outcome = await runQuery(db, intent);
  if (!outcome.ok) throw new Error(`expected a result, got ${outcome.refusal.kind}: ${outcome.refusal.message}`);
  return outcome;
}

function rankingRecord(result: ValidatedResult): Extract<DerivationRecord, { kind: 'max' }> | undefined {
  return result.derivations.find((d): d is Extract<DerivationRecord, { kind: 'max' }> => d.kind === 'max');
}

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

describe('buildChartSpec — a complete region_set charts as a ranked bar', () => {
  it('all 12 provincies chart as one bar, one series per region, exactly one point each', async () => {
    const result = await answer(population({ regionSet: { kind: 'all_provincies' } }));
    expect(result.shape).toBe('region_set');
    const ranking = rankingRecord(result);
    expect(ranking).toBeDefined(); // RS1: a complete set gets a ranking record.

    const spec = buildChartSpec(result);
    expect(spec).not.toBeNull();
    expect(spec!.kind).toBe('bar');
    expect(spec!.series).toHaveLength(12);
    for (const s of spec!.series) expect(s.points).toHaveLength(1);
  });

  it('series order equals the ranking derivation\'s own rankingResultIds order — the chart never invents a sort', async () => {
    const result = await answer(population({ regionSet: { kind: 'all_provincies' } }));
    const ranking = rankingRecord(result)!;
    const spec = buildChartSpec(result)!;
    const specOrder = spec.series.map((s) => s.points[0]!.resultId);
    expect(specOrder).toEqual(ranking.rankingResultIds);
    // And that order is genuinely descending by value (deriveMax's contract),
    // not just "some" order that happens to equal rankingResultIds.
    const values = spec.series.map((s) => s.points[0]!.value as number);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  it('every point carries its resultId, traceable to the source cell (R1)', async () => {
    const result = await answer(population({ regionSet: { kind: 'all_provincies' } }));
    const spec = buildChartSpec(result)!;
    const cellIds = new Set(result.cells.map((c) => c.resultId));
    for (const s of spec.series) {
      for (const p of s.points) {
        expect(p.resultId).toBeTruthy();
        expect(cellIds.has(p.resultId)).toBe(true);
      }
    }
  });

  it('abolished gemeenten (Impossible, excluded from cells entirely) never appear as chart series — 26 bars, not 42', async () => {
    const result = await answer({
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'average_home_sale_price_by_gemeente' },
      period: { kind: 'codes', codes: ['2024JJ00'] },
      derivation: 'none',
      regionSet: { kind: 'gemeenten_in_provincie', parent: 'PV26' },
    });
    expect(result.regionSet!.complete).toBe(true);
    const spec = buildChartSpec(result)!;
    expect(spec.series).toHaveLength(26);
  });
});

describe('buildChartSpec — an incomplete region_set still charts, honestly', () => {
  it('a withheld member (Confidential) still charts as a bar, keeps its nullNotes line naming region + reason, and gets NO ranking-driven sort', async () => {
    await db.query(
      `update observations set value = null, value_attribute = 'Confidential'
        where table_id = '03759ned' and measure = $1 and region_code = 'PV20' and period_code = '2025JJ00'`,
      [POPULATION_MEASURE],
    );

    const result = await answer(population({ regionSet: { kind: 'all_provincies' } }));
    expect(result.regionSet!.withheld).toEqual(['PV20']);
    expect(result.regionSet!.complete).toBe(false);
    const ranking = rankingRecord(result);
    expect(ranking).toBeUndefined(); // RS1: no ranking over an incomplete set.

    const spec = buildChartSpec(result)!;
    expect(spec).not.toBeNull();
    expect(spec.kind).toBe('bar');
    // With no ranking record, the series stay in the result's own cell order
    // — never a builder-invented sort.
    expect(spec.series.map((s) => s.regionCode)).toEqual(result.cells.map((c) => c.regionCode));

    const pv20Cell = result.cells.find((c) => c.regionCode === 'PV20')!;
    expect(pv20Cell.value).toBeNull();
    const note = spec.nullNotes.find((n) => n.includes(pv20Cell.regionLabel!));
    expect(note).toBeDefined();
    expect(note).toContain('Confidential');
    // The withheld point is still present on the chart, null value and all.
    const pv20Point = spec.series.find((s) => s.regionCode === 'PV20')!.points[0]!;
    expect(pv20Point.value).toBeNull();
    expect(pv20Point.valueAttribute).toBe('Confidential');
    expect(pv20Point.resultId).toBe(pv20Cell.resultId);
  });

  it('a missing member (no row at all) is simply absent from the chart, and the remaining bars keep natural cell order (still no ranking)', async () => {
    await db.query(
      `delete from observations
        where table_id = '03759ned' and measure = $1 and region_code = 'PV21' and period_code = '2025JJ00'`,
      [POPULATION_MEASURE],
    );

    const result = await answer(population({ regionSet: { kind: 'all_provincies' } }));
    expect(result.regionSet!.missing).toEqual(['PV21']);
    expect(result.regionSet!.complete).toBe(false);
    expect(rankingRecord(result)).toBeUndefined();

    const spec = buildChartSpec(result)!;
    expect(spec.series).toHaveLength(11);
    expect(spec.series.some((s) => s.regionCode === 'PV21')).toBe(false);
    expect(spec.series.map((s) => s.regionCode)).toEqual(result.cells.map((c) => c.regionCode));
  });
});
