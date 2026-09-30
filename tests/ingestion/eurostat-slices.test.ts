// ADR 065, #358 item 4: the four pinned Eurostat datasets on the one route. Built from the committed,
// REAL captured responses (tests/fixtures/eurostat/tipsbd30, tests/fixtures/eurostat-siblings/), fully
// hermetic (EurostatFixtureSource, PGlite, a stubbed DataCite), it proves:
//   - a slice-mode build (pinned slice registration + the warm job) holds exactly what the whole-table
//     build (registerTables + syncTable) holds: every cell, value, per-cell status, the registry row and
//     every label;
//   - the parity report, the conversion (dry run and real) and the way back work for a Eurostat dataset;
//   - fail-closed: a dataset Eurostat stopped updating, and a changed unit, quarantine the table instead of
//     re-confirming it.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { EurostatFixtureSource } from '../../src/eurostat-adapter/fixture-source.ts';
import { convertTableToFull, convertTableToSlices } from '../../src/ingestion/convert.ts';
import { compareTableWithSource } from '../../src/ingestion/parity.ts';
import { registerTables, syncTable } from '../../src/ingestion/pipeline.ts';
import { registerSchemaOnly } from '../../src/ingestion/slice-cache.ts';
import { warmPinnedTables, warmTable } from '../../src/ingestion/warm-job.ts';
import type { CbsSlice } from '../../src/cbs-adapter/types.ts';
import { EUROSTAT_SIBLING_REGISTRATIONS } from '../../src/sources/eurostat-siblings.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

/** The day the fixtures were captured; the frozen-dataset check judges the newest period against it. */
const TODAY = Date.parse('2026-09-30T12:00:00Z');
const now = () => TODAY;
const deadline = TODAY + 24 * 60 * 60 * 1000;

const readJson = (rel: string): unknown => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));

function rawDocs(): Record<string, unknown> {
  return {
    tipsbd30: readJson('../fixtures/eurostat/tipsbd30/dataset.json'),
    une_rt_q: readJson('../fixtures/eurostat-siblings/une_rt_q.json'),
    prc_hicp_minr: readJson('../fixtures/eurostat-siblings/prc_hicp_minr.json'),
    namq_10_gdp: readJson('../fixtures/eurostat-siblings/namq_10_gdp.json'),
  };
}

interface Reg {
  id: string;
  slice: CbsSlice | null;
  updateCadence: string;
}

/** The four pinned datasets as production registers them: the three reviewed siblings, and tipsbd30 with
 * no scope (E1's one-off registration). */
const DATASETS: Reg[] = [
  { id: 'eurostat:tipsbd30', slice: null, updateCadence: 'yearly' },
  ...EUROSTAT_SIBLING_REGISTRATIONS.map((r) => ({ id: r.tableId, slice: r.slice, updateCadence: r.updateCadence })),
];

/** DataCite, stubbed: `findable` or not. Never the real network. */
const datacite = (findable: boolean) => async (): Promise<Response> =>
  findable
    ? new Response(JSON.stringify({ data: { attributes: { state: 'findable' } } }), { status: 200 })
    : new Response('{}', { status: 404 });

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()!();
});

async function freshDb(): Promise<Db> {
  const { db, close } = await createTestDb();
  closers.push(close);
  return db;
}

async function wholeTableDb(source: EurostatFixtureSource, findableDoi = false): Promise<Db> {
  const db = await freshDb();
  await registerTables(
    db,
    source,
    DATASETS.map((d) => ({ id: d.id, updateCadence: d.updateCadence, servesTasks: [], ...(d.slice ? { slice: d.slice } : {}) })),
    { pinned: true, fetchImpl: datacite(findableDoi) as typeof fetch },
  );
  for (const d of DATASETS) {
    const result = await syncTable(db, source, d.id);
    expect(result.outcome, `${d.id}: ${result.failureSummary}`).toBe('succeeded');
  }
  return db;
}

async function sliceDb(source: EurostatFixtureSource): Promise<Db> {
  const db = await freshDb();
  for (const d of DATASETS) {
    const registered = await registerSchemaOnly(db, source, d.id, undefined, {
      pinned: true,
      updateCadence: d.updateCadence,
      slice: d.slice,
    });
    expect(registered.ok, JSON.stringify(registered)).toBe(true);
    const warmed = await warmTable(db, source, d.id, { deadline, now });
    expect(warmed.outcome, `${d.id}: ${JSON.stringify(warmed)}`).toBe('complete');
  }
  return db;
}

