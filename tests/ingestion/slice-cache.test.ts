// registerSchemaOnly (breadth step 2, Task 3): schema-only registration for
// slice-cache tables — metadata, code lists, numeric-measure units and
// fingerprint, ZERO observation rows. Uses the same PGlite/FixtureSource
// pattern as tests/ingestion/ingestion.test.ts so this exercises real
// parsing code (ADR 003), not a hand-rolled shape.
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixtureSource, loadFixtureDocs } from '../../src/cbs-adapter/fixture-source.ts';
import { computeFingerprint } from '../../src/ingestion/fingerprint.ts';
import { registerTables } from '../../src/ingestion/pipeline.ts';
import { SEED_TABLES } from '../../src/ingestion/registry-seed.ts';
import { registerSchemaOnly } from '../../src/ingestion/slice-cache.ts';
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
