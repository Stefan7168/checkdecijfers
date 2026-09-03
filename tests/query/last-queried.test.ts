// #110(b): the last_queried_at usage bump (migration 025) — the query
// executor's bookkeeping half of the on-demand table lifecycle
// (src/ingestion/eviction.ts is the GC half; tests/ingestion/eviction.test.ts
// its suite). Pins the three properties the eviction design leans on:
//  - runQuery records that a table served a read (the eviction anchor);
//  - the bump is DEBOUNCED in the WHERE itself — a fresh timestamp is not
//    rewritten (at most ~one write per table per day), a >1-day-stale one is;
//  - the bump can NEVER fail the read path (the migration-025 deploy-window
//    guarantee: pre-migration code paths warn, answers still serve).
//
// #195 (session 72): a FOURTH property — a `probe: true` read (the
// echoServability primitive every follow-up/comparison chip and alternate-
// reading check funnels through) must NEVER bump the clock. Only a read that
// can actually DELIVER an answer counts as demand for the eviction GC; the
// eviction anchor now reads as "last served/delivered read", not "last
// touched by any internal machinery".
import { describe, expect, it } from 'vitest';
import { runQuery, touchLastQueriedAt, echoServability } from '../../src/query/index.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import { createIngestedDb, tableIdForCanonicalKey } from '../helpers/ingested-db.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

  it('#195: a probe read on the SAME servable intent does NOT stamp the table', async () => {
    const { db, close } = await createIngestedDb();
    try {
      const [taskId, task] = Object.entries(ANSWERABLE_TASKS)[0]!;
      const outcome = await runQuery(db, task.intent, { probe: true });
      if (!outcome.ok) throw new Error(`benchmark intent ${taskId} did not serve: ${outcome.refusal.kind}`);

      const tableId = outcome.cells[0]!.tableId;
      // Never queried before (fresh fixture db) and this call was a probe —
      // the eviction anchor must stay null, exactly the pre-first-answer state.
      expect(await lastQueriedAt(db, tableId)).toBeNull();
    } finally {
      await close();
    }
  });

  it('#195: echoServability (the dry-run primitive) never stamps the table it checks', async () => {
    const { db, close } = await createIngestedDb();
    try {
      const [taskId, task] = Object.entries(ANSWERABLE_TASKS)[0]!;
      const servability = await echoServability(db, task.intent);
      expect(servability.servable).toBe(true);

      // echoServability's own return type carries no cells (R1/principle c
      // confinement), so recover the table id independently — straight from
      // the registry, never through another runQuery call — so this
      // assertion proves ONLY echoServability's own call left no bump.
      if (task.intent.target.kind !== 'canonical') throw new Error(`${taskId}: expected a canonical target`);
      const tableId = await tableIdForCanonicalKey(db, task.intent.target.key);
      expect(await lastQueriedAt(db, tableId)).toBeNull();
    } finally {
      await close();
    }
  });
});

// #196 (session 73): the touch must SKIP a row an eviction holds `for update`
// instead of queueing behind that transaction (a served answer's latency and
// its pooled connection, #173, must never be coupled to an eviction's commit).
// The contention itself cannot be exercised under single-connection PGlite —
// the same recorded judgment as tests/ingestion/onboarding-store.test.ts's
// claimOnePending pin — so the clause is pinned in the function's own source.
describe('touchLastQueriedAt — skip-locked source pin (untestable behaviorally under PGlite)', () => {
  it('takes the row with FOR NO KEY UPDATE SKIP LOCKED inside touchLastQueriedAt itself', () => {
    const source = readFileSync(fileURLToPath(new URL('../../src/query/run.ts', import.meta.url)), 'utf8');
    const start = source.indexOf('export async function touchLastQueriedAt');
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf('\nexport ', start + 1);
    const body = source.slice(start, end === -1 ? undefined : end);
    expect(body).toContain('for no key update skip locked');
    expect(body).toContain('set last_queried_at = now()');
  });
});
