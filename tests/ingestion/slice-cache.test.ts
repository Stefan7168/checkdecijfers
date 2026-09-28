// registerSchemaOnly (breadth step 2, Task 3) and fetchSlice (Task 4): schema-only registration for
// slice-cache tables — metadata, code lists, numeric-measure units and
// fingerprint, ZERO observation rows. Uses the same PGlite/FixtureSource
// pattern as tests/ingestion/ingestion.test.ts so this exercises real
// parsing code (ADR 003), not a hand-rolled shape.
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixtureSource, loadFixtureDocs } from '../../src/cbs-adapter/fixture-source.ts';
import { computeFingerprint } from '../../src/ingestion/fingerprint.ts';
import { registerTables, syncTable } from '../../src/ingestion/pipeline.ts';
import { SEED_TABLES } from '../../src/ingestion/registry-seed.ts';
import {
  fetchSlice,
  registerSchemaOnly,
  sliceFilterKey,
  SLICE_MAX_CELLS,
  type SliceRequest,
} from '../../src/ingestion/slice-cache.ts';
import type { CbsObservationRow, CbsSlice, CbsSource } from '../../src/cbs-adapter/types.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

let db: Db;
let closeDb: () => Promise<void>;

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await db.query(
    'truncate table observations, dimension_labels, ingestion_batches, cbs_tables restart identity cascade',
  );
});

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));

function fixturePath(tableId: string): string {
  return `${FIXTURES_DIR}/${tableId}`;
}

async function loadDocs(tableId: string) {
  return loadFixtureDocs(fixturePath(tableId));
}

function table(id: string) {
  const t = SEED_TABLES.find((entry) => entry.id === id);
  if (!t) throw new Error(`no Phase0Table registry entry for ${id}`);
  return t;
}

async function cbsTablesRow(tableId: string): Promise<Record<string, unknown>> {
  const result = await db.query('select * from cbs_tables where id = $1', [tableId]);
  const row = result.rows[0];
  if (!row) throw new Error(`no cbs_tables row for ${tableId}`);
  return row;
}

function parseJsonb<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

async function labelCount(tableId: string): Promise<number> {
  const result = await db.query('select count(*)::int as n from dimension_labels where table_id = $1', [tableId]);
  return Number(result.rows[0]!.n);
}

