// The shared fixture snapshot is a TEST-INFRASTRUCTURE change, which is exactly
// the kind that can silently weaken every other suite. Its safety rests on one
// property: each caller of createIngestedDb() gets a PRIVATE database, so a
// suite that mutates its copy cannot be observed by any other.
//
// That property is what makes tests/answer/answer-first-region.test.ts and
// answer-first-period.test.ts safe — both DELETE rows deliberately and restore
// them in a `finally`. Under a genuinely shared mutable database they would go
// order-dependent and flaky, and the flakiness would look like a product bug.
//
// So the property gets a test of its own rather than a comment. Without this,
// a future "optimization" that memoises one shared Db behind createIngestedDb()
// would pass the whole suite and quietly poison it.
import { describe, expect, it } from 'vitest';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fixtureInputFiles,
  fixtureInputsHash,
  pruneSnapshots,
  restoreFromSnapshot,
} from '../helpers/fixture-snapshot.ts';

async function countObservations(db: Awaited<ReturnType<typeof createIngestedDb>>['db']) {
  const { rows } = await db.query('select count(*)::int as n from observations');
  return Number(rows[0]!.n);
}

describe('createIngestedDb hands out isolated databases', () => {
  it('a destructive change in one database is invisible to another', async () => {
    const a = await createIngestedDb();
    const b = await createIngestedDb();
    try {
      const before = await countObservations(a.db);
      expect(before).toBeGreaterThan(0);
      expect(await countObservations(b.db)).toBe(before);

      // The exact shape the answer-first suites use: delete, assert, restore.
      await a.db.query('delete from observations');
      expect(await countObservations(a.db)).toBe(0);

      // The whole point. If this ever reads 0, every mutating suite in the
      // repo has become order-dependent.
      expect(await countObservations(b.db)).toBe(before);
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('every seed table and its rows survive the restore', async () => {
    const { db, close } = await createIngestedDb();
    try {
      const { rows: tables } = await db.query('select count(*)::int as n from cbs_tables');
      const { rows: batches } = await db.query('select count(*)::int as n from ingestion_batches');
      // One completed batch per whole-table sync, one per stored slice for a
      // slice-stored table (the default build, INGEST_FIXTURE_MODE=slice) — so
      // in the full build this is exactly one batch per table.
      const { rows: expected } = await db.query(
        `select sum(case when t.ingest_mode = 'full' then 1
                         else (select count(*) from slice_fetches sf where sf.table_id = t.id) end)::int as n
           from cbs_tables t`,
      );
      // Registered tables, their completed batches, and real cells: a
      // restore that silently produced an empty-but-migrated database would
      // otherwise turn every downstream suite red in a confusing way.
      expect(Number(tables[0]!.n)).toBeGreaterThan(0);
      expect(Number(batches[0]!.n)).toBe(Number(expected[0]!.n));
      const { rows: unfinished } = await db.query(`select id from ingestion_batches where outcome <> 'succeeded'`);
      expect(unfinished).toEqual([]);
      expect(await countObservations(db)).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  it('a corrupt snapshot degrades to the slow path instead of throwing', async () => {
    // Reproduces the failure a review pass found by experiment: an interrupted
    // CI cache restore leaves a truncated file, and before this returned null
    // it threw out of every one of the 34 dependent suites at once. A broken
    // cache may cost time; it may never cost a red suite.
    const garbage = Buffer.from('this is not a postgres data directory');
    await expect(restoreFromSnapshot(garbage)).resolves.toBeNull();
  });

  it('the cache key covers every file that decides what gets ingested', async () => {
    // The first version of the key named two files by hand and missed six that
    // change the ingested rows. The failure that hides behind that is the worst
    // kind: fix a parser bug, run the suite, and pass against a snapshot built
    // BEFORE the fix. So the key is over-broad on purpose, and this test is
    // what stops a future "optimization" from narrowing it back to a list.
    const files = fixtureInputFiles().map((f) => f.replace(/^.*\/(?=src\/|migrations\/|tests\/)/, ''));
    for (const required of [
      'src/ingestion/pipeline.ts',
      'src/ingestion/periods.ts',
      'src/ingestion/validate.ts',
      'src/ingestion/registry-seed.ts',
      'src/cbs-adapter/parse-v4.ts',
      'src/registry/apply.ts',
      'src/registry/defaults.ts',
      'src/db/migrate.ts',
    ]) {
      expect(files, `${required} must be part of the fixture-snapshot cache key`).toContain(required);
    }
    // And the two data trees the ingest reads.
    expect(files.some((f) => f.startsWith('migrations/'))).toBe(true);
    expect(files.some((f) => f.startsWith('tests/fixtures/cbs/'))).toBe(true);
    // Stable across calls — a key that drifted would rebuild on every run.
    expect(fixtureInputsHash()).toBe(fixtureInputsHash());
  });

  it('closing one database does not disturb another still in use', async () => {
    const first = await createIngestedDb();
    const second = await createIngestedDb();
    const before = await countObservations(second.db);
    await first.close();
    try {
      expect(await countObservations(second.db)).toBe(before);
    } finally {
      await second.close();
    }
  });
});

// Session 143 (2026-09-29): the cache key hashes all of src/, so every edit
// mints a new ~160 MB snapshot; with no eviction the cache reached 166 files
// and 24.5 GB in four days. ensureSnapshot() now prunes after every write.
describe('pruneSnapshots keeps the cache bounded', () => {
  it('keeps the N newest ingested-*.tar files, removes older ones and stale .tmp files, ignores everything else', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cdc-fixture-db-'));
    try {
      const day = 24 * 60 * 60 * 1000;
      const now = Date.now();
      const mk = (name: string, ageMs: number) => {
        const path = join(dir, name);
        writeFileSync(path, 'x');
        utimesSync(path, (now - ageMs) / 1000, (now - ageMs) / 1000);
        return path;
      };
      mk('ingested-0000000000000001.tar', 5 * day);
      mk('ingested-0000000000000002.tar', 4 * day);
      const keep3 = mk('ingested-0000000000000003.tar', 3 * day);
      const keep4 = mk('ingested-0000000000000004.tar', 2 * day);
      const keep5 = mk('ingested-0000000000000005.tar', 0);
      const staleTmp = mk('ingested-00000000000000ab.tar.123.tmp', 2 * 60 * 60 * 1000);
      const freshTmp = mk('ingested-00000000000000cd.tar.456.tmp', 60 * 1000);
      const other = mk('README.txt', 10 * day);

      const removed = pruneSnapshots(dir, 3).sort();

      expect(removed).toEqual([join(dir, 'ingested-0000000000000001.tar'), join(dir, 'ingested-0000000000000002.tar'), staleTmp].sort());
      const left = readdirSync(dir).map((n) => join(dir, n)).sort();
      expect(left).toEqual([keep3, keep4, keep5, freshTmp, other].sort());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a missing directory is not an error', () => {
    expect(pruneSnapshots(join(tmpdir(), 'cdc-does-not-exist-' + Date.now()), 3)).toEqual([]);
  });
});

