// Query-layer behavior tests (WP5): resolution, validation, the typed-refusal
// taxonomy from docs/05-data-rules.md's failure table, derivation guards, and
// determinism — hermetic against the fixture-ingested PGlite database
// (ADR 009). The benchmark scoring itself lives in benchmark-intents.test.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enumeratePeriods, runQuery } from '../../src/query/index.ts';
import type { QueryRefusal, ResultCell, StructuredIntent } from '../../src/query/index.ts';
import { deriveDifference, deriveDirection, deriveMax } from '../../src/query/derivations.ts';
import { parsePeriodCode } from '../../src/ingestion/periods.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

function intent(partial: Partial<StructuredIntent> & Pick<StructuredIntent, 'target' | 'period'>): StructuredIntent {
  return { schemaVersion: 1, derivation: 'none', ...partial };
}

const population = (extra: Partial<StructuredIntent> = {}): StructuredIntent =>
  intent({
    target: { kind: 'canonical', key: 'population_on_1_january' },
    regions: ['NL01'],
    period: { kind: 'codes', codes: ['2024JJ00'] },
    ...extra,
  });

async function expectRefusal(
  q: StructuredIntent,
  kind: QueryRefusal['refusal']['kind'],
): Promise<QueryRefusal['refusal']> {
  const outcome = await runQuery(db, q);
  expect(outcome.ok, `expected a ${kind} refusal, got a result`).toBe(false);
  if (outcome.ok) throw new Error('unreachable');
  expect(outcome.refusal.kind).toBe(kind);
  return outcome.refusal;
}

describe('period range enumeration (pure)', () => {
  const p = (code: string) => parsePeriodCode(code)!;
  it('expands yearly ranges inclusively', () => {
    expect(enumeratePeriods(p('2019JJ00'), p('2021JJ00'))).toEqual(['2019JJ00', '2020JJ00', '2021JJ00']);
  });
  it('expands quarterly ranges across year boundaries', () => {
    expect(enumeratePeriods(p('2024KW03'), p('2025KW02'))).toEqual(['2024KW03', '2024KW04', '2025KW01', '2025KW02']);
  });
  it('expands monthly ranges across year boundaries', () => {
    expect(enumeratePeriods(p('2024MM11'), p('2025MM02'))).toEqual(['2024MM11', '2024MM12', '2025MM01', '2025MM02']);
  });
  it('a single-period range is just that period', () => {
    expect(enumeratePeriods(p('2024JJ00'), p('2024JJ00'))).toEqual(['2024JJ00']);
  });
});

describe('derivation semantics (pure — the independent oracle for what these words mean)', () => {
  // Hand-stated expectations, NOT re-derived from the implementation's own
  // algorithm: this block pins the SEMANTICS (strict comparisons, net
  // first-vs-last direction, tie behavior, sign convention) so a shared-logic
  // bug cannot slip through the key-data-driven benchmark assertions
  // (adversarial-review finding, 2026-07-03).
  function cellAt(periodCode: string, region: string, value: number | null): ResultCell {
    return {
      resultId: `t:m:${region || '-'}:${periodCode}:-`,
      tableId: 't', measure: 'm', measureTitle: 'm', regionCode: region || null,
      regionLabel: region || null, periodCode, periodLabel: periodCode, grain: 'JJ',
      dims: {}, dimLabels: {}, value, unit: 'aantal', decimals: 0,
      status: 'Definitief', provisional: false, valueAttribute: value === null ? 'Impossible' : 'None',
      batchId: 1,
    };
  }
  const series = (...values: (number | null)[]) => values.map((v, i) => cellAt(`${2019 + i}JJ00`, '', v));

  it('monotonic uses STRICT steps: a flat step is not a break; rise-then-fall is', () => {
    const flatThenRise = deriveDirection(series(1, 1, 2));
    if (!flatThenRise.ok || flatThenRise.record.kind !== 'direction') throw new Error('expected direction');
    expect(flatThenRise.record.monotonic).toBe(true);
    expect(flatThenRise.record.direction).toBe('up');

    const riseThenFall = deriveDirection(series(1, 2, 1));
    if (!riseThenFall.ok || riseThenFall.record.kind !== 'direction') throw new Error('expected direction');
    expect(riseThenFall.record.monotonic).toBe(false);
    // direction is NET (first vs last), independent of the path taken
    expect(riseThenFall.record.direction).toBe('flat');
    expect(riseThenFall.record.netChange).toBe(0);

    const fallThenFlat = deriveDirection(series(5, 3, 3));
    if (!fallThenFlat.ok || fallThenFlat.record.kind !== 'direction') throw new Error('expected direction');
    expect(fallThenFlat.record.monotonic).toBe(true);
    expect(fallThenFlat.record.direction).toBe('down');
  });

  it('difference is later-period minus earlier-period — a decline is negative, never absolute', () => {
    const declining = deriveDifference(series(10, 7));
    if (!declining.ok || declining.record.kind !== 'difference') throw new Error('expected difference');
    expect(declining.record.value).toBe(-3);
  });

  it('max refuses a tie rather than picking a winner arbitrarily', () => {
    const tied = deriveMax([cellAt('2024JJ00', 'A', 5), cellAt('2024JJ00', 'B', 5)], false);
    expect(tied.ok).toBe(false);
  });

  it('every derivation refuses null-valued sources rather than skipping them', () => {
    expect(deriveDirection(series(1, null, 3)).ok).toBe(false);
    expect(deriveDifference(series(null, 3)).ok).toBe(false);
    expect(deriveMax([cellAt('2024JJ00', 'A', null), cellAt('2024JJ00', 'B', 2)], false).ok).toBe(false);
  });
});

