// #253 Task 3 — the `region_set` fetch branch and its coverage record, against
// the real hermetic ingest (ADR 009).
//
// The one deliberate deviation this file pins: for THIS shape only, a roster
// member we cannot serve does not refuse the whole query. That is safe because
// nothing is silent — the member lands in the coverage record, and a withheld
// or missing member sets `complete: false`, which is what suppresses the
// ranking derivation (RS1, Task 4). The last test in the "still all-or-nothing"
// block proves the deviation is shape-scoped: a `series` intent over the SAME
// deleted cell still refuses outright.
//
// Test ORDER is load-bearing from "a withheld member" onwards: those cases
// surgically mutate this suite's own private PGlite (every createIngestedDb
// caller gets its own — tests/helpers/fixture-snapshot.ts), each on coordinates
// the later cases do not depend on.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runQuery } from '../../src/query/index.ts';
import { REGION_SET_MAX_MEMBERS } from '../../src/query/region-set.ts';
import type { StructuredIntent, ValidatedResult } from '../../src/query/index.ts';
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

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

describe('region_set — a complete class', () => {
  it('all 12 provincies answer as one region_set result with complete coverage', async () => {
    const result = await answer(population({ regionSet: { kind: 'all_provincies' } }));
    expect(result.shape).toBe('region_set');
    expect(result.cells).toHaveLength(12);
    expect(result.cells.every((c) => c.value !== null)).toBe(true);
    const coverage = result.regionSet;
    expect(coverage).toBeDefined();
    expect(coverage!.scope).toEqual({ kind: 'all_provincies' });
    expect(coverage!.rosterSize).toBe(12);
    expect(coverage!.notApplicable).toEqual([]);
    expect(coverage!.withheld).toEqual([]);
    expect(coverage!.missing).toEqual([]);
    expect(coverage!.complete).toBe(true);
  });

  it('abolished gemeenten (CBS reason Impossible) are NOT members at that period — 42 in the roster, 26 cells, 16 not applicable, still complete', async () => {
    const result = await answer({
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'average_home_sale_price_by_gemeente' },
      period: { kind: 'codes', codes: ['2024JJ00'] },
      derivation: 'none',
      regionSet: { kind: 'gemeenten_in_provincie', parent: 'PV26' },
    });
    expect(result.shape).toBe('region_set');
    expect(result.cells).toHaveLength(26);
    const coverage = result.regionSet!;
    expect(coverage.rosterSize).toBe(42);
    expect(coverage.notApplicable).toHaveLength(16);
    expect(coverage.withheld).toEqual([]);
    expect(coverage.missing).toEqual([]);
    // CBS's own statement that the coordinate does not exist does not make the
    // class incomplete — the 26 that DO exist are all of them.
    expect(coverage.complete).toBe(true);
  });
});

describe('region_set — an incomplete class is answered, disclosed, and never ranked', () => {
  it('a withheld value (null for a reason other than Impossible) stays a CELL, lands in `withheld`, and breaks completeness', async () => {
    // No loaded table produces such a cell naturally, so seed one: PV20's
    // population becomes Confidential — a value that EXISTS but is not
    // disclosed, and could have been the maximum.
    await db.query(
      `update observations set value = null, value_attribute = 'Confidential'
        where table_id = '03759ned' and measure = $1 and region_code = 'PV20' and period_code = '2025JJ00'`,
      [POPULATION_MEASURE],
    );

    const result = await answer(population({ regionSet: { kind: 'all_provincies' } }));
    // R11: the withheld cell is PRESENT with its reason, never a silent gap.
    expect(result.cells).toHaveLength(12);
    const pv20 = result.cells.find((c) => c.regionCode === 'PV20')!;
    expect(pv20.value).toBeNull();
    expect(pv20.valueAttribute).toBe('Confidential');
    const coverage = result.regionSet!;
    expect(coverage.withheld).toEqual(['PV20']);
    expect(coverage.notApplicable).toEqual([]);
    expect(coverage.complete).toBe(false);
  });

  it('a member with no row at all lands in `missing` — and the query still answers', async () => {
    await db.query(
      `delete from observations
        where table_id = '03759ned' and measure = $1 and region_code = 'PV21' and period_code = '2025JJ00'`,
      [POPULATION_MEASURE],
    );

    const result = await answer(population({ regionSet: { kind: 'all_provincies' } }));
    expect(result.cells).toHaveLength(11);
    expect(result.cells.some((c) => c.regionCode === 'PV21')).toBe(false);
    const coverage = result.regionSet!;
    expect(coverage.rosterSize).toBe(12);
    expect(coverage.missing).toEqual(['PV21']);
    expect(coverage.complete).toBe(false);
  });

  it('the deviation is SHAPE-SCOPED: a series over that same deleted cell still refuses outright', async () => {
    const outcome = await runQuery(
      db,
      population({ regions: ['PV21'], period: { kind: 'range', from: '2024JJ00', to: '2025JJ00' }, derivation: 'series' }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    // Any of the diagnosed missing-cell kinds is fine here; what must NOT
    // happen is a silently 1-period "series".
    expect(['no_data', 'not_published', 'freshness']).toContain(outcome.refusal.kind);
  });
});

describe('region_set — the refusal boundaries', () => {
  it('fewer than 2 members with a value refuses as a data gap', async () => {
    // PV24 (Flevoland) has 7 gemeenten in this table; leave exactly one with a
    // value.
    await db.query(
      `update observations set value = null, value_attribute = 'Impossible'
        where table_id = '03759ned' and measure = $1 and period_code = '2025JJ00'
          and region_code in (
            select code from dimension_labels
             where table_id = '03759ned' and dimension = 'RegioS' and dimension_group = 'GMPV24'
             order by code offset 1)`,
      [POPULATION_MEASURE],
    );

    const outcome = await runQuery(
      db,
      population({ regionSet: { kind: 'gemeenten_in_provincie', parent: 'PV24' } }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.refusal.kind).toBe('no_data');
    expect(outcome.refusal.axis).toBe('region');
  });

  it(`a class carrying more than ${REGION_SET_MAX_MEMBERS} cells refuses rather than storing an unreadable envelope`, async () => {
    // "Alle gemeenten" carries ~342 applicable cells at 2025JJ00 — under the
    // cap by design. Turn enough Impossible members into withheld ones (which
    // DO become cells, R11) to cross it.
    const before = await runQuery(db, population({ regionSet: { kind: 'all_gemeenten' } }));
    expect(before.ok).toBe(true);

    await db.query(
      `update observations set value_attribute = 'Confidential'
        where id in (
          select id from observations
           where table_id = '03759ned' and measure = $1 and period_code = '2025JJ00'
             and value is null and value_attribute = 'Impossible' and region_code like 'GM%'
           order by id limit 300)`,
      [POPULATION_MEASURE],
    );

    const outcome = await runQuery(db, population({ regionSet: { kind: 'all_gemeenten' } }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.refusal.kind).toBe('invalid_intent');
    expect(outcome.refusal.message).toContain(String(REGION_SET_MAX_MEMBERS));
  });
});