describe('registerSchemaOnly (breadth step 2, Task 3)', () => {
  it('registers 83625NED (region + time, one numeric measure) as slice_cache with no observation rows', async () => {
    const docs = await loadDocs('83625NED');
    const source = new FixtureSource(docs);

    const result = await registerSchemaOnly(db, source, '83625NED');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.tableId).toBe('83625NED');
    expect(result.alreadyRegistered).toBe(false);
    expect(result.numericMeasures).toEqual(['M001534']);

    const row = await cbsTablesRow('83625NED');
    expect(row.ingest_mode).toBe('slice_cache');
    expect(row.slice).toBeNull();
    expect(row.pinned).toBe(false);
    expect(row.last_row_count).toBeNull();
    expect(row.source).toBe('cbs');
    expect(row.title).toBe('Bestaande koopwoningen; gemiddelde verkoopprijzen, regio');

    // schema_cbs_modified: the fixture's own properties.json 'Modified'.
    const schema = await source.fetchTableSchema('83625NED');
    expect(schema.modified).toBe('2026-02-17T00:00:00+01:00');
    expect(new Date(row.schema_cbs_modified as string).getTime()).toBe(new Date(schema.modified!).getTime());

    // units: exactly the one numeric measure, with its real CBS metadata.
    const units = parseJsonb<Record<string, { unit: string; decimals: number; title: string }>>(row.units);
    expect(Object.keys(units)).toEqual(['M001534']);
    expect(units.M001534).toMatchObject({ unit: 'euro', decimals: 0, title: 'Gemiddelde verkoopprijs' });

    // expected_dimensions: both dimensions, sorted by name.
    const expectedDimensions = parseJsonb<{ name: string; kind: string }[]>(row.expected_dimensions);
    expect(expectedDimensions).toEqual([
      { name: 'Perioden', kind: 'TimeDimension' },
      { name: 'RegioS', kind: 'GeoDimension' },
    ]);

    // schema_fingerprint: computed NOW over the numeric measures only, using
    // the exact same fingerprint function registerTables/syncTable use.
    const expectedFingerprint = computeFingerprint(schema.dimensions, ['M001534']);
    expect(row.schema_fingerprint).toBe(expectedFingerprint);

    // dimension_labels: every RegioS + Perioden code, no observations written.
    const regioCodes = await source.fetchCodeList('83625NED', 'RegioS');
    const periodCodes = await source.fetchCodeList('83625NED', 'Perioden');
    expect(await labelCount('83625NED')).toBe(regioCodes.length + periodCodes.length);

    const observations = await db.query('select count(*)::int as n from observations where table_id = $1', [
      '83625NED',
    ]);
    expect(Number(observations.rows[0]!.n)).toBe(0);
  });

  it('registers 85224NED (breakdowns, many numeric measures) as slice_cache', async () => {
    const docs = await loadDocs('85224NED');
    const source = new FixtureSource(docs);

    const result = await registerSchemaOnly(db, source, '85224NED');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.alreadyRegistered).toBe(false);

    const schema = await source.fetchTableSchema('85224NED');
    const expectedNumeric = schema.measures.filter((m) => m.dataType !== 'String').map((m) => m.code);
    expect(expectedNumeric.length).toBeGreaterThan(1); // this table's whole point: many measures
    expect(result.numericMeasures.sort()).toEqual(expectedNumeric.sort());

    const row = await cbsTablesRow('85224NED');
    expect(row.ingest_mode).toBe('slice_cache');
    const units = parseJsonb<Record<string, unknown>>(row.units);
    expect(Object.keys(units).sort()).toEqual(expectedNumeric.sort());
  });

  it('registers a MIXED table (70072ned, machine period status fixed): units cover only numeric measures', async () => {
    // 70072ned is refused elsewhere for having no machine period status at
    // all (see the next test) — here every Perioden code is given a real
    // Status so registration can proceed, isolating the actual thing this
    // test checks: a table with BOTH numeric and text measures must register
    // with units/fingerprint scoped to the numeric ones only, never the text
    // ones (breadth step 2 constraints: text measures are never servable).
    const docs = await loadDocs('70072ned');
    const fixed = structuredClone(docs);
    const periods = (fixed.codes as Record<string, { value: { Status: string | null }[] }>)['Perioden']!;
    for (const p of periods.value) p.Status = 'Definitief';
    const source = new FixtureSource(fixed);

    const schema = await source.fetchTableSchema('70072ned');
    const numericCodes = schema.measures.filter((m) => m.dataType !== 'String').map((m) => m.code).sort();
    const stringCodes = schema.measures.filter((m) => m.dataType === 'String').map((m) => m.code);
    const allCodes = schema.measures.map((m) => m.code).sort();
    // Sanity pin on the real fixture content this test relies on being
    // genuinely mixed (not hardcoded into the assertions below, which all
    // derive from `schema.measures` itself).
    expect(schema.measures.length).toBe(248);
    expect(numericCodes.length).toBe(208);
    expect(stringCodes.length).toBe(40);

    const result = await registerSchemaOnly(db, source, '70072ned');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.numericMeasures).toEqual(numericCodes);

    const row = await cbsTablesRow('70072ned');
    const units = parseJsonb<Record<string, unknown>>(row.units);
    expect(Object.keys(units).sort()).toEqual(numericCodes);
    for (const code of stringCodes) expect(units[code]).toBeUndefined(); // none of the 40 String codes

    const expectedFingerprint = computeFingerprint(schema.dimensions, numericCodes);
    expect(row.schema_fingerprint).toBe(expectedFingerprint);
    const allCodesFingerprint = computeFingerprint(schema.dimensions, allCodes);
    expect(row.schema_fingerprint).not.toBe(allCodesFingerprint);
  });

  it('refuses 70072ned: every Perioden code has status null (no machine period status)', async () => {
    const docs = await loadDocs('70072ned');
    const source = new FixtureSource(docs);

    const result = await registerSchemaOnly(db, source, '70072ned');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('no_machine_period_status');
    expect(result.summary.toLowerCase()).toContain('status');
    expect(result.summary).toContain('70072ned');

    const rows = await db.query('select id from cbs_tables where id = $1', ['70072ned']);
    expect(rows.rows.length).toBe(0); // refusal writes nothing
    expect(await labelCount('70072ned')).toBe(0);
  });

  it('refuses a table whose TimeDimension code list came back empty (no periods)', async () => {
    const docs = await loadDocs('83625NED');
    const corrupt = structuredClone(docs);
    (corrupt.codes as Record<string, unknown>)['Perioden'] = { value: [] };
    const source = new FixtureSource(corrupt);

    const result = await registerSchemaOnly(db, source, '83625NED');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('no_periods');
    expect(result.summary).toContain('83625NED');
    expect(result.summary).toContain('Perioden'); // names the actual time-dimension name

    const rows = await db.query('select id from cbs_tables where id = $1', ['83625NED']);
    expect(rows.rows.length).toBe(0);
    expect(await labelCount('83625NED')).toBe(0);
  });

  it('refuses a table whose Properties document has no CBS Modified date', async () => {
    const docs = await loadDocs('83625NED');
    const corrupt = structuredClone(docs);
    delete (corrupt.properties as Record<string, unknown>).Modified;
    const source = new FixtureSource(corrupt);

    const result = await registerSchemaOnly(db, source, '83625NED');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('no_cbs_modified');
    expect(result.summary).toContain('83625NED');
    expect(result.summary.toLowerCase()).toContain('modified');

    const rows = await db.query('select id from cbs_tables where id = $1', ['83625NED']);
    expect(rows.rows.length).toBe(0);
    expect(await labelCount('83625NED')).toBe(0);
  });

  it('refuses a table with no TimeDimension', async () => {
    const docs = await loadDocs('83625NED');
    const corrupt = structuredClone(docs);
    const dims = corrupt.dimensions as { value: { Identifier: string; Kind: string }[] };
    for (const dim of dims.value) {
      if (dim.Identifier === 'Perioden') dim.Kind = 'Dimension';
    }
    const source = new FixtureSource(corrupt);

    const result = await registerSchemaOnly(db, source, '83625NED');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('no_time_dimension');
    expect(result.summary).toContain('83625NED');

    const rows = await db.query('select id from cbs_tables where id = $1', ['83625NED']);
    expect(rows.rows.length).toBe(0);
  });

  it("refuses a table whose every measure's DataType is 'String' (no numeric measures)", async () => {
    const docs = await loadDocs('83625NED');
    const corrupt = structuredClone(docs);
    const measures = corrupt.measureCodes as { value: { DataType: string }[] };
    for (const m of measures.value) m.DataType = 'String';
    const source = new FixtureSource(corrupt);

    const result = await registerSchemaOnly(db, source, '83625NED');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('no_numeric_measures');
    expect(result.summary).toContain('83625NED');

    const rows = await db.query('select id from cbs_tables where id = $1', ['83625NED']);
    expect(rows.rows.length).toBe(0);
  });

  it('is idempotent: already registered as slice_cache -> ok, alreadyRegistered, no additional writes', async () => {
    const docs = await loadDocs('83625NED');
    const source = new FixtureSource(docs);

    const first = await registerSchemaOnly(db, source, '83625NED');
    expect(first.ok).toBe(true);

    const rowCountBefore = (await db.query('select count(*)::int as n from cbs_tables')).rows[0]!.n;
    const labelsBefore = await labelCount('83625NED');
    const rowBefore = await cbsTablesRow('83625NED');

    const second = await registerSchemaOnly(db, source, '83625NED');

    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error('unreachable');
    expect(second.alreadyRegistered).toBe(true);
    expect(second.tableId).toBe('83625NED');
    expect(second.numericMeasures).toEqual(['M001534']);

    const rowCountAfter = (await db.query('select count(*)::int as n from cbs_tables')).rows[0]!.n;
    expect(rowCountAfter).toBe(rowCountBefore);
    expect(await labelCount('83625NED')).toBe(labelsBefore);
    const rowAfter = await cbsTablesRow('83625NED');
    expect(rowAfter.updated_at).toEqual(rowBefore.updated_at); // untouched, not just unchanged-looking
  });

  it('already registered as full -> registered_as_full; the whole-table path owns it, no writes here', async () => {
    const docs = await loadDocs('83625NED');
    const source = new FixtureSource(docs);

    await registerTables(db, source, [table('83625NED')]);
    const fullRow = await cbsTablesRow('83625NED');
    expect(fullRow.ingest_mode).toBe('full'); // migration 037's default, untouched by registerTables

    const result = await registerSchemaOnly(db, source, '83625NED');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('registered_as_full');
    expect(result.summary).toContain('83625NED');

    // Nothing about the full registration changed.
    const rowAfter = await cbsTablesRow('83625NED');
    expect(rowAfter).toEqual(fullRow);
  });
});

