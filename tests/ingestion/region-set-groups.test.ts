// #253 Task 7 — the INGESTION conformance check behind the region-class
// roster (spec §Membership source; src/query/region-set.ts's file header).
//
// WHAT IS BEING PINNED, and why here rather than in the query layer.
// `resolveRegionSet` answers "the gemeenten of province X" by reading CBS's
// own `DimensionGroupId` for the group named 'GM' + the province's own code
// ('GMPV26' for Utrecht). That naming is a composition read off the DATA — it
// is nowhere promised by CBS — so the query layer VERIFIES it on every call
// and REFUSES when a group comes back empty (principle (c): never guess a
// roster). This test is the other half of that discipline: it turns a CBS
// rename from "every region-class question about that province starts
// refusing, silently, at answer time" into "the ingestion suite goes red",
// which is the loud, early signal. It is the conformance check the assumption
// in region-set.ts names, and open-questions tracks.
//
// Scope: EVERY registered geo table in the hermetic ingest (a `cbs_tables` row
// whose `expected_dimensions` carries a `GeoDimension`), not just the ones the
// region-set tests happen to query — a table registered tomorrow is covered by
// this file the day its fixture lands, with no edit here.
//
// Deliberately its own file, not an addition to ingestion.test.ts: it asks a
// question about the ingested METADATA, shares none of that file's pipeline
// scaffolding, and keeps its own hermetic database.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import type { Db } from '../../src/db/types.ts';

let db: Db;
let close: () => Promise<void>;

/** The CBS dimension group holding the provinces — the same constant
 * src/query/region-set.ts reads the roster from. */
const PROVINCE_GROUP = 'PV';

/** Mirrors `gemeenteGroupFor` in src/query/region-set.ts (private there). The
 * duplication is the POINT of a conformance check: this file states the
 * expectation independently, so a change to the composition rule has to be
 * made — and defended — in two places. */
function gemeenteGroupFor(provinceCode: string): string {
  return `GM${provinceCode}`;
}

interface GeoTable {
  tableId: string;
  dimension: string;
}

/** Every registered table that declares a GeoDimension, with that dimension's
 * name — read from the registry, never hardcoded. */
async function geoTables(): Promise<GeoTable[]> {
  const { rows } = await db.query('select id, expected_dimensions from cbs_tables order by id');
  const tables: GeoTable[] = [];
  for (const row of rows) {
    const dims = (typeof row.expected_dimensions === 'string'
      ? JSON.parse(row.expected_dimensions)
      : row.expected_dimensions) as { name: string; kind: string }[];
    const geo = dims.find((d) => d.kind === 'GeoDimension');
    if (geo) tables.push({ tableId: row.id as string, dimension: geo.name });
  }
  return tables;
}

async function codesInGroup(table: GeoTable, group: string): Promise<string[]> {
  const { rows } = await db.query(
    'select code from dimension_labels where table_id = $1 and dimension = $2 and dimension_group = $3 order by code',
    [table.tableId, table.dimension, group],
  );
  return rows.map((r) => r.code as string);
}

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

describe("region-class rosters: CBS's gemeente groups are named after their province", () => {
  it('the ingest actually contains geo tables with provinces — this suite is not vacuous', async () => {
    const tables = await geoTables();
    expect(tables.length).toBeGreaterThan(0);
    // The two committed geo fixtures. Named explicitly so a fixture set that
    // silently lost its regional tables fails here instead of passing with an
    // empty loop (the failure mode a "for every table" test is prone to).
    expect(tables.map((t) => t.tableId)).toEqual(expect.arrayContaining(['03759ned', '83625NED']));
    for (const table of tables) {
      const provinces = await codesInGroup(table, PROVINCE_GROUP);
      expect(provinces.length, `${table.tableId} has no '${PROVINCE_GROUP}' group at all`).toBe(12);
    }
  });

  it('every PV code of every registered geo table has a non-empty GM<pv> group', async () => {
    const tables = await geoTables();
    const violations: string[] = [];
    for (const table of tables) {
      for (const province of await codesInGroup(table, PROVINCE_GROUP)) {
        const group = gemeenteGroupFor(province);
        const members = await codesInGroup(table, group);
        if (members.length === 0) {
          violations.push(
            `${table.tableId} (dimension "${table.dimension}"): province ${province} has no members in ` +
              `dimension group "${group}" — resolveRegionSet would refuse every gemeente question about it`,
          );
        }
      }
    }
    expect(violations, 'a CBS group rename would break region-class rosters silently').toEqual([]);
  });
});
