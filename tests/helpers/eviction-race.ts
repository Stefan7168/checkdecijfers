// #196: a synthetic, deterministic eviction race — shared by
// tests/query/eviction-race.test.ts (run.ts's read arc) and
// tests/query/resolve-eviction-race.test.ts (resolveIntent's read arc, the
// structural follow-up). PGlite serves one query at a time
// (tests/helpers/pglite-db.ts), so there is no real concurrency to race
// against; instead this wraps the Db so a synthetic eviction (the SAME five
// deletes, in the SAME FK-safe order and in ONE transaction, as
// evictStaleTables performs them, src/ingestion/eviction.ts) is injected at
// exactly one moment relative to a chosen statement — the same
// intercept-and-count technique tests/answer/query-count.test.ts's
// `countingDb` uses to observe statement order, here used to inject writes
// instead of just counting.
//
// What this proves: the code's behaviour against an eviction that has
// COMMITTED between two of its statements, at every interleaving that
// matters. What it cannot prove (single connection, no real second session):
// the BLOCKING half of any lock — an eviction still holding its row lock
// (touchLastQueriedAt's skip-locked half, source-pinned in
// tests/query/last-queried.test.ts) or the #196 advisory lock resolveIntent
// and eviction now both take (source-pinned in
// tests/query/resolve-eviction-race.test.ts). Real blocking needs two live
// sessions; this technique only sequences ONE.
import type { Db, QueryResultRow } from '../../src/db/types.ts';

/** Reproduces an eviction race deterministically. A synthetic eviction of
 * `tableId` runs at exactly one moment relative to the FIRST query whose SQL
 * text contains `matchSubstring`:
 *  - `timing: 'before'` — the eviction runs, THEN the matching query executes
 *    (it sees nothing) — the eviction wins the race against the read.
 *  - `timing: 'after'`  — the matching query executes FIRST (it sees the real
 *    data), and the eviction runs before the NEXT operation issued after it —
 *    a plain query, OR entry into a `withTransaction` block (#196: resolveIntent
 *    opens one once `tableId` is known) — the eviction lands just after the
 *    read already captured what it needed.
 * Fires at most once either way.
 *
 * #196: the 'after'-armed check also guards `withTransaction` entry, not just
 * `query`. Without it, an eviction arming on a statement issued just before
 * the caller opens its OWN transaction (resolveIntent's locked read arc) would
 * fire from INSIDE that transaction's `tx` — and `evict`'s own `withTransaction`
 * call would then be a NESTED transaction, which both PGlite
 * (tests/helpers/pglite-db.ts) and the real pg client (src/db/client.ts)
 * explicitly throw on. Firing on `withTransaction` entry instead evicts using
 * the OUTER (never-nested) `target` — the codebase never nests transactions
 * itself (client.ts: "no transaction nests, verified across all 14 call
 * sites"), so this is always reachable at the top level in practice. */
export function withEvictionRace(inner: Db, tableId: string, timing: 'before' | 'after', matchSubstring: string): Db {
  let phase: 'pending' | 'armed' | 'done' = 'pending';
  const evict = async (target: Db): Promise<void> => {
    // One transaction, like evictStaleTables — a committed eviction is
    // all-or-nothing; `target` is the inner Db, so nothing here is intercepted.
    await target.withTransaction(async (tx) => {
      await tx.query('delete from observations where table_id = $1', [tableId]);
      await tx.query('delete from dimension_labels where table_id = $1', [tableId]);
      await tx.query('delete from canonical_measures where table_id = $1', [tableId]);
      await tx.query('delete from ingestion_batches where table_id = $1', [tableId]);
      await tx.query('delete from cbs_tables where id = $1', [tableId]);
    });
  };
  const wrap = (target: Db): Db => ({
    async query(text: string, params?: unknown[]): Promise<{ rows: QueryResultRow[] }> {
      const isMatch = phase === 'pending' && text.toLowerCase().includes(matchSubstring);
      if (timing === 'before' && isMatch) {
        await evict(target);
        phase = 'done';
        return target.query(text, params);
      }
      if (timing === 'after' && phase === 'armed') {
        await evict(target);
        phase = 'done';
        return target.query(text, params);
      }
      const result = await target.query(text, params);
      if (timing === 'after' && isMatch) phase = 'armed';
      return result;
    },
    async withTransaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      if (timing === 'after' && phase === 'armed') {
        await evict(target);
        phase = 'done';
      }
      return target.withTransaction((tx) => fn(wrap(tx)));
    },
  });
  return wrap(inner);
}
