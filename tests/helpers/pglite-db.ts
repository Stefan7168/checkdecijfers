// Test-only Db implementation over PGlite (in-memory Postgres, single connection).
// Mirrors src/db/client.ts's poolDb shape so the ingestion pipeline under test
// cannot tell it apart from the production pg.Pool-backed Db.
//
// PGlite serves one query at a time: withTransaction's begin/commit/rollback
// must never interleave with a concurrent top-level query, so every query --
// transactional or not -- is funneled through one promise-chain mutex.
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations } from '../../src/db/migrate.ts';
import type { Db, QueryResultRow } from '../../src/db/types.ts';

/** Serializes async work onto a single chain; PGlite has exactly one connection. */
function createMutex() {
  let tail: Promise<unknown> = Promise.resolve();
  return function run<T>(fn: () => Promise<T>): Promise<T> {
    const result = tail.then(fn, fn);
    // Swallow rejections in the chain itself so one failed statement doesn't
    // permanently wedge the mutex for later, unrelated queries.
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

/**
 * PGlite's `.query()` uses the extended (prepared-statement) protocol, which
 * rejects multi-statement SQL text (e.g. a migration file with several
 * `create table` statements back to back). `.exec()` uses the simple-query
 * protocol, which allows multiple statements but not bound parameters.
 * Params-less callers (migrations, ad-hoc multi-statement SQL) go through
 * `.exec()`; parameterized callers go through `.query()`.
 */
async function runQuery(
  client: PGlite,
  text: string,
  params?: unknown[],
): Promise<{ rows: QueryResultRow[] }> {
  if (params === undefined) {
    const results = await client.exec(text);
    const last = results[results.length - 1];
    return { rows: (last?.rows ?? []) as QueryResultRow[] };
  }
  const result = await client.query<QueryResultRow>(text, params);
  return { rows: result.rows };
}

function wrapClient(client: PGlite, run: <T>(fn: () => Promise<T>) => Promise<T>): Db {
  const db: Db = {
    query: (text, params) => run(() => runQuery(client, text, params)),
    withTransaction: async (fn) => {
      return run(async () => {
        await client.exec('begin');
        const txDb: Db = {
          query: (text, params) => runQuery(client, text, params),
          withTransaction: () => {
            throw new Error('nested transactions are not supported');
          },
        };
        try {
          const value = await fn(txDb);
          await client.exec('commit');
          return value;
        } catch (err) {
          await client.exec('rollback');
          throw err;
        }
      });
    },
  };
  return db;
}

/** Fresh in-memory PGlite database with all migrations applied. */
export async function createTestDb(): Promise<{ db: Db; close(): Promise<void> }> {
  const client = new PGlite();
  const run = createMutex();
  const db = wrapClient(client, run);
  await applyMigrations(db);
  return {
    db,
    close: () => client.close(),
  };
}
