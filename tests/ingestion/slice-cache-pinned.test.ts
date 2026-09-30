// Slice registration for PINNED (curated) tables — ADR 065 step 2. A curated
// table registered in slice mode must carry exactly what the whole-table path
// (registerTables + syncTable) would have left in the registry — scope, cadence,
// curated measure set, fingerprint — and must not be quarantined by its own
// curation when a slice is fetched. Same PGlite/FixtureSource pattern as
// slice-cache.test.ts, so real parsing code runs (ADR 003).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixtureSource, loadFixtureDocs } from '../../src/cbs-adapter/fixture-source.ts';
import type { Db } from '../../src/db/types.ts';
import { evictionCutoff, listEvictableTables } from '../../src/ingestion/eviction.ts';
import { registerTables, syncTable } from '../../src/ingestion/pipeline.ts';
import { SEED_TABLES, type Phase0Table } from '../../src/ingestion/registry-seed.ts';
import { fetchSlice, registerSchemaOnly, type SliceRequest } from '../../src/ingestion/slice-cache.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));

let fullDb: Db;
let sliceDb: Db;
let closeFull: () => Promise<void>;
let closeSlice: () => Promise<void>;

beforeAll(async () => {
  ({ db: fullDb, close: closeFull } = await createTestDb());
  ({ db: sliceDb, close: closeSlice } = await createTestDb());
});

afterAll(async () => {
  await closeFull();
  await closeSlice();
});

beforeEach(async () => {
  for (const db of [fullDb, sliceDb]) {
    await db.query(
      'truncate table observations, dimension_labels, ingestion_batches, cbs_tables restart identity cascade',
    );
  }
});

async function sourceFor(tableId: string): Promise<FixtureSource> {
  return new FixtureSource(await loadFixtureDocs(`${FIXTURES_DIR}/${tableId}`));
}

function seedEntry(id: string): Phase0Table {
  const t = SEED_TABLES.find((entry) => entry.id === id);
  if (!t) throw new Error(`no seed entry for ${id}`);
  return t;
}

/** The pinned registration options for a seed entry — what the table lane's
 * pinned warm-up will derive from the same config the whole-table path reads. */
function pinnedOptions(t: Phase0Table) {
  return {
    pinned: true,
    updateCadence: t.updateCadence,
    slice: t.slice ?? null,
    excludeMeasures: t.excludeMeasures,
  };
}

async function registryRow(db: Db, tableId: string): Promise<Record<string, unknown>> {
  const result = await db.query('select * from cbs_tables where id = $1', [tableId]);
  const row = result.rows[0];
  if (!row) throw new Error(`no cbs_tables row for ${tableId}`);
  return row;
}