async function storedCells(db: Db, tableId: string) {
  const { rows } = await db.query(
    `select measure, region_code, period_code, period_grain, period_year, period_index, dims::text as dims,
            value::text as value, unit, decimals, status, value_attribute, (last_seen_batch_id is null) as present
       from observations where table_id = $1
      order by measure, region_code, period_code, dims::text`,
    [tableId],
  );
  return rows;
}

async function registryRow(db: Db, tableId: string) {
  const { rows } = await db.query(
    `select id, title, expected_dimensions::text as expected_dimensions, default_coordinates::text as default_coordinates,
            period_semantics::text as period_semantics, units::text as units, slice::text as slice, update_cadence,
            pinned, schema_fingerprint, status, needs_review_reason, version, source, doi
       from cbs_tables where id = $1`,
    [tableId],
  );
  return rows[0] ?? null;
}

async function labels(db: Db, tableId: string) {
  const { rows } = await db.query(
    `select dimension, code, label, dimension_group, status, sort_index
       from dimension_labels where table_id = $1 order by dimension, code`,
    [tableId],
  );
  return rows;
}

describe('the four pinned Eurostat datasets in slice storage (#358 item 4)', () => {
  it('a slice-mode build holds exactly the whole-table build: cells, statuses, registry, labels', async () => {
    const source = new EurostatFixtureSource(rawDocs());
    const whole = await wholeTableDb(source);
    const slice = await sliceDb(source);
    let flagged = 0;
    for (const d of DATASETS) {
      const cells = await storedCells(whole, d.id);
      expect(cells.length, d.id).toBeGreaterThan(400);
      expect(await storedCells(slice, d.id), d.id).toEqual(cells);
      expect(await registryRow(slice, d.id), d.id).toEqual(await registryRow(whole, d.id));
      expect(await labels(slice, d.id), d.id).toEqual(await labels(whole, d.id));
      flagged += cells.filter((c) => c.status !== 'Published').length;
      const mode = (await slice.query('select ingest_mode, pinned from cbs_tables where id = $1', [d.id])).rows[0]!;
      expect(mode).toEqual({ ingest_mode: 'slice_cache', pinned: true });
    }
    // The status comparison is not vacuous: the real responses carry Eurostat flags (p, e, b, ...).
    expect(flagged).toBeGreaterThan(0);
  }, 60_000);

  it('the warm job reaches a Eurostat table only with a Eurostat adapter; a second run confirms every slice', async () => {
    const source = new EurostatFixtureSource(rawDocs());
    const db = await sliceDb(source);
    // With only a CBS adapter (as before), Eurostat tables are not touched.
    const cbsOnly = await warmPinnedTables(db, source, { deadline, now, tableIds: ['eurostat:une_rt_q'] });
    expect(cbsOnly).toEqual([expect.objectContaining({ outcome: 'skipped', skippedReason: 'not a CBS table' })]);

    const results = await warmPinnedTables(db, source, { deadline, now, sources: { eurostat: source } });
    expect(results.map((r) => r.tableId).sort()).toEqual(DATASETS.map((d) => d.id).sort());
    for (const r of results) {
      expect(r.outcome, JSON.stringify(r)).toBe('complete');
      expect(r.fetched).toBe(0);
      expect(r.confirmed).toBe(r.planned);
      // Small datasets: one or two requests each.
      expect(r.planned).toBeLessThanOrEqual(2);
    }
  }, 60_000);

  it('the parity report finds the whole-table copy identical to what the source returns', async () => {
    const source = new EurostatFixtureSource(rawDocs());
    const db = await wholeTableDb(source);
    for (const d of DATASETS) {
      const report = await compareTableWithSource(db, source, d.id, { deadline, maxCells: 25_000, now });
      expect(report.complete, `${d.id}: ${report.error}`).toBe(true);
      expect(report.diffCounts, d.id).toEqual({ value_differs: 0, status_differs: 0, missing_in_store: 0, missing_at_source: 0 });
      expect(report.identical, d.id).toBe(report.storedCells);
      expect(report.identical, d.id).toBeGreaterThan(400);
    }
  }, 60_000);

  it('converts a whole-table Eurostat dataset to slices (dry run, then for real) and back, keeping cells and DOI', async () => {
    const source = new EurostatFixtureSource(rawDocs());
    const db = await wholeTableDb(source, true);
    for (const d of DATASETS) {
      const before = await storedCells(db, d.id);
      const registryBefore = await registryRow(db, d.id);
      expect(registryBefore!.doi).toMatch(/^10\.2908\//);

      const dry = await convertTableToSlices(db, source, d.id, { deadline, apply: false, now });
      expect(dry.outcome, `${d.id}: ${dry.reason}`).toBe('dry_run');
      expect(await storedCells(db, d.id)).toEqual(before);

      const done = await convertTableToSlices(db, source, d.id, { deadline, apply: true, now });
      expect(done.outcome, `${d.id}: ${done.reason ?? JSON.stringify(done.afterCheck)}`).toBe('converted');
      expect(await storedCells(db, d.id)).toEqual(before);
      const after = await registryRow(db, d.id);
      expect(after!.doi).toBe(registryBefore!.doi);
      expect((await db.query('select ingest_mode from cbs_tables where id = $1', [d.id])).rows[0]!.ingest_mode).toBe(
        'slice_cache',
      );
    }
    // The way back is available for a Eurostat dataset too (then `ingest sync <id>` refills it).
    const back = await convertTableToFull(db, 'eurostat:une_rt_q', { apply: true });
    expect(back.outcome, back.reason).toBe('converted_to_full');
    const resync = await syncTable(db, source, 'eurostat:une_rt_q');
    expect(resync.outcome, resync.failureSummary).toBe('succeeded');
  }, 90_000);
});

describe('fail-closed on the one route (#358 item 4)', () => {
  it('a dataset Eurostat stopped updating is quarantined, not re-confirmed as current', async () => {
    const source = new EurostatFixtureSource(rawDocs());
    const db = await sliceDb(source);
    const checkedBefore = (
      await db.query('select filter_key, checked_at::text as at from slice_fetches where table_id = $1 order by filter_key', [
        'eurostat:prc_hicp_minr',
      ])
    ).rows;
    // Five months after its newest period (2026-08), a monthly dataset is past the limit.
    const later = Date.parse('2027-02-15T12:00:00Z');
    const result = await warmTable(db, source, 'eurostat:prc_hicp_minr', { deadline: later + 60_000, now: () => later });
    expect(result.outcome).toBe('failed');
    expect(result.failure).toEqual(
      expect.objectContaining({ stage: 'period_parsing', quarantined: true, summary: expect.stringMatching(/2026MM08/) }),
    );
    const row = (await db.query('select status, needs_review_reason from cbs_tables where id = $1', ['eurostat:prc_hicp_minr']))
      .rows[0]!;
    expect(row.status).toBe('needs_review');
    // Nothing was re-confirmed.
    const checkedAfter = (
      await db.query('select filter_key, checked_at::text as at from slice_fetches where table_id = $1 order by filter_key', [
        'eurostat:prc_hicp_minr',
      ])
    ).rows;
    expect(checkedAfter).toEqual(checkedBefore);
    // One month after its newest period, the same dataset is current.
    const soon = Date.parse('2026-10-15T12:00:00Z');
    const other = await warmTable(db, source, 'eurostat:une_rt_q', { deadline: soon + 60_000, now: () => soon });
    expect(other.outcome).toBe('complete');
  }, 60_000);

  it('a unit Eurostat changed quarantines the table in slice storage, as the whole-table sync does', async () => {
    const docs = rawDocs();
    const db = await sliceDb(new EurostatFixtureSource(docs));
    const changed = structuredClone(docs) as Record<string, { dimension: { unit: { category: { label: Record<string, string> } } } }>;
    changed.une_rt_q!.dimension.unit.category.label.PC_ACT = 'Thousand persons';
    const result = await warmTable(db, new EurostatFixtureSource(changed), 'eurostat:une_rt_q', { deadline, now });
    expect(result.outcome).toBe('failed');
    expect(result.failure).toEqual(expect.objectContaining({ stage: 'unit_consistency', quarantined: true }));
    const row = (await db.query('select status from cbs_tables where id = $1', ['eurostat:une_rt_q'])).rows[0]!;
    expect(row.status).toBe('needs_review');
  }, 60_000);
});
