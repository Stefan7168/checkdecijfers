// #110(b): the last_queried_at usage bump (migration 025) — the query
// executor's bookkeeping half of the on-demand table lifecycle
// (src/ingestion/eviction.ts is the GC half; tests/ingestion/eviction.test.ts
// its suite). Pins the three properties the eviction design leans on:
//  - runQuery records that a table served a read (the eviction anchor);
//  - the bump is DEBOUNCED in the WHERE itself — a fresh timestamp is not
//    rewritten (at most ~one write per table per day), a >1-day-stale one is;
//  - the bump can NEVER fail the read path (the migration-025 deploy-window
//    guarantee: pre-migration code paths warn, answers still serve).
import { describe, expect, it } from 'vitest';
import { runQuery, touchLastQueriedAt } from '../../src/query/index.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { ANSWERABLE_TASKS } from '../helpers/benchmark-intents.ts';

async function insertBareTable(db: Db, id: string): Promise<void> {
  await db.query(
    `insert into cbs_tables (id, title, expected_dimensions) values ($1, $2, '[]'::jsonb)`,
    [id, `Testtabel ${id}`],
  );
}

async function lastQueriedAt(db: Db, id: string): Promise<Date | null> {
  const { rows } = await db.query('select last_queried_at from cbs_tables where id = $1', [id]);
  const value = rows[0]!.last_queried_at;
  return value == null ? null : new Date(String(value instanceof Date ? value.toISOString() : value));
}

describe('touchLastQueriedAt — debounced usage bump', () => {
  it('sets a null timestamp, then debounces (a fresh value is not rewritten)', async () => {
    const { db, close } = await createTestDb();
    try {
      await insertBareTable(db, 'TOUCH001');
      expect(await lastQueriedAt(db, 'TOUCH001')).toBeNull();

      await touchLastQueriedAt(db, 'TOUCH001');
      const first = await lastQueriedAt(db, 'TOUCH001');
      expect(first).not.toBeNull();

      // Immediately touching again writes NOTHING — the debounce is the WHERE
      // clause, so the stored instant stays byte-identical.
      await touchLastQueriedAt(db, 'TOUCH001');
      expect((await lastQueriedAt(db, 'TOUCH001'))!.toISOString()).toBe(first!.toISOString());
    } finally {
      await close();
    }
  });

  it('bumps a value that is more than a day stale', async () => {
    const { db, close } = await createTestDb();
    try {
      await insertBareTable(db, 'TOUCH002');
      await db.query(
        `update cbs_tables set last_queried_at = now() - interval '2 days' where id = $1`,
        ['TOUCH002'],
      );
      const stale = await lastQueriedAt(db, 'TOUCH002');

      await touchLastQueriedAt(db, 'TOUCH002');
      const bumped = await lastQueriedAt(db, 'TOUCH002');
      expect(bumped!.getTime()).toBeGreaterThan(stale!.getTime());
    } finally {
      await close();
    }
  });

  it('never throws when the column is missing (the migration-025 deploy window)', async () => {
    const { db, close } = await createTestDb();
    try {
      await insertBareTable(db, 'TOUCH003');
      await db.query('alter table cbs_tables drop column last_queried_at');
      // Must resolve (warn-only), never reject — an answer may not fail on
      // lifecycle bookkeeping.
      await expect(touchLastQueriedAt(db, 'TOUCH003')).resolves.toBeUndefined();
    } finally {
      await close();
    }
  });
});

describe('runQuery — bumps the resolved table', () => {
  it('a served benchmark intent stamps its own table', async () => {
    const { db, close } = await createIngestedDb();
    try {
      // Seed rows are registered AFTER migration 025 in the hermetic build, so
      // they start life never-queried — exactly the pre-first-answer state.
      const [taskId, task] = Object.entries(ANSWERABLE_TASKS)[0]!;
      const outcome = await runQuery(db, task.intent);
      if (!outcome.ok) throw new Error(`benchmark intent ${taskId} did not serve: ${outcome.refusal.kind}`);

      const tableId = outcome.cells[0]!.tableId;
      expect(await lastQueriedAt(db, tableId)).not.toBeNull();
    } finally {
      await close();
    }
  });
});