function parsed(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

// 70072ned publishes no machine period status (ADR 061's period-note reader
// owns it) — schema-only registration refuses it by design, out of scope here.
const PARITY_TABLES = SEED_TABLES.filter(
  (t) => t.id !== '70072ned' && existsSync(`${FIXTURES_DIR}/${t.id}/properties.json`),
);

describe('parity with the whole-table path (registry columns)', () => {
  it('has seed tables to compare', () => {
    expect(PARITY_TABLES.length).toBeGreaterThan(10);
  });

  it.each(PARITY_TABLES.map((t) => [t.id]))('%s: pinned slice registration = registerTables + syncTable', async (id) => {
    const t = seedEntry(id);
    const source = await sourceFor(id);

    await registerTables(fullDb, source, [t], { pinned: true });
    const synced = await syncTable(fullDb, source, id);
    expect(synced.failureSummary ?? null).toBeNull();
    expect(synced.outcome).toBe('succeeded');

    const registered = await registerSchemaOnly(sliceDb, source, id, undefined, pinnedOptions(t));
    expect(registered.ok).toBe(true);

    const full = await registryRow(fullDb, id);
    const slice = await registryRow(sliceDb, id);

    expect(parsed(slice.units)).toEqual(parsed(full.units));
    expect(parsed(slice.expected_dimensions)).toEqual(parsed(full.expected_dimensions));
    expect(parsed(slice.slice)).toEqual(parsed(full.slice));
    expect(slice.update_cadence).toBe(full.update_cadence);
    expect(slice.pinned).toBe(true);
    expect(slice.pinned).toBe(full.pinned);
    expect(slice.source).toBe(full.source);
    expect(full.schema_fingerprint).not.toBeNull();
    expect(slice.schema_fingerprint).toBe(full.schema_fingerprint);

    expect(slice.ingest_mode).toBe('slice_cache');
    expect(slice.schema_cbs_modified).not.toBeNull();
    expect(slice.last_sync_at).toBeNull();
  });
});

describe('a curated table registered in slice mode can be fetched', () => {
  interface Case {
    id: string;
    request: SliceRequest;
  }
  const cases: Case[] = [
    {
      // 85880NED carries 17 excludeMeasures; 2020KW01/02 are early periods of the fixture.
      id: '85880NED',
      request: {
        measures: ['M006278_2'],
        members: { SoortMutaties: ['A045299'] },
        periods: ['2020KW01', '2020KW02'],
      },
    },
    {
      // 85828NED: a slice (retail branches) plus 7 excludeMeasures.
      id: '85828NED',
      request: {
        measures: ['A042501_1'],
        members: { BedrijfstakkenBranchesSBI2008: ['371600'] },
        periods: ['2020MM01', '2020MM02'],
      },
    },
  ];

  async function cells(db: Db, tableId: string, req: SliceRequest) {
    const result = await db.query(
      `select measure, region_code, period_code, dims, value::text as value, unit, decimals, status, value_attribute
         from observations
        where table_id = $1 and measure = any($2::text[]) and period_code = any($3::text[])
        order by measure, period_code, region_code, dims::text`,
      [tableId, req.measures, req.periods],
    );
    // The whole-table database holds every member; keep only the requested ones.
    return result.rows
      .map((r) => ({ ...r, dims: parsed(r.dims) as Record<string, string> }))
      .filter((r) => Object.entries(req.members).every(([dim, codes]) => codes.includes(r.dims[dim] ?? '')));
  }

  it.each(cases.map((c) => [c.id, c]))('%s: ok, still active, cells equal the whole-table path', async (id, c) => {
    const t = seedEntry(id);
    const source = await sourceFor(id);

    await registerTables(fullDb, source, [t], { pinned: true });
    expect((await syncTable(fullDb, source, id)).outcome).toBe('succeeded');

    const registered = await registerSchemaOnly(sliceDb, source, id, undefined, pinnedOptions(t));
    expect(registered.ok).toBe(true);

    const result = await fetchSlice(sliceDb, source, id, c.request);
    expect(result.ok, result.ok ? '' : result.summary).toBe(true);

    const row = await registryRow(sliceDb, id);
    expect(row.status).toBe('active');
    expect(row.needs_review_reason).toBeNull();

    const sliceCells = await cells(sliceDb, id, c.request);
    expect(sliceCells.length).toBeGreaterThan(0);
    expect(sliceCells).toEqual(await cells(fullDb, id, c.request));
  });
});

describe('a schema refresh on a curated slice table', () => {
  it('keeps the excluded measures out of the refreshed units and does not quarantine (85828NED)', async () => {
    const id = '85828NED';
    const t = seedEntry(id);
    const docs = await loadFixtureDocs(`${FIXTURES_DIR}/${id}`);
    expect((await registerSchemaOnly(sliceDb, new FixtureSource(docs), id, undefined, pinnedOptions(t))).ok).toBe(true);
    const before = await registryRow(sliceDb, id);

    // CBS publishes a newer Modified: the next fetch applies a schema refresh.
    const newer = structuredClone(docs);
    (newer.properties as Record<string, unknown>).Modified = '2026-09-29T00:00:00+02:00';
    const result = await fetchSlice(sliceDb, new FixtureSource(newer), id, {
      measures: ['A042501_1'],
      members: { BedrijfstakkenBranchesSBI2008: ['371600'] },
      periods: ['2020MM01'],
    });
    expect(result.ok, result.ok ? '' : result.summary).toBe(true);

    const after = await registryRow(sliceDb, id);
    expect(after.status).toBe('active');
    expect(Number(after.version)).toBe(Number(before.version) + 1);
    expect(parsed(after.units)).toEqual(parsed(before.units));
    expect(after.schema_fingerprint).toBe(before.schema_fingerprint);
    for (const code of t.excludeMeasures!) expect(Object.keys(parsed(after.units) as object)).not.toContain(code);
  });
});

describe('measures outside the curated set', () => {
  it('cannot be requested on a curated slice table (85880NED excluded measure)', async () => {
    const t = seedEntry('85880NED');
    const source = await sourceFor('85880NED');
    await registerSchemaOnly(sliceDb, source, '85880NED', undefined, pinnedOptions(t));

    const excluded = t.excludeMeasures![0]!;
    const result = await fetchSlice(sliceDb, source, '85880NED', {
      measures: [excluded],
      members: { SoortMutaties: ['A045299'] },
      periods: ['2020KW01'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe('request');
      expect(result.summary).toContain(excluded);
    }
    expect((await registryRow(sliceDb, '85880NED')).status).toBe('active');
  });

  it('a curated table\'s registered units list only the served measures', async () => {
    const t = seedEntry('85880NED');
    const source = await sourceFor('85880NED');
    const registered = await registerSchemaOnly(sliceDb, source, '85880NED', undefined, pinnedOptions(t));
    expect(registered.ok).toBe(true);
    if (registered.ok) {
      for (const code of t.excludeMeasures!) expect(registered.numericMeasures).not.toContain(code);
      expect(registered.numericMeasures).toContain('M006278_2');
    }
  });
});

describe('registerSchemaOnly without options is unchanged', () => {
  it('writes pinned = false, slice = null and no update cadence', async () => {
    const source = await sourceFor('83625NED');
    const result = await registerSchemaOnly(sliceDb, source, '83625NED');
    expect(result.ok).toBe(true);

    const row = await registryRow(sliceDb, '83625NED');
    expect(row.pinned).toBe(false);
    expect(row.slice).toBeNull();
    expect(row.update_cadence).toBeNull();
    expect(row.ingest_mode).toBe('slice_cache');
  });
});

describe('eviction', () => {
  it('exempts a pinned slice-cache table but not an unpinned one of the same age', async () => {
    const pinnedSource = await sourceFor('83625NED');
    const t = seedEntry('83625NED');
    expect((await registerSchemaOnly(sliceDb, pinnedSource, '83625NED', undefined, pinnedOptions(t))).ok).toBe(true);
    expect((await registerSchemaOnly(sliceDb, await sourceFor('82235NED'), '82235NED')).ok).toBe(true);

    await sliceDb.query("update cbs_tables set created_at = now() - interval '400 days'");

    const evictable = (await listEvictableTables(sliceDb, evictionCutoff(new Date()))).map((r) => r.id);
    expect(evictable).toContain('82235NED');
    expect(evictable).not.toContain('83625NED');
  });
});