describe('resolution and results', () => {
  it('is deterministic: the same intent twice yields identical results', async () => {
    const q = intent({
      target: { kind: 'canonical', key: 'cpi_yearly_inflation' },
      period: { kind: 'range', from: '2020JJ00', to: '2024JJ00' },
      derivation: 'series',
    });
    const first = await runQuery(db, q);
    const second = await runQuery(db, q);
    expect(second).toEqual(first);
  });

  it('result ids are deterministic coordinate ids, not row ids', async () => {
    const outcome = await runQuery(db, population());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.cells[0]!.resultId).toBe(
      '03759ned:M000352:NL01:2024JJ00:BurgerlijkeStaat=T001019;Geslacht=T001038;Leeftijd=10000',
    );
  });

  it('canonical targets merge registry defaults with the concept dims and state the definition', async () => {
    const outcome = await runQuery(
      db,
      intent({
        target: { kind: 'canonical', key: 'unemployment_rate_seasonally_adjusted' },
        period: { kind: 'codes', codes: ['2025KW04'] },
      }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.cells[0]!.dims).toEqual({ SeizoenEnWerkdagcorrectie: 'A050903' });
    expect(outcome.attribution.definitionLabel).toBe('werkloosheidspercentage, seizoengecorrigeerd');
  });

  it('explicit targets reach alternate readings, with no definition label to hide behind', async () => {
    // The unadjusted unemployment variant — the frozen key records it as
    // B5's visible alternate (4.0 seasonally adjusted vs 3.9 unadjusted).
    const outcome = await runQuery(
      db,
      intent({
        target: {
          kind: 'explicit',
          tableId: '85224NED',
          measure: 'M001906',
          dims: { SeizoenEnWerkdagcorrectie: 'A042501' },
        },
        period: { kind: 'codes', codes: ['2025KW04'] },
      }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.cells[0]!.dims).toEqual({ SeizoenEnWerkdagcorrectie: 'A042501' });
    expect(outcome.cells[0]!.dimLabels['SeizoenEnWerkdagcorrectie']).toMatch(/ongecorrigeerd/i);
    expect(outcome.attribution.definitionLabel).toBeNull();
  });

  it('a null-with-reason cell is served as data with its CBS reason, not as missing (R11)', async () => {
    // GM0002 (Aduard) dissolved pre-2019; CBS publishes its rows as
    // value-less with ValueAttribute=Impossible.
    const outcome = await runQuery(db, population({ regions: ['GM0002'] }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.cells[0]!.value).toBeNull();
    expect(outcome.cells[0]!.valueAttribute).toBe('Impossible');
  });

  it('series over null cells omits pre-registered derivations (nothing honest to bind to)', async () => {
    const outcome = await runQuery(
      db,
      population({
        regions: ['GM0002'],
        period: { kind: 'range', from: '2019JJ00', to: '2021JJ00' },
        derivation: 'series',
      }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.cells).toHaveLength(3);
    expect(outcome.derivations).toEqual([]);
  });
});

describe('typed refusals: intent validity', () => {
  it('unknown canonical key', async () => {
    const r = await expectRefusal(
      intent({ target: { kind: 'canonical', key: 'asylum_seekers' }, period: { kind: 'codes', codes: ['2024JJ00'] } }),
      'invalid_intent',
    );
    expect(r.axis).toBe('measure');
  });

  it('unsupported schema version', async () => {
    await expectRefusal({ ...population(), schemaVersion: 2 as 1 }, 'invalid_intent');
  });

  it('malformed period code', async () => {
    await expectRefusal(population({ period: { kind: 'codes', codes: ['2024XX00'] } }), 'invalid_intent');
  });

  it('mixed period grains', async () => {
    await expectRefusal(
      population({ period: { kind: 'codes', codes: ['2024JJ00', '2024KW01'] }, derivation: 'difference' }),
      'invalid_intent',
    );
  });

  it('backwards range', async () => {
    await expectRefusal(population({ period: { kind: 'range', from: '2024JJ00', to: '2020JJ00' } }), 'invalid_intent');
  });

  it('duplicate periods / duplicate regions', async () => {
    await expectRefusal(
      population({ period: { kind: 'codes', codes: ['2024JJ00', '2024JJ00'] } }),
      'invalid_intent',
    );
    await expectRefusal(population({ regions: ['NL01', 'NL01'] }), 'invalid_intent');
  });

  it('unknown measure on a registered table', async () => {
    await expectRefusal(
      intent({ target: { kind: 'explicit', tableId: '82235NED', measure: 'M999999' }, period: { kind: 'codes', codes: ['2024JJ00'] } }),
      'invalid_intent',
    );
  });

  it('unknown region code', async () => {
    const r = await expectRefusal(population({ regions: ['GM9999'] }), 'invalid_intent');
    expect(r.axis).toBe('region');
  });

  it('regions on a table without a geo dimension', async () => {
    const r = await expectRefusal(
      intent({ target: { kind: 'canonical', key: 'cpi_yearly_inflation' }, regions: ['NL01'], period: { kind: 'codes', codes: ['2024JJ00'] } }),
      'invalid_intent',
    );
    expect(r.axis).toBe('region');
  });

  it('unknown dimension name / unknown dimension code on an explicit target', async () => {
    await expectRefusal(
      intent({ target: { kind: 'explicit', tableId: '85224NED', measure: 'M001906', dims: { Voedselvoorkeur: 'X' } }, period: { kind: 'codes', codes: ['2025KW04'] } }),
      'invalid_intent',
    );
    await expectRefusal(
      intent({ target: { kind: 'explicit', tableId: '85224NED', measure: 'M001906', dims: { SeizoenEnWerkdagcorrectie: 'A999999' } }, period: { kind: 'codes', codes: ['2025KW04'] } }),
      'invalid_intent',
    );
  });

  it('derivation arity: difference needs exactly 2 periods, max needs 1 period + ≥2 regions, series needs >1 period', async () => {
    await expectRefusal(
      population({ period: { kind: 'codes', codes: ['2024JJ00'] }, derivation: 'difference' }),
      'invalid_intent',
    );
    await expectRefusal(
      population({ period: { kind: 'codes', codes: ['2022JJ00', '2023JJ00', '2024JJ00'] }, derivation: 'difference' }),
      'invalid_intent',
    );
    await expectRefusal(population({ regions: ['NL01'], derivation: 'max' }), 'invalid_intent');
    await expectRefusal(population({ derivation: 'series' }), 'invalid_intent');
  });

  it('several regions AND several periods at once is out of contract', async () => {
    await expectRefusal(
      population({ regions: ['GM0363', 'GM0599'], period: { kind: 'codes', codes: ['2023JJ00', '2024JJ00'] } }),
      'invalid_intent',
    );
  });
});

describe('typed refusals: clarification and scope (docs/05 failure table)', () => {
  it('a geo table without a region exits to clarification, never a default (principle c)', async () => {
    const r = await expectRefusal(population({ regions: undefined }), 'needs_clarification');
    expect(r.axis).toBe('region');
  });

  it('an unpinned semantic dimension exits to clarification, never a default', async () => {
    // Explicit unemployment target without choosing adjusted/unadjusted.
    const r = await expectRefusal(
      intent({ target: { kind: 'explicit', tableId: '85224NED', measure: 'M001906' }, period: { kind: 'codes', codes: ['2025KW04'] } }),
      'needs_clarification',
    );
    expect(r.message).toContain('SeizoenEnWerkdagcorrectie');
  });

  it('several unresolved axes surface in ONE clarification refusal, all named (docs/05: cover all axes at once)', async () => {
    // In the current registry every plain dimension of the one geo table is
    // covered by default_coordinates, so the both-axes case cannot arise with
    // real data — simulate a table whose defaults don't cover its dims by
    // clearing them, then ask with neither dims nor a region.
    await db.query(`update cbs_tables set default_coordinates = '{}'::jsonb where id = '03759ned'`);
    try {
      const r = await expectRefusal(
        intent({ target: { kind: 'explicit', tableId: '03759ned', measure: 'M000352' }, period: { kind: 'codes', codes: ['2024JJ00'] } }),
        'needs_clarification',
      );
      expect(r.axes).toEqual(['measure', 'region']);
      expect(r.message).toContain('Geslacht');
      expect(r.message).toContain('RegioS');
    } finally {
      await db.query(
        `update cbs_tables set default_coordinates = $2::jsonb where id = $1`,
        ['03759ned', JSON.stringify({ Geslacht: 'T001038', Leeftijd: '10000', BurgerlijkeStaat: 'T001019' })],
      );
    }
  });

  it('an unregistered table refuses as out of loaded scope', async () => {
    await expectRefusal(
      intent({ target: { kind: 'explicit', tableId: '99999NED', measure: 'M1' }, period: { kind: 'codes', codes: ['2024JJ00'] } }),
      'table_not_registered',
    );
  });

  it('a quarantined table is never served', async () => {
    await db.query(`update cbs_tables set status = 'needs_review', needs_review_reason = 'test quarantine' where id = '82235NED'`);
    try {
      await expectRefusal(
        intent({ target: { kind: 'canonical', key: 'housing_stock_start_of_year' }, period: { kind: 'codes', codes: ['2024JJ00'] } }),
        'table_quarantined',
      );
    } finally {
      await db.query(`update cbs_tables set status = 'active', needs_review_reason = null where id = '82235NED'`);
    }
  });

  it('a period before the loaded slice refuses as outside-the-slice, naming the floor — NOT as unpublished', async () => {
    const r = await expectRefusal(population({ period: { kind: 'codes', codes: ['2018JJ00'] } }), 'outside_loaded_slice');
    expect(r.nearestAlternative).toBe('2019JJ00');
    expect(r.message).toContain('outside our ingested slice');
  });

  it('a region outside the loaded slice prefixes refuses as outside-the-slice', async () => {
    // CR01 (a COROP area) exists in the published region list but the slice
    // loads only NL/PV/GM codes.
    const r = await expectRefusal(population({ regions: ['CR01'] }), 'outside_loaded_slice');
    expect(r.axis).toBe('region');
  });

  it('a dimension coordinate outside the loaded slice refuses as outside-the-slice', async () => {
    // Men-only population: published by CBS, sliced out at ingestion.
    const r = await expectRefusal(
      intent({
        target: {
          kind: 'explicit',
          tableId: '03759ned',
          measure: 'M000352',
          dims: { Geslacht: '3000', Leeftijd: '10000', BurgerlijkeStaat: 'T001019' },
        },
        regions: ['NL01'],
        period: { kind: 'codes', codes: ['2024JJ00'] },
      }),
      'outside_loaded_slice',
    );
    expect(r.nearestAlternative).toBe('T001038');
  });
});

describe('typed refusals: period availability', () => {
  it('a period CBS never published refuses as not_published', async () => {
    // CPI 2025=100 series does not reach back to 1900.
    const r = await expectRefusal(
      intent({ target: { kind: 'canonical', key: 'cpi_yearly_inflation' }, period: { kind: 'codes', codes: ['1900JJ00'] } }),
      'not_published',
    );
    expect(r.axis).toBe('period');
  });

  it('a grain the table does not publish refuses as not_published, naming available grains', async () => {
    // Housing stock is yearly only.
    const r = await expectRefusal(
      intent({ target: { kind: 'canonical', key: 'housing_stock_start_of_year' }, period: { kind: 'codes', codes: ['2024KW01'] } }),
      'not_published',
    );
    expect(r.message).toContain('JJ');
  });

  it('a period beyond the freshest available refuses as freshness, offering period + status but no value', async () => {
    const r = await expectRefusal(
      intent({ target: { kind: 'canonical', key: 'unemployment_rate_seasonally_adjusted' }, period: { kind: 'codes', codes: ['2030KW01'] } }),
      'freshness',
    );
    expect(r.freshness?.freshestAvailable?.periodCode).toBeTruthy();
    expect(r.freshness?.freshestAvailable?.status).toBeTruthy();
    expect(r.nearestAlternative).toBe(r.freshness?.freshestAvailable?.periodCode);
    expect(r.freshness?.freshestAvailable).not.toHaveProperty('value');
  });

  it('a range reaching past the freshest year refuses as freshness (all-or-nothing, no partial series)', async () => {
    const r = await expectRefusal(
      intent({
        target: { kind: 'canonical', key: 'cpi_yearly_inflation' },
        period: { kind: 'range', from: '2020JJ00', to: '2035JJ00' },
        derivation: 'series',
      }),
      'freshness',
    );
    expect(r.freshness?.freshestAvailable?.periodCode).toBeTruthy();
  });

  it('a published, in-slice period whose observation is absent refuses loudly as no_data', async () => {
    // Simulate an ingest gap by removing one cell, restoring it afterwards.
    const coords = [
      '82235NED',
      'D002936',
      '',
      '2020JJ00',
    ] as const;
    const saved = await db.query(
      `select * from observations where table_id=$1 and measure=$2 and region_code=$3 and period_code=$4`,
      [...coords],
    );
    expect(saved.rows).toHaveLength(1);
    const row = saved.rows[0]!;
    await db.query(
      `delete from observations where table_id=$1 and measure=$2 and region_code=$3 and period_code=$4`,
      [...coords],
    );
    try {
      const r = await expectRefusal(
        intent({ target: { kind: 'canonical', key: 'housing_stock_start_of_year' }, period: { kind: 'codes', codes: ['2020JJ00'] } }),
        'no_data',
      );
      expect(r.message).toContain('data gap');
    } finally {
      await db.query(
        `insert into observations
           (table_id, measure, region_code, period_code, period_grain, period_year, period_index,
            dims, value, unit, decimals, status, value_attribute, batch_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          row.table_id, row.measure, row.region_code, row.period_code, row.period_grain,
          row.period_year, row.period_index, JSON.stringify(row.dims), row.value, row.unit,
          row.decimals, row.status, row.value_attribute, row.batch_id,
        ],
      );
    }
  });
});

describe('typed refusals: derivations (R5 guards)', () => {
  it('difference over null-with-reason cells refuses rather than computes', async () => {
    const r = await expectRefusal(
      population({ regions: ['GM0002'], period: { kind: 'codes', codes: ['2019JJ00', '2020JJ00'] }, derivation: 'difference' }),
      'derivation_failed',
    );
    expect(r.message).toContain('Impossible');
  });

  it('mixed units across one measure refuse as internal inconsistency rather than serve (R10)', async () => {
    await db.query(`update observations set unit = 'gecorrumpeerd' where table_id='82235NED' and measure='D002936' and period_code='2023JJ00'`);
    try {
      await expectRefusal(
        intent({
          target: { kind: 'canonical', key: 'housing_stock_start_of_year' },
          period: { kind: 'range', from: '2022JJ00', to: '2024JJ00' },
          derivation: 'series',
        }),
        'internal_inconsistency',
      );
    } finally {
      await db.query(`update observations set unit = 'x 1 000' where table_id='82235NED' and measure='D002936' and period_code='2023JJ00'`);
    }
  });
});
