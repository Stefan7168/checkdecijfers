// ADR 055 Task 2 — the `region_series` partition, its coverage record, and the
// per-region derivations, against the real hermetic ingest (ADR 009).
//
// The rule this file exists to pin is **MS1**: a trend claim about a region
// exists only when that region has a value at EVERY requested period, backed by
// that region's OWN direction/first_last record computed over that region's
// cells alone — and no cross-region claim is supported at all, because no
// registered derivation ranks change across regions. It is enforced by the
// ABSENCE of a derivation record, never by filtering words out of prose.
//
// Test ORDER is load-bearing from "a withheld value" onwards: those cases
// surgically mutate this suite's own private PGlite (every createIngestedDb
// caller gets its own — tests/helpers/fixture-snapshot.ts), each on coordinates
// the later cases do not depend on.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runQuery } from '../../src/query/index.ts';
import type { DerivationRecord, StructuredIntent, ValidatedResult } from '../../src/query/index.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';

let db: Db;
let close: () => Promise<void>;

const POPULATION_MEASURE = 'M000352';
const AMSTERDAM = 'GM0363';
const ROTTERDAM = 'GM0599';
const DEN_HAAG = 'GM0518';
const UTRECHT = 'GM0344';

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

function population(extra: Partial<StructuredIntent>): StructuredIntent {
  return {
    schemaVersion: 1,
    target: { kind: 'canonical', key: 'population_on_1_january' },
    period: { kind: 'range', from: '2020JJ00', to: '2024JJ00' },
    derivation: 'none',
    ...extra,
  };
}

async function answer(intent: StructuredIntent): Promise<ValidatedResult> {
  const outcome = await runQuery(db, intent);
  if (!outcome.ok) throw new Error(`expected a result, got ${outcome.refusal.kind}: ${outcome.refusal.message}`);
  return outcome;
}

function ofKind<K extends DerivationRecord['kind']>(
  result: ValidatedResult,
  kind: K,
): Extract<DerivationRecord, { kind: K }>[] {
  return result.derivations.filter((d): d is Extract<DerivationRecord, { kind: K }> => d.kind === kind);
}

/** Every source cell of a record belongs to exactly this region. */
function regionsOf(result: ValidatedResult, record: DerivationRecord): string[] {
  const byId = new Map(result.cells.map((c) => [c.resultId, c]));
  return [...new Set(record.sourceResultIds.map((id) => byId.get(id)?.regionCode ?? '<not a cell of this result>'))];
}

describe('region_series — a complete multi-region series', () => {
  it('2 regions x 5 years answer as one region_series result, cells period-major/region-minor', async () => {
    const result = await answer(population({ regions: [AMSTERDAM, ROTTERDAM] }));
    expect(result.shape).toBe('region_series');
    expect(result.cells).toHaveLength(10);
    expect(result.cells.slice(0, 4).map((c) => [c.periodCode, c.regionCode])).toEqual([
      ['2020JJ00', AMSTERDAM],
      ['2020JJ00', ROTTERDAM],
      ['2021JJ00', AMSTERDAM],
      ['2021JJ00', ROTTERDAM],
    ]);
    expect(result.cells.every((c) => c.value !== null)).toBe(true);
    const coverage = result.regionSeries;
    expect(coverage).toBeDefined();
    // The intent's own region order, echoed — this is the chart's series order.
    expect(coverage!.requested).toEqual([AMSTERDAM, ROTTERDAM]);
    expect(coverage!.partial).toEqual([]);
    expect(coverage!.excluded).toEqual([]);
    expect(coverage!.complete).toBe(true);
  });

  it('each region gets its OWN direction and first_last, over its own cells alone (MS1)', async () => {
    const result = await answer(population({ regions: [AMSTERDAM, ROTTERDAM] }));
    const directions = ofKind(result, 'direction');
    const firstLasts = ofKind(result, 'first_last');
    expect(directions).toHaveLength(2);
    expect(firstLasts).toHaveLength(2);
    // One record per region, in the intent's region order, each bound to five
    // cells of that region and nothing else.
    expect(directions.map((d) => regionsOf(result, d))).toEqual([[AMSTERDAM], [ROTTERDAM]]);
    expect(firstLasts.map((d) => regionsOf(result, d))).toEqual([[AMSTERDAM], [ROTTERDAM]]);
    for (const record of [...directions, ...firstLasts]) {
      expect(record.sourceResultIds).toHaveLength(5);
      expect(record.explicit).toBe(false);
    }
  });

  it('NO cross-region claim is supported: zero max records on this shape', async () => {
    const series = await answer(population({ regions: [AMSTERDAM, ROTTERDAM, DEN_HAAG] }));
    expect(series.shape).toBe('region_series');
    expect(ofKind(series, 'max')).toHaveLength(0);

    // The contrast that proves the exclusion is shape-scoped and not a dead
    // branch: the SAME three regions at ONE period still pre-register the
    // comparison max they always did.
    const comparison = await answer(
      population({ regions: [AMSTERDAM, ROTTERDAM, DEN_HAAG], period: { kind: 'codes', codes: ['2024JJ00'] } }),
    );
    expect(comparison.shape).toBe('comparison');
    expect(ofKind(comparison, 'max')).toHaveLength(1);
  });
});

