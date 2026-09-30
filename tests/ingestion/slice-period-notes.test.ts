// #358 item 3 (ADR 065, ADR 061): slice storage for a table whose period status
// comes from CBS's PROSE period notes (70072ned). The slice store must derive
// every cell's status exactly as the whole-table sync does — the same reader,
// the same fail-closed refusals — and the parity report must compare those
// statuses too. Same PGlite/FixtureSource pattern as warm-job.test.ts.
// (Whole-build equality of cells, statuses, registry row and labels is pinned
// by slice-build-parity.test.ts.)
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixtureSource, loadFixtureDocs, type FixtureDocs } from '../../src/cbs-adapter/fixture-source.ts';
import type { Db } from '../../src/db/types.ts';
import { compareTableWithSource } from '../../src/ingestion/parity.ts';
import { registerTables, syncTable } from '../../src/ingestion/pipeline.ts';
import { SEED_TABLES, type Phase0Table } from '../../src/ingestion/registry-seed.ts';
import { registerSchemaOnly } from '../../src/ingestion/slice-cache.ts';
import { warmTable } from '../../src/ingestion/warm-job.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));
const ID = '70072ned';
const FAR = () => Date.now() + 3_600_000;

let db: Db;
let closeDb: () => Promise<void>;

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await db.query('truncate table observations, dimension_labels, ingestion_batches, cbs_tables restart identity cascade');
});

function seed(): Phase0Table {
  const t = SEED_TABLES.find((entry) => entry.id === ID);
  if (!t?.periodNoteStatus || !t.slice?.measures) throw new Error('70072ned seed with a period-note map and allow-list expected');
  return t;
}

function docs(): FixtureDocs {
  return loadFixtureDocs(`${FIXTURES_DIR}/${ID}`);
}

/** The 70072ned fixtures with CBS's 2025 period note naming a topic nobody reviewed. */
function withUnreviewedNote(): FixtureDocs {
  const clone = structuredClone(docs());
  const periods = (clone.codes as Record<string, { value: Record<string, unknown>[] }>)['Perioden']!;
  const p2025 = periods.value.find((row) => row.Identifier === '2025JJ00');
  if (!p2025) throw new Error('2025JJ00 not in the 70072ned Perioden fixture');
  p2025.Description = 'Uitkomsten zijn voorlopig over:\r\nOnbekend nieuw onderwerp\r\n';
  return clone;
}

/** The 70072ned fixtures with a served measure's own description carrying a "voorlopig" topic note. */
function withTopicNote(): FixtureDocs {
  const clone = structuredClone(docs());
  const measures = (clone.measureCodes as { value: Record<string, unknown>[] }).value;
  const m = measures.find((row) => row.Identifier === 'M000100');
  if (!m) throw new Error('M000100 not in the 70072ned measure-codes fixture');
  m.Description = `${m.Description as string} (voorlopig cijfer)`;
  return clone;
}

async function registerPinnedSlice(source: FixtureSource, table: Phase0Table = seed()) {
  return registerSchemaOnly(db, source, ID, undefined, {
    pinned: true,
    updateCadence: table.updateCadence,
    slice: table.slice ?? null,
    excludeMeasures: table.excludeMeasures,
  });
}

async function wholeTableSync(source: FixtureSource, table: Phase0Table = seed()) {
  await registerTables(db, source, [table], { pinned: true });
  return syncTable(db, source, ID);
}

async function statusOf(measure: string, period: string, region = 'GM0363'): Promise<unknown> {
  return (
    await db.query(
      'select status from observations where table_id = $1 and measure = $2 and region_code = $3 and period_code = $4',
      [ID, measure, region, period],
    )
  ).rows[0]?.status;
}

async function tableState() {
  const row = (await db.query('select status, ingest_mode from cbs_tables where id = $1', [ID])).rows[0]!;
  const n = (await db.query('select count(*)::int as n from observations where table_id = $1', [ID])).rows[0]!.n;
  return { status: row.status as string, ingestMode: row.ingest_mode as string, observations: n as number };
}

describe('registration', () => {
  it('a pinned registration with the seed curation is accepted; an unpinned one still refuses', async () => {
    const source = new FixtureSource(docs());
    const unpinned = await registerSchemaOnly(db, source, ID, undefined, { pinned: false, slice: seed().slice ?? null });
    expect(unpinned).toMatchObject({ ok: false, reason: 'no_machine_period_status' });
    expect((await db.query('select id from cbs_tables where id = $1', [ID])).rows).toEqual([]);

    const pinned = await registerPinnedSlice(source);
    expect(pinned.ok).toBe(true);
    expect((await tableState()).ingestMode).toBe('slice_cache');
  });
});

