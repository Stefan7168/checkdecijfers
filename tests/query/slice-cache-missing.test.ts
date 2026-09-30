// Breadth step 2, Task 5 — the honest "not fetched" diagnosis in the query
// layer (src/query/run.ts's diagnoseMissing), for a slice_cache table:
//   (a) a missing coordinate INSIDE a fetched slice's filter (CBS returned no
//       cell for it) -> the EXISTING not_published path, unchanged wording;
//   (b) a missing coordinate OUTSIDE every fetched slice's filter -> the NEW
//       internal refusal kind 'not_fetched' (owner-alert bucket, never meant
//       to reach a real reader once ensureSlice always fetches first).
// Plus an unchanged-behaviour pin for a `full`-ingest table's own
// not_published (ruling: "Tables with ingest_mode = 'full' ... behave
// exactly as today").
//
// Own isolated PGlite db (createTestDb, not the heavier createIngestedDb) —
// registerSchemaOnly + fetchSlice give exactly the slice-cache state this
// file needs, cheaply, without a full fixture ingest.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { FixtureSource, loadFixtureDocs } from '../../src/cbs-adapter/fixture-source.ts';
import { fetchSlice, registerSchemaOnly, type SliceRequest } from '../../src/ingestion/slice-cache.ts';
import { registerTables, syncTable } from '../../src/ingestion/pipeline.ts';
import { SEED_TABLES } from '../../src/ingestion/registry-seed.ts';
import { runQuery } from '../../src/query/index.ts';
import type { StructuredIntent } from '../../src/query/index.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));

function fixturePath(tableId: string): string {
  return `${FIXTURES_DIR}/${tableId}`;
}

async function loadDocs(tableId: string) {
  return loadFixtureDocs(fixturePath(tableId));
}

function houseIntent(periodCode: string): StructuredIntent {
  return {
    schemaVersion: 1,
    target: { kind: 'explicit', tableId: '83625NED', measure: 'M001534' },
    regions: ['NL01'],
    period: { kind: 'codes', codes: [periodCode] },
    derivation: 'none',
  };
}

describe('diagnoseMissing on a slice_cache table (breadth step 2, Task 5)', () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    const docs = await loadDocs('83625NED');
    const source = new FixtureSource(docs);
    const reg = await registerSchemaOnly(db, source, '83625NED');
    if (!reg.ok) throw new Error(`registration failed: ${reg.summary}`);

    // ONE fetched slice: NL01, 2015JJ00 only (has a cell — it is deliberately
    // the ONLY, and therefore the FRESHEST, period this db ever fetched for
    // this coordinate). A later period we never fetched (2020JJ00, the (b)
    // test below) is therefore also NEWER than the freshest fetched cell —
    // exactly the case fix round 1 (finding 1) closes: diagnoseMissing must
    // recognize "never fetched" BEFORE it ever compares against freshness,
    // or this would misdiagnose as `freshness` ("not available yet … the
    // freshest we can serve is 2015JJ00"), a false claim about CBS.
    const wide: SliceRequest = { measures: ['M001534'], members: { RegioS: ['NL01'] }, periods: ['2015JJ00'] };
    const wideResult = await fetchSlice(db, new FixtureSource(docs), '83625NED', wide);
    if (!wideResult.ok) throw new Error(`priming fetch failed: ${wideResult.summary}`);

    // A SEPARATE, narrower slice whose requested period (1995JJ00) CBS
    // genuinely has no cell for (the ingestion test's own "counts requested
    // cells CBS has no row for as missingCells" case) — inside ITS OWN
    // fetched filter, so diagnoseMissing must reach the not_published path.
    const narrow: SliceRequest = { measures: ['M001534'], members: { RegioS: ['NL01'] }, periods: ['1995JJ00'] };
    const narrowResult = await fetchSlice(db, new FixtureSource(docs), '83625NED', narrow);
    if (!narrowResult.ok) throw new Error(`priming fetch failed: ${narrowResult.summary}`);
    if (narrowResult.missingCells !== 1) {
      throw new Error(`fixture precondition: 1995JJ00 must be a real CBS "no cell" case, got missingCells=${narrowResult.missingCells}`);
    }
  }, 60_000);

  afterAll(async () => {
    await close();
  });

  it('(a) inside a fetched slice, CBS returned no cell -> the EXISTING not_published refusal', async () => {
    const outcome = await runQuery(db, houseIntent('1995JJ00'));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.refusal.kind).toBe('not_published');
  });

  it('final-review fix 3: the missing-cell diagnosis never probes information_schema (slice-cache-ness comes from the loaded registry row)', async () => {
    const log: string[] = [];
    const wrap = (d: Db): Db => ({
      query: (text, params) => {
        log.push(text);
        return d.query(text, params);
      },
      withTransaction: (fn) => d.withTransaction((tx) => fn(wrap(tx))),
    });
    const logging = wrap(db);
    for (const period of ['1995JJ00', '2020JJ00']) {
      const outcome = await runQuery(logging, houseIntent(period));
      expect(outcome.ok).toBe(false);
    }
    expect(log.some((sql) => sql.includes('information_schema'))).toBe(false);
  });

  it('(b) outside every fetched slice, and NEWER than the freshest fetched cell -> not_fetched, never the misleading freshness refusal', async () => {
    // 2020JJ00 was never named in any slice_fetches filter, AND it is newer
    // than 2015JJ00 (the freshest — and only — period this db ever fetched).
    // Fix round 1 (finding 1): before the reorder, freshness ran first and
    // this case wrongly read as "not available yet … freshest we can serve
    // is 2015JJ00" — a false claim, since CBS may well publish 2020JJ00 and
    // we simply never asked. The fix checks not_fetched BEFORE freshness.
    const outcome = await runQuery(db, houseIntent('2020JJ00'));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.refusal.kind).toBe('not_fetched');
    expect(outcome.refusal.message).toContain('2020JJ00');
    expect(outcome.refusal.message.toLowerCase()).toContain('ensureslice');
  });

  it('(d) a period outside CBS\'s own Perioden code list -> the whole-table not_published, never not_fetched', async () => {
    // ADR 065 step 6: no fetch could ever cover a period CBS does not list, so
    // "never fetched" would be a false owner alert; this is the same diagnosis
    // a full table gives for the same ask (the describe block below).
    const outcome = await runQuery(db, houseIntent('1899JJ00'));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.refusal.kind).toBe('not_published');
    expect(outcome.refusal.message).toContain('CBS has not published period 1899JJ00');
  });

  // Fix round 1 (minor finding 2) left an it.todo here: a slice-cache table
  // could not be SERVED at all (cbs_tables.last_sync_at stays null for it and
  // run.ts refused any such result). Task 5b replaced that refusal with the
  // real invariant (every served cell covered by a slice_fetches row, dated by
  // its latest checked_at) — the full dating semantics are pinned in
  // tests/query/slice-cache-answer.test.ts; this is the served counterpart of
  // (a)/(b) on the same fixture state.
  it('(c) a coordinate inside a fetched slice WITH a cell -> served, dated by that slice\'s checked_at', async () => {
    const outcome = await runQuery(db, houseIntent('2015JJ00'));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.cells).toHaveLength(1);
    expect(outcome.cells[0]!.periodCode).toBe('2015JJ00');
    expect(outcome.cells[0]!.value).not.toBeNull();
    const checkedAt = (
      await db.query('select checked_at from slice_fetches where table_id = $1 and filter @> $2::jsonb', [
        '83625NED',
        JSON.stringify({ periods: ['2015JJ00'] }),
      ])
    ).rows[0]!.checked_at as string | Date;
    expect(outcome.attribution.syncedAt).toBe(new Date(checkedAt).toISOString());
  });
});

