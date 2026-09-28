// Breadth step 2, Task 5b — answering from a slice_cache table, each served
// cell dated by the LATEST CBS confirmation (slice_fetches.checked_at) of the
// slice(s) whose filter covers it:
//  - a slice-cache table answers (value, unit, status verbatim from the stored
//    cell; syncedAt = the covering fetch's checked_at);
//  - a cell stored by slice A is NOT re-dated when an unrelated slice B is
//    fetched later; a cell covered by several slices takes the LATEST;
//  - an ensureSlice cache hit moves checked_at, and with it the answer's date;
//  - a retained cell (#154) keeps its own "last confirmed" batch date;
//  - a served cell no slice_fetches row accounts for -> internal_inconsistency
//    (never serve an unaccounted cell), even if last_sync_at were somehow set;
//  - cbs_tables.last_sync_at stays NULL throughout.
// Full-ingest tables are pinned unchanged by every other query/answer test.
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixtureSource, loadFixtureDocs } from '../../src/cbs-adapter/fixture-source.ts';
import { ensureSlice, fetchSlice, registerSchemaOnly, type SliceRequest } from '../../src/ingestion/slice-cache.ts';
import { runQuery } from '../../src/query/index.ts';
import type { QueryOutcome, StructuredIntent } from '../../src/query/index.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

const TABLE = '83625NED';
const MEASURE = 'M001534';
const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));

type Docs = Awaited<ReturnType<typeof loadFixtureDocs>>;

let db: Db;
let closeDb: () => Promise<void>;
let docs: Docs;

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
  docs = await loadFixtureDocs(`${FIXTURES_DIR}/${TABLE}`);
});

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await db.query(
    'truncate table observations, dimension_labels, ingestion_batches, cbs_tables restart identity cascade',
  );
  const reg = await registerSchemaOnly(db, new FixtureSource(docs), TABLE);
  if (!reg.ok) throw new Error(`registration failed: ${reg.summary}`);
});

const T0 = '2026-09-01T08:00:00.000Z';
const T1 = '2026-09-10T08:00:00.000Z';
const T2 = '2026-09-20T08:00:00.000Z';
const T3 = '2026-09-25T08:00:00.000Z';

function slice(regions: string[], periods: string[]): SliceRequest {
  return { measures: [MEASURE], members: { RegioS: regions }, periods };
}

async function fetchAt(req: SliceRequest, checkedAt: string, source: Docs = docs): Promise<number> {
  const result = await fetchSlice(db, new FixtureSource(source), TABLE, req);
  if (!result.ok) throw new Error(`fetch failed: ${result.summary}`);
  await db.query('update slice_fetches set checked_at = $3 where table_id = $1 and filter_key = $2', [
    TABLE,
    result.filterKey,
    checkedAt,
  ]);
  return result.batchId;
}

function intent(regions: string[], periods: string[]): StructuredIntent {
  return {
    schemaVersion: 1,
    target: { kind: 'explicit', tableId: TABLE, measure: MEASURE },
    regions,
    period: { kind: 'codes', codes: periods },
    derivation: 'none',
  };
}

function served(outcome: QueryOutcome) {
  if (!outcome.ok) throw new Error(`expected an answer, got ${outcome.refusal.kind}: ${outcome.refusal.message}`);
  return outcome;
}

async function lastSyncAt(): Promise<unknown> {
  return (await db.query('select last_sync_at from cbs_tables where id = $1', [TABLE])).rows[0]!.last_sync_at;
}