describe('the warm job stores the statuses the whole-table sync stores', () => {
  it('reads each cell’s status from CBS’s period notes (same values as the whole-table test pins)', async () => {
    const source = new FixtureSource(docs());
    expect((await registerPinnedSlice(source)).ok).toBe(true);
    const warmed = await warmTable(db, source, ID, { deadline: FAR() });
    expect(warmed.failure).toBeUndefined();
    expect(warmed.outcome).toBe('complete');

    // The values tests/ingestion/ingestion.test.ts pins for the whole-table sync.
    expect(await statusOf('M003039', '2024JJ00')).toBe('NaderVoorlopig');
    expect(await statusOf('M003039', '2025JJ00')).toBe('Voorlopig');
    expect(await statusOf('X033647', '2024JJ00')).toBe('NaderVoorlopig');
    expect(await statusOf('X092783', '2025JJ00')).toBe('Voorlopig');
    expect(await statusOf('M000200_2', '2026JJ00')).toBe('Voorlopig');
    expect(await statusOf('M000100', '2025JJ00')).toBe('Definitief');
    expect(await statusOf('A018943_2', '2025JJ00')).toBe('Definitief');
  });
});

describe('fail-closed exactly like the whole-table sync', () => {
  /** The whole-table sync's failure on these fixtures, then the slice store's on the same. */
  async function bothModes(make: () => FixtureDocs, table: Phase0Table = seed()) {
    const whole = await wholeTableSync(new FixtureSource(make()), table);
    const wholeState = await tableState();
    await db.query('truncate table observations, dimension_labels, ingestion_batches, cbs_tables restart identity cascade');

    const source = new FixtureSource(make());
    const registered = await registerPinnedSlice(source, table);
    if (!registered.ok) throw new Error(registered.summary);
    const warmed = await warmTable(db, source, ID, { deadline: FAR() });
    return { whole, wholeState, warmed, sliceState: await tableState() };
  }

  it('an unreviewed period-note heading: same stage and summary, quarantined, nothing stored', async () => {
    const { whole, wholeState, warmed, sliceState } = await bothModes(withUnreviewedNote);
    expect(whole.outcome).toBe('failed');
    expect(whole.failureStage).toBe('period_parsing');
    expect(whole.failureSummary?.toLowerCase()).toContain('onbekend nieuw onderwerp');
    expect(wholeState).toMatchObject({ status: 'needs_review', observations: 0 });

    expect(warmed.outcome).toBe('failed');
    expect(warmed.failure).toEqual({ stage: 'period_parsing', summary: whole.failureSummary, quarantined: true });
    expect(sliceState).toEqual({ status: 'needs_review', ingestMode: 'slice_cache', observations: 0 });
  });

  it('a "voorlopig" topic note on a served measure: same stage and summary, quarantined, nothing stored', async () => {
    const { whole, warmed, sliceState } = await bothModes(withTopicNote);
    expect(whole.failureStage).toBe('period_parsing');
    expect(whole.failureSummary).toContain('M000100');
    expect(warmed.failure).toEqual({ stage: 'period_parsing', summary: whole.failureSummary, quarantined: true });
    expect(sliceState).toEqual({ status: 'needs_review', ingestMode: 'slice_cache', observations: 0 });
  });

  it('a registered scope narrower than the one the note map was reviewed for: same refusal', async () => {
    const narrowed: Phase0Table = {
      ...seed(),
      slice: { ...seed().slice!, measures: seed().slice!.measures!.slice(0, 11) },
    };
    const { whole, warmed, sliceState } = await bothModes(docs, narrowed);
    expect(whole.failureStage).toBe('period_parsing');
    expect(whole.failureSummary).toContain('D000025');
    expect(warmed.failure).toEqual({ stage: 'period_parsing', summary: whole.failureSummary, quarantined: true });
    expect(sliceState.observations).toBe(0);
  });
});

describe('the parity report compares the note-derived statuses', () => {
  it('a freshly synced whole table equals what CBS returns, statuses included', async () => {
    const source = new FixtureSource(docs());
    expect((await wholeTableSync(source)).outcome).toBe('succeeded');
    const report = await compareTableWithSource(db, source, ID, { deadline: FAR() });
    expect(report.error).toBeUndefined();
    expect(report.complete).toBe(true);
    expect(report.diffCounts).toEqual({ value_differs: 0, status_differs: 0, missing_in_store: 0, missing_at_source: 0 });
    const stored = (await tableState()).observations;
    expect(stored).toBeGreaterThan(0);
    expect(report.identical).toBe(stored);
  });

  it('a stored status that differs from the notes is a status_differs', async () => {
    const source = new FixtureSource(docs());
    expect((await wholeTableSync(source)).outcome).toBe('succeeded');
    await db.query(
      `update observations set status = 'Definitief'
        where table_id = $1 and measure = 'M003039' and region_code = 'GM0363' and period_code = '2025JJ00'`,
      [ID],
    );
    const report = await compareTableWithSource(db, source, ID, { deadline: FAR() });
    expect(report.complete).toBe(true);
    expect(report.diffCounts.status_differs).toBe(1);
    expect(report.diffs[0]).toMatchObject({
      kind: 'status_differs',
      measure: 'M003039',
      periodCode: '2025JJ00',
      stored: { status: 'Definitief' },
      fetched: { status: 'Voorlopig' },
    });
  });

  it('a note CBS now words in a way nobody reviewed makes the report incomplete, never a guess', async () => {
    expect((await wholeTableSync(new FixtureSource(docs()))).outcome).toBe('succeeded');
    const report = await compareTableWithSource(db, new FixtureSource(withUnreviewedNote()), ID, { deadline: FAR() });
    expect(report.complete).toBe(false);
    expect(report.error?.toLowerCase()).toContain('onbekend nieuw onderwerp');
  });
});