// ---------------------------------------------------------------------------
// fetchSlice (breadth step 2, Task 4)
// ---------------------------------------------------------------------------

/** Wraps a source and counts EVERY call (request refusals must make none),
 * recording the slice + dimension names handed to fetchObservations. */
function counting(inner: CbsSource) {
  const counter = { calls: 0, slices: [] as (CbsSlice | undefined)[], dimensionNames: [] as (string[] | undefined)[] };
  const source: CbsSource = {
    fetchTableSchema: (t, s) => {
      counter.calls++;
      return inner.fetchTableSchema(t, s);
    },
    fetchCodeList: (t, d, s) => {
      counter.calls++;
      return inner.fetchCodeList(t, d, s);
    },
    fetchObservations: (t, s, n) => {
      counter.calls++;
      counter.slices.push(s);
      counter.dimensionNames.push(n);
      return inner.fetchObservations(t, s, n);
    },
    fetchObservationCount: (t) => {
      counter.calls++;
      return inner.fetchObservationCount(t);
    },
    fetchCatalog: () => {
      counter.calls++;
      return inner.fetchCatalog();
    },
  };
  return { source, counter };
}

/** A source whose observations are replaced by `rows(inner rows)` — for
 * crafting CBS responses the fixtures do not contain. */
function withObservations(
  inner: CbsSource,
  transform: (rows: CbsObservationRow[]) => CbsObservationRow[],
  ignoreSlice = false,
): CbsSource {
  return {
    fetchTableSchema: (t, s) => inner.fetchTableSchema(t, s),
    fetchCodeList: (t, d, s) => inner.fetchCodeList(t, d, s),
    async *fetchObservations(t, s, n) {
      const all: CbsObservationRow[] = [];
      for await (const page of inner.fetchObservations(t, ignoreSlice ? undefined : s, n)) all.push(...page);
      yield transform(all);
    },
    fetchObservationCount: (t) => inner.fetchObservationCount(t),
    fetchCatalog: () => inner.fetchCatalog(),
  };
}

async function observationRows(tableId: string) {
  const result = await db.query(
    `select measure, region_code, period_code, period_grain, period_year, dims, value, unit, decimals,
            status, value_attribute, batch_id
       from observations where table_id = $1 order by region_code, period_code, measure`,
    [tableId],
  );
  return result.rows.map((r) => ({
    measure: r.measure as string,
    region_code: r.region_code as string,
    period_code: r.period_code as string,
    period_grain: r.period_grain as string,
    period_year: r.period_year as number,
    dims: parseJsonb<Record<string, string>>(r.dims),
    value: r.value == null ? null : Number(r.value),
    unit: r.unit as string,
    decimals: r.decimals as number,
    status: r.status as string,
    value_attribute: r.value_attribute as string,
    batch_id: r.batch_id,
  }));
}

async function sliceFetchRows(tableId: string) {
  return (await db.query('select * from slice_fetches where table_id = $1 order by id', [tableId])).rows;
}

async function batchRow(id: number) {
  return (await db.query('select * from ingestion_batches where id = $1', [id])).rows[0]!;
}

async function batchCount(tableId: string): Promise<number> {
  return Number((await db.query('select count(*)::int as n from ingestion_batches where table_id = $1', [tableId])).rows[0]!.n);
}

async function registered(tableId: string, docs?: Awaited<ReturnType<typeof loadDocs>>) {
  const d = docs ?? (await loadDocs(tableId));
  const reg = await registerSchemaOnly(db, new FixtureSource(d), tableId);
  if (!reg.ok) throw new Error(`registration failed: ${reg.summary}`);
  return d;
}

const HOUSE_PRICES: SliceRequest = {
  measures: ['M001534'],
  members: { RegioS: ['NL01', 'GM0363'] },
  periods: ['2024JJ00', '2025JJ00'],
};