describe('region_series — an incomplete series is answered, disclosed, and never claimed about', () => {
  it('a withheld value makes its region `partial`: cells stay WITH the reason (R11), and it gets NO derivation', async () => {
    // No loaded table produces such a cell naturally, so seed one: Rotterdam's
    // 2022 population becomes Confidential — a value that EXISTS but is not
    // disclosed, so no honest trend can be stated over that window.
    await db.query(
      `update observations set value = null, value_attribute = 'Confidential'
        where table_id = '03759ned' and measure = $1 and region_code = $2 and period_code = '2022JJ00'`,
      [POPULATION_MEASURE, ROTTERDAM],
    );

    const result = await answer(population({ regions: [AMSTERDAM, ROTTERDAM] }));
    expect(result.shape).toBe('region_series');
    // R11: the withheld cell is PRESENT with its reason, never a silent gap —
    // it draws as a gap in the line and names itself in the chart's nullNotes.
    expect(result.cells).toHaveLength(10);
    const held = result.cells.find((c) => c.regionCode === ROTTERDAM && c.periodCode === '2022JJ00')!;
    expect(held.value).toBeNull();
    expect(held.valueAttribute).toBe('Confidential');

    const coverage = result.regionSeries!;
    expect(coverage.partial).toEqual([ROTTERDAM]);
    expect(coverage.excluded).toEqual([]);
    expect(coverage.complete).toBe(false);

    // MS1: exactly one direction and one first_last, both Amsterdam's. The
    // partial region has NO record, so no trend word can bind to it (R9 then
    // fails any such claim closed) — not even first_last, which looks only at
    // the endpoints and would otherwise have been produced.
    const directions = ofKind(result, 'direction');
    const firstLasts = ofKind(result, 'first_last');
    expect(directions).toHaveLength(1);
    expect(firstLasts).toHaveLength(1);
    expect(regionsOf(result, directions[0]!)).toEqual([AMSTERDAM]);
    expect(regionsOf(result, firstLasts[0]!)).toEqual([AMSTERDAM]);
  });

  it('a region with no ROW at a requested period is `excluded` entirely — zero cells, and the query still answers', async () => {
    await db.query(
      `delete from observations
        where table_id = '03759ned' and measure = $1 and region_code = $2 and period_code = '2023JJ00'`,
      [POPULATION_MEASURE, UTRECHT],
    );

    const result = await answer(population({ regions: [AMSTERDAM, DEN_HAAG, UTRECHT] }));
    expect(result.shape).toBe('region_series');
    // Never shortened: a 4-of-5-year line would answer a different question,
    // and a line across the hole would imply an unsampled value (#64).
    expect(result.cells.some((c) => c.regionCode === UTRECHT)).toBe(false);
    expect(result.cells).toHaveLength(10);

    const coverage = result.regionSeries!;
    expect(coverage.requested).toEqual([AMSTERDAM, DEN_HAAG, UTRECHT]);
    expect(coverage.excluded).toEqual([UTRECHT]);
    expect(coverage.partial).toEqual([]);
    expect(coverage.complete).toBe(false);

    // The two served regions keep their own records; the excluded one has none.
    expect(ofKind(result, 'direction').map((d) => regionsOf(result, d))).toEqual([[AMSTERDAM], [DEN_HAAG]]);
  });
});

describe('region_series — the floor and the shape-scoping of the deviation', () => {
  it('a period beyond the freshest leaves NO surviving region and falls back to the existing freshness refusal', async () => {
    const outcome = await runQuery(
      db,
      population({ regions: [AMSTERDAM, DEN_HAAG], period: { kind: 'range', from: '2020JJ00', to: '2027JJ00' } }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    // Already-worded, already-chipped: the floor invents no new refusal.
    expect(outcome.refusal.kind).toBe('freshness');
    // NOT the internal bucket that pages the owner.
    expect(outcome.refusal.kind).not.toBe('no_data');
    expect(outcome.refusal.freshness?.freshestAvailable).toBeTruthy();
  });

  it('below two surviving regions the fallback is EXACTLY what a single-region series over the same hole gets', async () => {
    // Utrecht's 2023 row was deleted above, so this pair has one survivor.
    const pair = await runQuery(db, population({ regions: [AMSTERDAM, UTRECHT] }));
    const single = await runQuery(
      db,
      population({ regions: [UTRECHT], period: { kind: 'range', from: '2022JJ00', to: '2024JJ00' }, derivation: 'series' }),
    );
    expect(pair.ok).toBe(false);
    expect(single.ok).toBe(false);
    if (pair.ok || single.ok) throw new Error('unreachable');
    // Same diagnosis, same axis: the multi-region path adds no new refusal
    // vocabulary — it falls through to the all-or-nothing diagnosis unchanged.
    expect(pair.refusal.kind).toBe(single.refusal.kind);
    expect(pair.refusal.axis).toBe(single.refusal.axis);
  });

  it('the all-or-nothing deviation is SHAPE-SCOPED: a plain series over that same deleted cell still refuses outright', async () => {
    const outcome = await runQuery(
      db,
      population({ regions: [UTRECHT], period: { kind: 'range', from: '2022JJ00', to: '2024JJ00' }, derivation: 'series' }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    // What must NOT happen is a silently 2-period "series" over a 3-year ask.
    expect(['no_data', 'not_published', 'freshness']).toContain(outcome.refusal.kind);
  });

  it('single-region and single-period results are untouched: no regionSeries key at all', async () => {
    const series = await answer(population({ regions: [AMSTERDAM], derivation: 'series' }));
    expect(series.shape).toBe('series');
    expect(Object.hasOwn(series, 'regionSeries')).toBe(false);

    const comparison = await answer(
      population({ regions: [AMSTERDAM, DEN_HAAG], period: { kind: 'codes', codes: ['2024JJ00'] } }),
    );
    expect(comparison.shape).toBe('comparison');
    expect(Object.hasOwn(comparison, 'regionSeries')).toBe(false);
  });
});
