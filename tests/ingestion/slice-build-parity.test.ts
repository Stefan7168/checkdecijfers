// ADR 065 step 6 (design 2026-09-30-one-route-warm-slices-design.md D8): the
// slice-mode hermetic build must hold exactly what the whole-table build holds,
// so that every suite and the 20-task benchmark run on it test the same data
// through the other storage route. Both databases come from the committed
// fixtures (tests/helpers/fixture-snapshot.ts, buildIngested per mode); every
// seed table is compared except the documented whole-table fallback, which the
// slice build does not slice-store at all.
//
// Strict on purpose: every reader-relevant column, exact values as text. A
// difference here is a finding to explain, never a comparison to loosen.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { SEED_TABLES } from '../../src/ingestion/registry-seed.ts';
import { SLICE_BUILD_FULL_FALLBACK } from '../helpers/fixture-snapshot.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';

let fullDb: Db;
let sliceDb: Db;
let closeFull: () => Promise<void>;
let closeSlice: () => Promise<void>;

beforeAll(async () => {
  ({ db: fullDb, close: closeFull } = await createIngestedDb({ mode: 'full' }));
  ({ db: sliceDb, close: closeSlice } = await createIngestedDb({ mode: 'slice' }));
});

afterAll(async () => {
  await closeFull?.();
  await closeSlice?.();
});

const SLICE_STORED = SEED_TABLES.map((t) => t.id).filter((id) => !Object.hasOwn(SLICE_BUILD_FULL_FALLBACK, id));

/** Every stored cell of a table with every column a reader sees, in a stable
 * order. Batch ids differ by construction (one sync batch vs one per slice) and
 * are left out; whether a cell is retained (#154) is kept. */
async function storedCells(db: Db, tableId: string) {
  const { rows } = await db.query(
    `select measure, region_code, period_code, period_grain, period_year, period_index, dims::text as dims,
            value::text as value, unit, decimals, status, value_attribute,
            (last_seen_batch_id is null) as present
       from observations where table_id = $1
      order by measure, region_code, period_code, dims::text`,
    [tableId],
  );
  return rows;
}

/** The registry row's reader-relevant columns, as text so jsonb compares exactly. */
async function registryRow(db: Db, tableId: string) {
  const { rows } = await db.query(
    `select id, title, expected_dimensions::text as expected_dimensions,
            default_coordinates::text as default_coordinates, period_semantics::text as period_semantics,
            units::text as units, slice::text as slice, update_cadence, pinned, schema_fingerprint,
            status, needs_review_reason, version, source, doi
       from cbs_tables where id = $1`,
    [tableId],
  );
  return rows[0] ?? null;
}

async function dimensionLabels(db: Db, tableId: string) {
  const { rows } = await db.query(
    `select dimension, code, label, dimension_group, status, sort_index
       from dimension_labels where table_id = $1 order by dimension, code`,
    [tableId],
  );
  return rows;
}

async function canonicalMeasures(db: Db) {
  const { rows } = await db.query(
    `select key, table_id, measure, measure_title, dims::text as dims, definition_label, everyday_terms,
            alternates::text as alternates, notes
       from canonical_measures order by key`,
  );
  return rows;
}

describe('the slice-mode build holds what the whole-table build holds', () => {
  it('stores every seed table, and only the documented fallback the whole-table way', async () => {
    const { rows } = await sliceDb.query('select id, ingest_mode from cbs_tables order by id');
    const modes = Object.fromEntries(rows.map((r) => [r.id as string, r.ingest_mode as string]));
    expect(Object.keys(modes).sort()).toEqual(SEED_TABLES.map((t) => t.id).sort());
    for (const id of SLICE_STORED) expect(modes[id], id).toBe('slice_cache');
    for (const id of Object.keys(SLICE_BUILD_FULL_FALLBACK)) expect(modes[id], id).toBe('full');
    // Every slice-stored table was warmed to completion: stamped and active.
    const { rows: stamped } = await sliceDb.query(
      `select id from cbs_tables where ingest_mode = 'slice_cache' and (last_sync_at is null or status <> 'active')`,
    );
    expect(stamped).toEqual([]);
  });

  it.each(SLICE_STORED)('%s: identical cells', async (id) => {
    const full = await storedCells(fullDb, id);
    const slice = await storedCells(sliceDb, id);
    expect(full.length).toBeGreaterThan(0);
    expect(slice.length).toBe(full.length);
    expect(slice).toEqual(full);
  });

  it.each(SLICE_STORED)('%s: identical registry row and code lists', async (id) => {
    expect(await registryRow(sliceDb, id)).toEqual(await registryRow(fullDb, id));
    expect(await dimensionLabels(sliceDb, id)).toEqual(await dimensionLabels(fullDb, id));
  });

  it('70072ned (statuses from CBS period notes, ADR 061) is slice-stored with the same mixed statuses (#358 item 3)', async () => {
    const statuses = async (db: Db) =>
      (
        await db.query(
          `select status, count(*)::int as n from observations where table_id = '70072ned' group by status order by status`,
        )
      ).rows;
    const slice = await statuses(sliceDb);
    // Not trivially all-final: the notes mark some figures provisional.
    expect(slice.map((r) => r.status)).toEqual(['Definitief', 'NaderVoorlopig', 'Voorlopig']);
    expect(slice).toEqual(await statuses(fullDb));
  });

  it('identical canonical measures', async () => {
    const full = await canonicalMeasures(fullDb);
    expect(full.length).toBeGreaterThan(0);
    expect(await canonicalMeasures(sliceDb)).toEqual(full);
  });
});