describe('answering from a slice_cache table (breadth step 2, Task 5b)', () => {
  it('answers a covered cell verbatim, dated by the covering fetch’s checked_at', async () => {
    await fetchAt(slice(['NL01'], ['2024JJ00', '2025JJ00']), T1);
    const stored = (
      await db.query(
        `select value, unit, status from observations
          where table_id = $1 and measure = $2 and region_code = 'NL01' and period_code = '2025JJ00'`,
        [TABLE, MEASURE],
      )
    ).rows[0]!;

    const result = served(await runQuery(db, intent(['NL01'], ['2025JJ00'])));

    expect(result.cells).toHaveLength(1);
    const cell = result.cells[0]!;
    expect(cell.value).toBe(Number(stored.value));
    expect(cell.value).not.toBeNull();
    expect(cell.unit).toBe(stored.unit);
    expect(cell.status).toBe(stored.status);
    expect(result.attribution.syncedAt).toBe(T1);
    expect(result.registry?.lastSyncAt).toBe(T1);
    expect(await lastSyncAt()).toBeNull();
  });

  it('a cell stored by slice A is NOT re-dated when an unrelated slice B is fetched later', async () => {
    await fetchAt(slice(['NL01'], ['2024JJ00']), T1);
    await fetchAt(slice(['GM0363'], ['2024JJ00']), T2);

    expect(served(await runQuery(db, intent(['NL01'], ['2024JJ00']))).attribution.syncedAt).toBe(T1);
    expect(served(await runQuery(db, intent(['GM0363'], ['2024JJ00']))).attribution.syncedAt).toBe(T2);

    // Both together: the answer is dated by its OLDEST cell (#154 rule);
    // the registry fact staleness reads is the LATEST covering confirmation.
    const both = served(await runQuery(db, intent(['NL01', 'GM0363'], ['2024JJ00'])));
    expect(both.attribution.syncedAt).toBe(T1);
    expect(both.registry?.lastSyncAt).toBe(T2);
    expect(await lastSyncAt()).toBeNull();
  });

  it('a cell covered by several slices is dated by the LATEST of their confirmations', async () => {
    await fetchAt(slice(['NL01'], ['2024JJ00']), T1);
    await fetchAt(slice(['NL01', 'GM0363'], ['2024JJ00']), T3);
    expect(served(await runQuery(db, intent(['NL01'], ['2024JJ00']))).attribution.syncedAt).toBe(T3);

    // Order-independent: an OLDER overlapping confirmation never pulls it back.
    await db.query('update slice_fetches set checked_at = $2 where table_id = $1 and checked_at = $3', [TABLE, T0, T3]);
    expect(served(await runQuery(db, intent(['NL01'], ['2024JJ00']))).attribution.syncedAt).toBe(T1);
  });

  it("an ensureSlice cache hit moves checked_at, and the answer's date moves with it", async () => {
    const req = slice(['NL01'], ['2024JJ00']);
    await fetchAt(req, T1);
    expect(served(await runQuery(db, intent(['NL01'], ['2024JJ00']))).attribution.syncedAt).toBe(T1);

    const hit = await ensureSlice(db, new FixtureSource(docs), TABLE, req);
    expect(hit).toMatchObject({ ok: true, cached: true });

    const checkedAt = new Date(
      (await db.query('select checked_at from slice_fetches where table_id = $1', [TABLE])).rows[0]!.checked_at as
        | string
        | Date,
    ).toISOString();
    expect(checkedAt > T1).toBe(true);
    const after = served(await runQuery(db, intent(['NL01'], ['2024JJ00'])));
    expect(after.attribution.syncedAt).toBe(checkedAt);
    expect(after.registry?.lastSyncAt).toBe(checkedAt);
    expect(await lastSyncAt()).toBeNull();
  });

  it('a retained cell (#154) keeps the date of the batch that last confirmed it', async () => {
    const req = slice(['NL01'], ['2024JJ00', '2025JJ00']);
    const firstBatch = await fetchAt(req, T0);
    await db.query('update ingestion_batches set finished_at = $2 where id = $1', [firstBatch, T0]);

    // CBS stops returning NL01 2025JJ00: the refetch keeps it, marked retained
    // against the first batch.
    const withoutCell = structuredClone(docs);
    const page = withoutCell.observationPages[0] as { value: Record<string, unknown>[] };
    page.value = page.value.filter((r) => !(r.RegioS === 'NL01' && r.Perioden === '2025JJ00'));
    await fetchAt(req, T2, withoutCell);
    const lastSeen = (
      await db.query(
        `select last_seen_batch_id from observations where table_id = $1 and region_code = 'NL01' and period_code = '2025JJ00'`,
        [TABLE],
      )
    ).rows[0]!.last_seen_batch_id;
    expect(Number(lastSeen)).toBe(firstBatch);

    const retained = served(await runQuery(db, intent(['NL01'], ['2025JJ00'])));
    expect(retained.attribution.syncedAt).toBe(T0);
    // The slice WAS checked at T2 — so staleness says "not re-confirmed
    // since T0", not "our last sync was T0".
    expect(retained.registry?.lastSyncAt).toBe(T2);

    expect(served(await runQuery(db, intent(['NL01'], ['2024JJ00']))).attribution.syncedAt).toBe(T2);
    const series = served(await runQuery(db, intent(['NL01'], ['2024JJ00', '2025JJ00'])));
    expect(series.attribution.syncedAt).toBe(T0);
    expect(series.registry?.lastSyncAt).toBe(T2);
  });

  it('a served cell no slice_fetches row accounts for -> internal_inconsistency, never an answer', async () => {
    await fetchAt(slice(['NL01'], ['2024JJ00', '2025JJ00']), T1);
    // The stored filter no longer names 2024JJ00: its cell is still in
    // observations but nothing accounts for it.
    await db.query(
      `update slice_fetches set filter = jsonb_set(filter, '{periods}', '["2025JJ00"]'::jsonb) where table_id = $1`,
      [TABLE],
    );

    expect(served(await runQuery(db, intent(['NL01'], ['2025JJ00']))).attribution.syncedAt).toBe(T1);
    for (const periods of [['2024JJ00'], ['2024JJ00', '2025JJ00']]) {
      const outcome = await runQuery(db, intent(['NL01'], periods));
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.refusal.kind).toBe('internal_inconsistency');
      expect(outcome.refusal.message).toContain('2024JJ00');
    }
  });

  it('never falls back to cbs_tables.last_sync_at for a slice_cache table (fails closed even if it were set)', async () => {
    await fetchAt(slice(['NL01'], ['2024JJ00']), T1);
    await db.query('update cbs_tables set last_sync_at = $2 where id = $1', [TABLE, T3]);
    // Covered: still dated by the slice, not by the (never-legitimate) table date.
    expect(served(await runQuery(db, intent(['NL01'], ['2024JJ00']))).attribution.syncedAt).toBe(T1);

    await db.query('delete from slice_fetches where table_id = $1', [TABLE]);
    const outcome = await runQuery(db, intent(['NL01'], ['2024JJ00']));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.refusal.kind).toBe('internal_inconsistency');
  });
});