describe('fetchSlice (breadth step 2, Task 4)', () => {
  it('fetches, validates and stores exactly the requested cells (83625NED, region + time)', async () => {
    const docs = await registered('83625NED');
    const { source, counter } = counting(new FixtureSource(docs));

    const result = await fetchSlice(db, source, '83625NED', HOUSE_PRICES);

    expect(result).toMatchObject({ ok: true, rowsStored: 4, missingCells: 0, filterKey: sliceFilterKey(HOUSE_PRICES) });
    if (!result.ok) throw new Error('unreachable');

    // The exact narrow filter reached the source, with the validated dimension names.
    expect(counter.slices).toEqual([
      {
        measures: ['M001534'],
        dimensionIn: { RegioS: ['GM0363', 'NL01'] },
        periodIn: { dimension: 'Perioden', codes: ['2024JJ00', '2025JJ00'] },
      },
    ]);
    expect([...(counter.dimensionNames[0] ?? [])].sort()).toEqual(['Perioden', 'RegioS']);

    // Values equal the fixture's own cells, stored with syncTable's column derivation.
    const expected = new Map<string, number>();
    const page = docs.observationPages[0] as { value: { Measure: string; RegioS: string; Perioden: string; Value: number }[] };
    for (const r of page.value) expected.set(`${r.RegioS}|${r.Perioden}|${r.Measure}`, r.Value);
    const rows = await observationRows('83625NED');
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.value).toBe(expected.get(`${row.region_code}|${row.period_code}|${row.measure}`));
      expect(row).toMatchObject({ unit: 'euro', decimals: 0, status: 'Definitief', period_grain: 'JJ', dims: {}, value_attribute: 'None' });
      expect(Number(row.batch_id)).toBe(result.batchId);
    }
    expect(rows.map((r) => `${r.region_code}|${r.period_code}`)).toEqual([
      'GM0363|2024JJ00',
      'GM0363|2025JJ00',
      'NL01|2024JJ00',
      'NL01|2025JJ00',
    ]);

    const batch = await batchRow(result.batchId);
    expect(batch).toMatchObject({ outcome: 'succeeded', row_count: 4, rows_inserted: 4, rows_updated: 0, rows_unchanged: 0, rows_missing: 0 });

    const fetches = await sliceFetchRows('83625NED');
    expect(fetches).toHaveLength(1);
    expect(fetches[0]).toMatchObject({ filter_key: result.filterKey, row_count: 4 });
    expect(Number(fetches[0]!.batch_id)).toBe(result.batchId);
    expect(parseJsonb(fetches[0]!.filter)).toEqual(JSON.parse(result.filterKey));
    expect(new Date(fetches[0]!.cbs_modified as string).getTime()).toBe(new Date('2026-02-17T00:00:00+01:00').getTime());

    // A slice is not a full sync: no row-count history is touched.
    const table = await cbsTablesRow('83625NED');
    expect(table.last_row_count).toBeNull();
    expect(table.status).toBe('active');
  });

  it('counts requested cells CBS has no row for as missingCells (recorded, not an error)', async () => {
    // The fixture capture starts at 2015: 1995JJ00 is a published period with no cell here.
    const docs = await registered('83625NED');
    const req: SliceRequest = { measures: ['M001534'], members: { RegioS: ['NL01'] }, periods: ['1995JJ00', '2015JJ00'] };

    const result = await fetchSlice(db, new FixtureSource(docs), '83625NED', req);

    expect(result).toMatchObject({ ok: true, rowsStored: 1, missingCells: 1 });
    if (!result.ok) throw new Error('unreachable');
    expect((await batchRow(result.batchId)).rows_missing).toBe(1);
    expect((await sliceFetchRows('83625NED'))[0]).toMatchObject({ row_count: 1 });
  });

  it('is idempotent: the same request twice changes nothing and keeps one slice_fetches row', async () => {
    const docs = await registered('83625NED');
    const source = new FixtureSource(docs);

    const first = await fetchSlice(db, source, '83625NED', HOUSE_PRICES);
    const before = await observationRows('83625NED');
    // Same request, different list order: same canonical key.
    const second = await fetchSlice(db, source, '83625NED', {
      measures: ['M001534'],
      members: { RegioS: ['GM0363', 'NL01'] },
      periods: ['2025JJ00', '2024JJ00'],
    });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('unreachable');
    expect(second.filterKey).toBe(first.filterKey);
    expect(await batchRow(second.batchId)).toMatchObject({ outcome: 'succeeded', rows_inserted: 0, rows_updated: 0, rows_unchanged: 4 });
    expect(await observationRows('83625NED')).toEqual(before); // batch_id included: the second upsert wrote nothing

    const fetches = await sliceFetchRows('83625NED');
    expect(fetches).toHaveLength(1);
    expect(Number(fetches[0]!.batch_id)).toBe(second.batchId);
  });

  it('stores breakdown dimensions in dims (85224NED)', async () => {
    const docs = await registered('85224NED');
    const req: SliceRequest = {
      measures: ['T001143_2'],
      members: { SeizoenEnWerkdagcorrectie: ['A042501'] },
      periods: ['2026KW01'],
    };

    const result = await fetchSlice(db, new FixtureSource(docs), '85224NED', req);

    expect(result).toMatchObject({ ok: true, rowsStored: 1, missingCells: 0 });
    const rows = await observationRows('85224NED');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      region_code: '',
      period_code: '2026KW01',
      period_grain: 'KW',
      dims: { SeizoenEnWerkdagcorrectie: 'A042501' },
      status: 'Definitief',
    });
  });

  it('stores each cell with its period publication status (R11): provisional stays provisional', async () => {
    // 82610NED: 2024JJ00/2025JJ00 are NaderVoorlopig, 2023JJ00 Definitief.
    const docs = await registered('82610NED');
    const req: SliceRequest = { measures: ['M002416_1'], members: { BronTechniek: ['T001028'] }, periods: ['2023JJ00', '2025JJ00'] };

    const result = await fetchSlice(db, new FixtureSource(docs), '82610NED', req);

    expect(result).toMatchObject({ ok: true, rowsStored: 2 });
    const rows = await observationRows('82610NED');
    expect(rows.map((r) => [r.period_code, r.status])).toEqual([
      ['2023JJ00', 'Definitief'],
      ['2025JJ00', 'NaderVoorlopig'],
    ]);
  });

  describe('request refusals happen before any network call', () => {
    async function refused(tableId: string, req: SliceRequest, fragment: string) {
      const { source, counter } = counting(new FixtureSource(await loadDocs(tableId)));
      const batchesBefore = await batchCount(tableId).catch(() => 0);
      const result = await fetchSlice(db, source, tableId, req);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.stage).toBe('request');
      expect(result.summary).toContain(fragment);
      expect(counter.calls).toBe(0);
      expect(await batchCount(tableId).catch(() => 0)).toBe(batchesBefore);
      expect((await db.query('select count(*)::int as n from observations')).rows[0]!.n).toBe(0);
      return result;
    }

    it('refuses an unregistered table', async () => {
      await refused('83625NED', HOUSE_PRICES, 'not registered');
    });

    it('refuses a table registered as full (the whole-table path owns it)', async () => {
      await registerTables(db, new FixtureSource(await loadDocs('83625NED')), [table('83625NED')]);
      await refused('83625NED', HOUSE_PRICES, 'is a full-ingest table, not a slice-cache table');
    });

    it('refuses a measure not in the stored units', async () => {
      await registered('83625NED');
      await refused('83625NED', { ...HOUSE_PRICES, measures: ['M001534', 'M999999'] }, 'M999999');
      await refused('83625NED', { ...HOUSE_PRICES, measures: [] }, 'measure');
      await refused('83625NED', { ...HOUSE_PRICES, measures: ['constructor'] }, 'constructor');
    });

    it('refuses a missing dimension, an unknown dimension, and the time dimension in members', async () => {
      await registered('83625NED');
      await refused('83625NED', { ...HOUSE_PRICES, members: {} }, 'RegioS');
      await refused('83625NED', { ...HOUSE_PRICES, members: { RegioS: ['NL01'], Geslacht: ['T001038'] } }, 'Geslacht');
      await refused('83625NED', { ...HOUSE_PRICES, members: { RegioS: ['NL01'], Perioden: ['2025JJ00'] } }, 'Perioden');
      await refused('83625NED', { ...HOUSE_PRICES, members: { RegioS: [] } }, 'RegioS');
    });

    it('refuses a member code or period not in the stored labels', async () => {
      await registered('83625NED');
      await refused('83625NED', { ...HOUSE_PRICES, members: { RegioS: ['NL01', 'GM9999'] } }, 'GM9999');
      await refused('83625NED', { ...HOUSE_PRICES, periods: ['2030JJ00'] }, '2030JJ00');
      await refused('83625NED', { ...HOUSE_PRICES, periods: [] }, 'period');
    });

    it(`refuses a request over SLICE_MAX_CELLS (${SLICE_MAX_CELLS}) cells`, async () => {
      expect(SLICE_MAX_CELLS).toBe(2000);
      const docs = await registered('83625NED');
      const regions = (docs.codes.RegioS as { value: { Identifier: string }[] }).value.slice(0, 100).map((c) => c.Identifier);
      const periods = (docs.codes.Perioden as { value: { Identifier: string }[] }).value.slice(10).map((c) => c.Identifier);
      expect(regions.length * periods.length).toBe(2100);
      await refused('83625NED', { measures: ['M001534'], members: { RegioS: regions }, periods }, '2100');
    });

    it('refuses a quarantined (needs_review) table', async () => {
      await registered('83625NED');
      await db.query(`update cbs_tables set status = 'needs_review', needs_review_reason = 'test' where id = $1`, ['83625NED']);
      await refused('83625NED', HOUSE_PRICES, 'quarantined');
    });
  });

  it('a crafted duplicate row -> row_plausibility failure, batch failed, 0 rows stored, no slice_fetches row', async () => {
    const docs = await registered('83625NED');
    const corrupt = structuredClone(docs);
    const page = corrupt.observationPages[0] as { value: Record<string, unknown>[] };
    const cell = page.value.find((r) => r.RegioS === 'NL01' && r.Perioden === '2025JJ00')!;
    page.value.push({ ...cell, Id: 999_999 });

    const result = await fetchSlice(db, new FixtureSource(corrupt), '83625NED', HOUSE_PRICES);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.stage).toBe('row_plausibility');
    expect(result.summary).toContain('more than once');
    expect(await observationRows('83625NED')).toHaveLength(0);
    expect(await sliceFetchRows('83625NED')).toHaveLength(0);
    const batches = (await db.query('select * from ingestion_batches where table_id = $1', ['83625NED'])).rows;
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ outcome: 'failed', failure_stage: 'row_plausibility', failure_summary: result.summary });
  });

  it('a period without publication status -> period_parsing failure, nothing stored (R11: never guessed)', async () => {
    const docs = await loadDocs('83625NED');
    const noStatus = structuredClone(docs);
    const periods = (noStatus.codes as Record<string, { value: { Identifier: string; Status: string | null }[] }>)['Perioden']!;
    periods.value.find((p) => p.Identifier === '2025JJ00')!.Status = null;
    await registered('83625NED', noStatus);

    const result = await fetchSlice(db, new FixtureSource(noStatus), '83625NED', HOUSE_PRICES);

    expect(result).toMatchObject({ ok: false, stage: 'period_parsing' });
    expect(await observationRows('83625NED')).toHaveLength(0);
    expect(await sliceFetchRows('83625NED')).toHaveLength(0);
  });

  it('a row with a code not in the stored labels -> dimension_mapping failure + quarantine', async () => {
    const docs = await registered('83625NED');
    const source = withObservations(new FixtureSource(docs), (rows) => [
      ...rows,
      { ...rows[0]!, coordinates: { ...rows[0]!.coordinates, RegioS: 'GM9999' } },
    ]);

    const result = await fetchSlice(db, source, '83625NED', HOUSE_PRICES);

    expect(result).toMatchObject({ ok: false, stage: 'dimension_mapping' });
    expect(await observationRows('83625NED')).toHaveLength(0);
    expect((await cbsTablesRow('83625NED')).status).toBe('needs_review');
  });

  it('rows outside the requested coordinates -> row_plausibility failure, nothing stored', async () => {
    const docs = await registered('83625NED');
    const source = withObservations(new FixtureSource(docs), (rows) => rows, /* ignoreSlice */ true);

    const result = await fetchSlice(db, source, '83625NED', HOUSE_PRICES);

    expect(result).toMatchObject({ ok: false, stage: 'row_plausibility' });
    if (result.ok) throw new Error('unreachable');
    expect(result.summary).toContain('outside');
    expect(await observationRows('83625NED')).toHaveLength(0);
  });

  it('a unit change -> unit_consistency failure + quarantine, nothing stored', async () => {
    const docs = await registered('83625NED');
    const changed = structuredClone(docs);
    (changed.measureCodes as { value: { Unit: string }[] }).value[0]!.Unit = 'x 1 000 euro';

    const result = await fetchSlice(db, new FixtureSource(changed), '83625NED', HOUSE_PRICES);

    expect(result).toMatchObject({ ok: false, stage: 'unit_consistency' });
    expect(await observationRows('83625NED')).toHaveLength(0);
    const row = await cbsTablesRow('83625NED');
    expect(row.status).toBe('needs_review');
    expect(row.needs_review_reason).toContain('x 1 000 euro');
  });

  it('a fetch error -> fetch failure recorded on the batch, table NOT quarantined', async () => {
    const docs = await registered('83625NED');
    const source = withObservations(new FixtureSource(docs), () => {
      throw new Error('socket hang up');
    });

    const result = await fetchSlice(db, source, '83625NED', HOUSE_PRICES);

    expect(result).toMatchObject({ ok: false, stage: 'fetch' });
    if (result.ok) throw new Error('unreachable');
    expect(result.summary).toContain('socket hang up');
    expect((await cbsTablesRow('83625NED')).status).toBe('active');
    const batches = (await db.query('select outcome, failure_stage from ingestion_batches where table_id = $1', ['83625NED'])).rows;
    expect(batches).toEqual([{ outcome: 'failed', failure_stage: 'fetch' }]);
  });

  it('a registry change while the fetch validates -> aborted under the lock, batch failed, nothing written', async () => {
    const docs = await registered('83625NED');
    // A concurrent schema refresh (version bump) lands between fetchSlice's
    // unlocked registry read and its locked write transaction.
    const source = withObservations(new FixtureSource(docs), (rows) => rows);
    const racing: CbsSource = {
      ...source,
      async *fetchObservations(t, s, n) {
        await db.query('update cbs_tables set version = version + 1 where id = $1', [t]);
        yield* source.fetchObservations(t, s, n);
      },
    };

    const result = await fetchSlice(db, racing, '83625NED', HOUSE_PRICES);

    expect(result).toMatchObject({ ok: false, stage: 'rebaseline_conflict' });
    expect(await observationRows('83625NED')).toHaveLength(0);
    expect(await sliceFetchRows('83625NED')).toHaveLength(0);
    expect((await cbsTablesRow('83625NED')).status).toBe('active'); // not suspect data: no quarantine
    const batches = (await db.query('select outcome, failure_stage from ingestion_batches where table_id = $1', ['83625NED'])).rows;
    expect(batches).toEqual([{ outcome: 'failed', failure_stage: 'rebaseline_conflict' }]);
  });

  describe('schema refresh when CBS Modified moves', () => {
    const NEWER = '2026-09-01T00:00:00+02:00';

    function newerWithExtraPeriod(docs: Awaited<ReturnType<typeof loadDocs>>) {
      const clone = structuredClone(docs);
      (clone.properties as Record<string, unknown>).Modified = NEWER;
      const periods = (clone.codes as Record<string, { value: Record<string, unknown>[] }>)['Perioden']!;
      const last = periods.value[periods.value.length - 1]!;
      periods.value.push({ ...last, Identifier: '2026JJ00', Title: '2026*', Index: Number(last.Index) + 1, Status: 'Voorlopig' });
      const page = clone.observationPages[0] as { value: Record<string, unknown>[] };
      page.value.push({ Id: 999_998, Measure: 'M001534', ValueAttribute: 'None', Value: 461_000, StringValue: null, RegioS: 'NL01', Perioden: '2026JJ00' });
      return clone;
    }

    it('accepts a newer Modified with a new period: labels, units and schema_cbs_modified refresh, and the new period becomes fetchable', async () => {
      const docs = await registered('83625NED');
      const before = await cbsTablesRow('83625NED');
      const newer = new FixtureSource(newerWithExtraPeriod(docs));
      const request2026: SliceRequest = { measures: ['M001534'], members: { RegioS: ['NL01'] }, periods: ['2026JJ00'] };

      // Before any refresh the new period is not in the stored labels: refused, nothing sent to CBS.
      expect(await fetchSlice(db, newer, '83625NED', request2026)).toMatchObject({ ok: false, stage: 'request' });

      // Any slice fetch sees the newer Modified and refreshes the schema in the same transaction.
      const first = await fetchSlice(db, newer, '83625NED', HOUSE_PRICES);
      expect(first).toMatchObject({ ok: true, rowsStored: 4 });
      const after = await cbsTablesRow('83625NED');
      expect(new Date(after.schema_cbs_modified as string).getTime()).toBe(new Date(NEWER).getTime());
      expect(Number(after.version)).toBe(Number(before.version) + 1);
      expect(after.schema_fingerprint).toBe(before.schema_fingerprint);
      const label = (
        await db.query(`select status from dimension_labels where table_id = $1 and dimension = 'Perioden' and code = '2026JJ00'`, ['83625NED'])
      ).rows;
      expect(label).toEqual([{ status: 'Voorlopig' }]);
      expect(new Date((await sliceFetchRows('83625NED'))[0]!.cbs_modified as string).getTime()).toBe(new Date(NEWER).getTime());

      const second = await fetchSlice(db, newer, '83625NED', request2026);
      expect(second).toMatchObject({ ok: true, rowsStored: 1, missingCells: 0 });
      const cell = (await observationRows('83625NED')).find((r) => r.period_code === '2026JJ00');
      expect(cell).toMatchObject({ value: 461_000, status: 'Voorlopig', region_code: 'NL01' });
    });

    it('does not re-fetch code lists when Modified is unchanged', async () => {
      const docs = await registered('83625NED');
      const { source, counter } = counting(new FixtureSource(docs));
      await fetchSlice(db, source, '83625NED', HOUSE_PRICES);
      // One schema read (for Modified, dimensions, measures) + one observations read.
      expect(counter.calls).toBe(2);
    });

    it('a newer Modified whose fingerprint no longer matches -> schema_fingerprint failure + quarantine, no refresh', async () => {
      const docs = await registered('83625NED');
      const labelsBefore = await labelCount('83625NED');
      const before = await cbsTablesRow('83625NED');
      const redesigned = newerWithExtraPeriod(docs);
      const measures = redesigned.measureCodes as { value: Record<string, unknown>[] };
      measures.value.push({ ...measures.value[0]!, Identifier: 'M999999' });

      const result = await fetchSlice(db, new FixtureSource(redesigned), '83625NED', HOUSE_PRICES);

      expect(result).toMatchObject({ ok: false, stage: 'schema_fingerprint' });
      const after = await cbsTablesRow('83625NED');
      expect(after.status).toBe('needs_review');
      expect(after.schema_cbs_modified).toEqual(before.schema_cbs_modified);
      expect(after.version).toEqual(before.version);
      expect(await labelCount('83625NED')).toBe(labelsBefore);
      expect(await observationRows('83625NED')).toHaveLength(0);
    });
  });

  it('a unit/decimals change during a Modified-triggered refresh -> unit_consistency, nothing written', async () => {
    const docs = await registered('83625NED');
    const before = await cbsTablesRow('83625NED');
    const labelsBefore = await labelCount('83625NED');
    const changed = structuredClone(docs);
    (changed.properties as Record<string, unknown>).Modified = '2026-09-01T00:00:00+02:00';
    const periods = (changed.codes as Record<string, { value: Record<string, unknown>[] }>)['Perioden']!;
    periods.value.push({ ...periods.value[periods.value.length - 1]!, Identifier: '2026JJ00', Status: 'Voorlopig' });
    const measure = (changed.measureCodes as { value: Record<string, unknown>[] }).value[0]!;
    measure.Decimals = 1;

    const result = await fetchSlice(db, new FixtureSource(changed), '83625NED', HOUSE_PRICES);

    expect(result).toMatchObject({ ok: false, stage: 'unit_consistency' });
    const after = await cbsTablesRow('83625NED');
    expect(after.status).toBe('needs_review');
    expect(after.schema_cbs_modified).toEqual(before.schema_cbs_modified);
    expect(after.version).toEqual(before.version);
    expect(after.units).toEqual(before.units);
    expect(await labelCount('83625NED')).toBe(labelsBefore);
    expect(await observationRows('83625NED')).toHaveLength(0);
    expect(await sliceFetchRows('83625NED')).toHaveLength(0);
  });

  describe('retained cells (#154, scoped to the request)', () => {
    function without(docs: Awaited<ReturnType<typeof loadDocs>>, regio: string, period: string) {
      const clone = structuredClone(docs);
      const page = clone.observationPages[0] as { value: Record<string, unknown>[] };
      page.value = page.value.filter((r) => !(r.RegioS === regio && r.Perioden === period));
      return clone;
    }

    async function lastSeen(regio: string, period: string) {
      const rows = (
        await db.query(
          'select last_seen_batch_id from observations where table_id = $1 and region_code = $2 and period_code = $3',
          ['83625NED', regio, period],
        )
      ).rows;
      expect(rows).toHaveLength(1); // the cell is KEPT, never deleted
      return rows[0]!.last_seen_batch_id == null ? null : Number(rows[0]!.last_seen_batch_id);
    }

    it('a cell CBS stops returning is kept and marked retained against the previous fetch; reappearance clears it', async () => {
      const docs = await registered('83625NED');
      const first = await fetchSlice(db, new FixtureSource(docs), '83625NED', HOUSE_PRICES);
      if (!first.ok) throw new Error('unreachable');

      const second = await fetchSlice(db, new FixtureSource(without(docs, 'NL01', '2025JJ00')), '83625NED', HOUSE_PRICES);
      expect(second).toMatchObject({ ok: true, rowsStored: 3, missingCells: 1 });
      expect(await lastSeen('NL01', '2025JJ00')).toBe(first.batchId);
      for (const [regio, period] of [['NL01', '2024JJ00'], ['GM0363', '2024JJ00'], ['GM0363', '2025JJ00']] as const) {
        expect(await lastSeen(regio, period)).toBeNull();
      }

      // Absent again: the date never creeps forward.
      await fetchSlice(db, new FixtureSource(without(docs, 'NL01', '2025JJ00')), '83625NED', HOUSE_PRICES);
      expect(await lastSeen('NL01', '2025JJ00')).toBe(first.batchId);

      // CBS publishes it again: the retained marker is cleared.
      const back = await fetchSlice(db, new FixtureSource(docs), '83625NED', HOUSE_PRICES);
      expect(back).toMatchObject({ ok: true, rowsStored: 4 });
      expect(await lastSeen('NL01', '2025JJ00')).toBeNull();
    });

    it('never marks cells outside the request, nor without a previous fetch of the same slice', async () => {
      const docs = await registered('83625NED');
      // An unrelated slice (other period) and a wider slice both store cells.
      const other = await fetchSlice(db, new FixtureSource(docs), '83625NED', {
        measures: ['M001534'],
        members: { RegioS: ['NL01'] },
        periods: ['2023JJ00'],
      });
      expect(other.ok).toBe(true);
      expect((await fetchSlice(db, new FixtureSource(docs), '83625NED', HOUSE_PRICES)).ok).toBe(true);

      // A NEW, narrower slice (no previous fetch of its own key) that CBS
      // answers without NL01 2025JJ00: no provable prior -> nothing marked.
      const narrow: SliceRequest = { measures: ['M001534'], members: { RegioS: ['NL01'] }, periods: ['2025JJ00'] };
      const gone = without(without(docs, 'NL01', '2025JJ00'), 'NL01', '2023JJ00');
      expect(await fetchSlice(db, new FixtureSource(gone), '83625NED', narrow)).toMatchObject({ ok: true, rowsStored: 0 });
      expect(await lastSeen('NL01', '2025JJ00')).toBeNull();

      // Re-fetching the wide slice from the same docs marks ONLY its own
      // absent cell — NL01 2023JJ00, also absent from these docs but outside
      // this request, stays unmarked.
      const wide = await fetchSlice(db, new FixtureSource(gone), '83625NED', HOUSE_PRICES);
      expect(wide).toMatchObject({ ok: true, rowsStored: 3 });
      expect(await lastSeen('NL01', '2025JJ00')).not.toBeNull();
      expect(await lastSeen('NL01', '2023JJ00')).toBeNull();
    });

    it('scopes non-geographic dimensions through dims (85224NED)', async () => {
      const docs = await registered('85224NED');
      const req: SliceRequest = {
        measures: ['T001143_2'],
        members: { SeizoenEnWerkdagcorrectie: ['A042501'] },
        periods: ['2025KW04', '2026KW01'],
      };
      const other: SliceRequest = { ...req, members: { SeizoenEnWerkdagcorrectie: ['A050903'] } };
      const first = await fetchSlice(db, new FixtureSource(docs), '85224NED', req);
      if (!first.ok) throw new Error('unreachable');
      expect((await fetchSlice(db, new FixtureSource(docs), '85224NED', other)).ok).toBe(true);

      // Drop 2026KW01 for BOTH corrections; refetch only `req`.
      const clone = structuredClone(docs);
      const page = clone.observationPages[0] as { value: Record<string, unknown>[] };
      page.value = page.value.filter((r) => r.Perioden !== '2026KW01');
      expect(await fetchSlice(db, new FixtureSource(clone), '85224NED', req)).toMatchObject({ ok: true, rowsStored: 1 });

      const marks = (
        await db.query(
          `select dims ->> 'SeizoenEnWerkdagcorrectie' as corr, last_seen_batch_id
             from observations where table_id = '85224NED' and period_code = '2026KW01' and measure = 'T001143_2'
            order by 1`,
        )
      ).rows.map((r) => [r.corr, r.last_seen_batch_id == null ? null : Number(r.last_seen_batch_id)]);
      expect(marks).toEqual([
        ['A042501', first.batchId],
        ['A050903', null],
      ]);
    });
  });

  it('a fingerprint mismatch while CBS Modified is UNCHANGED still fails loudly and quarantines', async () => {
    const docs = await registered('83625NED');
    const redesigned = structuredClone(docs);
    const measures = redesigned.measureCodes as { value: Record<string, unknown>[] };
    measures.value.push({ ...measures.value[0]!, Identifier: 'M999999' });

    const result = await fetchSlice(db, new FixtureSource(redesigned), '83625NED', HOUSE_PRICES);

    expect(result).toMatchObject({ ok: false, stage: 'schema_fingerprint' });
    expect((await cbsTablesRow('83625NED')).status).toBe('needs_review');
    expect(await observationRows('83625NED')).toHaveLength(0);
  });

  it('CBS serving an OLDER Modified: no refresh, schema_cbs_modified never moves back, slice recorded as of the later date', async () => {
    const docs = await registered('83625NED');
    const before = await cbsTablesRow('83625NED');
    const older = structuredClone(docs);
    (older.properties as Record<string, unknown>).Modified = '2025-01-01T00:00:00+01:00';

    const result = await fetchSlice(db, new FixtureSource(older), '83625NED', HOUSE_PRICES);

    expect(result).toMatchObject({ ok: true, rowsStored: 4 });
    const after = await cbsTablesRow('83625NED');
    expect(after.schema_cbs_modified).toEqual(before.schema_cbs_modified);
    expect(after.version).toEqual(before.version);
    const recorded = new Date((await sliceFetchRows('83625NED'))[0]!.cbs_modified as string).getTime();
    expect(recorded).toBe(new Date('2026-02-17T00:00:00+01:00').getTime());
  });

  it('syncTable refuses a slice-cache table before fetching anything, recorded, without quarantine', async () => {
    const docs = await registered('83625NED');
    const { source, counter } = counting(new FixtureSource(docs));

    const result = await syncTable(db, source, '83625NED');

    expect(result).toMatchObject({ outcome: 'failed', failureStage: 'ingest_mode', rowCount: 0 });
    expect(result.failureSummary).toContain('slice-cache table — use fetchSlice, never a whole-table sync');
    expect(counter.calls).toBe(0);
    expect(await batchRow(result.batchId)).toMatchObject({ outcome: 'failed', failure_stage: 'ingest_mode' });
    const row = await cbsTablesRow('83625NED');
    expect(row.status).toBe('active');
    expect(row.last_sync_at).toBeNull();
    expect(await observationRows('83625NED')).toHaveLength(0);
  });

  it('sliceFilterKey is canonical: sorted keys, sorted and de-duplicated code lists', () => {
    const a = sliceFilterKey({ measures: ['b', 'a'], members: { Z: ['2', '1'], A: ['x'] }, periods: ['2025JJ00', '2024JJ00'] });
    const b = sliceFilterKey({ measures: ['a', 'b', 'a'], members: { A: ['x'], Z: ['1', '2'] }, periods: ['2024JJ00', '2025JJ00'] });
    expect(a).toBe(b);
    expect(a).toBe('{"measures":["a","b"],"members":{"A":["x"],"Z":["1","2"]},"periods":["2024JJ00","2025JJ00"]}');
  });
});