describe("a full-ingest table's not_published stays exactly as today (ruling: unchanged for ingest_mode = 'full')", () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    const table = SEED_TABLES.find((t) => t.id === '83625NED');
    if (!table) throw new Error('no Phase0Table registry entry for 83625NED');
    const docs = await loadDocs('83625NED');
    await registerTables(db, new FixtureSource(docs), [table]);
    const sync = await syncTable(db, new FixtureSource(docs), '83625NED');
    if (sync.outcome !== 'succeeded') throw new Error(`sync failed: ${sync.failureSummary}`);
  }, 60_000);

  afterAll(async () => {
    await close();
  });

  it('a period genuinely outside CBS\'s own Perioden code list -> not_published, unaffected by the slice-cache branch', async () => {
    const outcome = await runQuery(db, houseIntent('1899JJ00'));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    // ingest_mode defaults to 'full' for registerTables/syncTable (migration
    // 037's own default) — the slice-cache branch (q.table.ingestMode) must read false here and never
    // route through insideAnyFetchedSlice at all.
    expect(outcome.refusal.kind).toBe('not_published');
  });
});

describe('a pre-migration-037 database behaves exactly as today (no ingest_mode column -> full-table diagnosis unchanged)', () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    const table = SEED_TABLES.find((t) => t.id === '83625NED');
    if (!table) throw new Error('no Phase0Table registry entry for 83625NED');
    const docs = await loadDocs('83625NED');
    await registerTables(db, new FixtureSource(docs), [table]);
    const sync = await syncTable(db, new FixtureSource(docs), '83625NED');
    if (sync.outcome !== 'succeeded') throw new Error(`sync failed: ${sync.failureSummary}`);
    // Simulate a database migration 037 has not yet reached: drop its columns
    // (slice_fetches itself is untouched — nothing here reads it once the
    // ingest_mode column is absent). The registry read (select *) must tolerate this, not error.
    await db.query('alter table cbs_tables drop column ingest_mode, drop column schema_cbs_modified');
  }, 60_000);

  afterAll(async () => {
    await close();
  });

  it('diagnoses a not_published period without erroring on the missing ingest_mode column', async () => {
    const outcome = await runQuery(db, houseIntent('1899JJ00'));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.refusal.kind).toBe('not_published');
  });
});
