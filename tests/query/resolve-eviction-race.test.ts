// #196 (structural follow-up, session 76): the SAME eviction race
// tests/query/eviction-race.test.ts pins for run.ts's read arc, one step
// EARLIER — inside resolveIntent's own registry reads (src/query/resolve.ts):
// the canonical_measures lookup (target resolution) and the reads that follow
// it once `tableId` is known (fetchTable, the per-dimension dimension_labels
// reads, the region reads). Before this fix those were several separate
// autocommit statements with no shared snapshot and no lock, so an eviction
// landing in any gap between them could surface as a FABRICATED
// table_not_registered or invalid_intent ("code does not exist in dimension")
// instead of the honest "evicted mid-flight" outcome -- principle (c)'s "never
// guess" applies to refusal REASONS too, not only to values.
//
// The fix (resolve.ts): a per-table pg_advisory_xact_lock, SHARED here and
// EXCLUSIVE in eviction's per-table transaction (src/ingestion/eviction.ts) --
// "eviction yields to an in-flight read" by construction. Reused technique:
// withEvictionRace (tests/helpers/eviction-race.ts) -- its header has the
// full explanation and what it cannot prove under single-connection PGlite
// (real LOCK BLOCKING needs two live sessions; this only sequences one). What
// THIS file proves instead: regardless of exactly where, between the
// canonical_measures lookup and the lock, a committed eviction lands, the
// caller never sees a fabricated refusal kind for a table it just asked
// about -- proven at the LOGIC level, which is what the lock's blocking
// behavior exists to make hold in production too.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runQuery } from '../../src/query/index.ts';
import type { Db, QueryResultRow } from '../../src/db/types.ts';
import { createIngestedDb, tableIdForCanonicalKey } from '../helpers/ingested-db.ts';
import { ANSWERABLE_TASKS } from '../helpers/benchmark-intents.ts';
import { withEvictionRace } from '../helpers/eviction-race.ts';

const B1 = ANSWERABLE_TASKS.B1!; // population_on_1_january, NL01, 2025 -- single coordinate
/** resolveIntent's canonical-measures target-resolution lookup (resolve.ts,
 * around line 329) -- the ONE read that runs before `tableId` (and so the
 * advisory lock) is known. Not 'canonical_measures' alone: `delete from
 * canonical_measures` (the synthetic eviction itself) would also match. */
const CANONICAL_LOOKUP = 'from canonical_measures where key';

describe('#196 structural follow-up: an eviction racing resolveIntent own reads', () => {
  it('commits between the canonical_measures lookup and the table fetch: table_evicted, never table_not_registered/invalid_intent/no_data/not_published/freshness', async () => {
    const { db, close } = await createIngestedDb();
    try {
      if (B1.intent.target.kind !== 'canonical') throw new Error('expected a canonical target');
      const tableId = await tableIdForCanonicalKey(db, B1.intent.target.key);

      // 'after' the canonical_measures lookup: that lookup runs first (finds
      // the real row, tableId becomes known), THEN the eviction commits,
      // THEN the very next statement resolveIntent issues (the advisory lock
      // acquisition, immediately followed by the now-empty table fetch) runs
      // -- the one window this fix cannot lock (tableId isn't known before
      // the lookup returns), closed instead by proving the OUTCOME is honest.
      const raced = withEvictionRace(db, tableId, 'after', CANONICAL_LOOKUP);
      const outcome = await runQuery(raced, B1.intent);

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.refusal.kind).toBe('table_evicted');
      expect(outcome.refusal.kind).not.toBe('table_not_registered');
      expect(outcome.refusal.kind).not.toBe('invalid_intent');
      expect(outcome.refusal.kind).not.toBe('no_data');
      expect(outcome.refusal.kind).not.toBe('not_published');
      expect(outcome.refusal.kind).not.toBe('freshness');
      // Same wording run.ts's own race window uses (eviction-race.test.ts) --
      // one honest sentence regardless of which read arc hit the race.
      expect(outcome.refusal.message).toContain('evicted while this query was in flight');
      expect(outcome.refusal.message).toContain(tableId);
    } finally {
      await close();
    }
  });

  it('commits entirely before the canonical_measures lookup even runs: the by-design never-onboarded outcome, not a race artifact', async () => {
    const { db, close } = await createIngestedDb();
    try {
      if (B1.intent.target.kind !== 'canonical') throw new Error('expected a canonical target');
      const tableId = await tableIdForCanonicalKey(db, B1.intent.target.key);

      // 'before': the eviction commits, THEN the canonical_measures lookup
      // runs -- no query was ever "in flight" against a table this call could
      // see, so this is not the race the fix closes. It is the eviction
      // header's own documented design (src/ingestion/eviction.ts): a fully
      // evicted table's vocabulary is gone too, so a fresh ask for it looks
      // exactly like a topic that was never onboarded -- "unknown canonical
      // measure key", never table_evicted (there is no in-flight query to
      // tell that story to) and never one of the banned fabricated kinds.
      const raced = withEvictionRace(db, tableId, 'before', CANONICAL_LOOKUP);
      const outcome = await runQuery(raced, B1.intent);

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.refusal.kind).toBe('invalid_intent');
      expect(outcome.refusal.message).toContain('unknown canonical measure key');
      expect(outcome.refusal.kind).not.toBe('no_data');
      expect(outcome.refusal.kind).not.toBe('not_published');
      expect(outcome.refusal.kind).not.toBe('freshness');
      expect(outcome.refusal.kind).not.toBe('table_not_registered');
    } finally {
      await close();
    }
  });

  it('an unraced call is unaffected by the lock: resolves and serves exactly as before', async () => {
    const { db, close } = await createIngestedDb();
    try {
      const outcome = await runQuery(db, B1.intent);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('unreachable');
      expect(outcome.cells.length).toBeGreaterThan(0);
      expect(outcome.cells[0]!.value).not.toBeNull();
    } finally {
      await close();
    }
  });

  it('the lock sits between the canonical_measures lookup and the table fetch, in real statement order', async () => {
    const { db, close } = await createIngestedDb();
    try {
      // Plain statement logger (no injected writes -- a straight passthrough),
      // the same intercept-and-count technique tests/answer/query-count.test.ts's
      // countingDb and this file's sibling eviction-race.test.ts's last test use.
      const statements: string[] = [];
      const wrap = (target: Db): Db => ({
        async query(text: string, params?: unknown[]): Promise<{ rows: QueryResultRow[] }> {
          statements.push(text.toLowerCase());
          return target.query(text, params);
        },
        withTransaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
          return target.withTransaction((tx) => fn(wrap(tx)));
        },
      });
      const outcome = await runQuery(wrap(db), B1.intent);
      expect(outcome.ok).toBe(true);

      const lookupAt = statements.findIndex((s) => s.includes(CANONICAL_LOOKUP));
      const lockAt = statements.findIndex((s) => s.includes('pg_advisory_xact_lock_shared'));
      const fetchTableAt = statements.findIndex((s) => s.includes('from cbs_tables where id = $1'));
      expect(lookupAt).toBeGreaterThan(-1);
      expect(lockAt).toBeGreaterThan(lookupAt);
      expect(fetchTableAt).toBeGreaterThan(lockAt);
    } finally {
      await close();
    }
  });
});

// #196: the advisory lock's BLOCKING behaviour needs two live sessions and is
// untestable under single-connection PGlite -- the same recorded judgment as
// touchLastQueriedAt's skip-locked half (tests/query/last-queried.test.ts) and
// pipeline.ts's rebaseline lock (tests/ingestion/ingestion.test.ts). Source-
// pinned instead: both sides take the SAME hashtext(tableId) key, the reader
// SHARED and eviction EXCLUSIVE, and the reader's lock statement runs BEFORE
// the table fetch it protects.
describe('#196 advisory lock: source pin (untestable behaviorally under PGlite)', () => {
  it('resolveIntent takes pg_advisory_xact_lock_shared(hashtext(tableId)) before fetching the table row', () => {
    const source = readFileSync(fileURLToPath(new URL('../../src/query/resolve.ts', import.meta.url)), 'utf8');
    const start = source.indexOf('export async function resolveIntent');
    expect(start).toBeGreaterThan(-1);
    const lockAt = source.indexOf('pg_advisory_xact_lock_shared(hashtext(', start);
    expect(lockAt).toBeGreaterThan(start);
    const fetchTableCallAt = source.indexOf('fetchTable(tx, tableId)', start);
    expect(fetchTableCallAt).toBeGreaterThan(lockAt);
    // SHARED, never the exclusive form, so concurrent reads of the same
    // table never block each other.
    const snippet = source.slice(lockAt, lockAt + 40);
    expect(snippet).toContain('pg_advisory_xact_lock_shared');
  });

  it('evictStaleTables takes the EXCLUSIVE pg_advisory_xact_lock(hashtext(tableId)) first, before its row lock', () => {
    const source = readFileSync(fileURLToPath(new URL('../../src/ingestion/eviction.ts', import.meta.url)), 'utf8');
    const start = source.indexOf('export async function evictStaleTables');
    expect(start).toBeGreaterThan(-1);
    const lockAt = source.indexOf('pg_advisory_xact_lock(hashtext(', start);
    expect(lockAt).toBeGreaterThan(start);
    // Not the _shared variant -- eviction is the sole EXCLUSIVE acquirer.
    const snippet = source.slice(lockAt, lockAt + 40);
    expect(snippet).not.toContain('pg_advisory_xact_lock_shared');
    const rowLockAt = source.indexOf('for update', lockAt);
    expect(rowLockAt).toBeGreaterThan(lockAt);
  });

  // #196 review round 2 (session 76): a HIGH review of PR #128 found this
  // coupling undisclosed -- src/ingestion/pipeline.ts's manual `--rebaseline`
  // sync ALSO takes an EXCLUSIVE pg_advisory_xact_lock on this identical key,
  // pre-existing this PR and never before checked against resolveIntent's new
  // SHARED acquisition. Real blocking between the two is the same untestable-
  // under-single-connection-PGlite limitation as every other lock pair here
  // (see this describe block's own header) -- this pins the one thing that
  // CAN be checked statically: both sides key on hashtext() of the SAME
  // tableId parameter, so a future refactor cannot silently point one at a
  // different key (e.g. a salted or namespaced hash) while leaving the other
  // unchanged, which would silently break the "eviction/rebaseline yields to
  // an in-flight read" guarantee without any test failing to say so.
  it('pipeline.ts\'s --rebaseline sync takes the SAME EXCLUSIVE pg_advisory_xact_lock(hashtext(tableId)) key resolveIntent and eviction share', () => {
    const source = readFileSync(fileURLToPath(new URL('../../src/ingestion/pipeline.ts', import.meta.url)), 'utf8');
    // Anchored on `set local lock_timeout`, not the (non-unique -- pipeline.ts
    // has an EARLIER, unrelated `if (rebaselined)` branch above this one, for
    // label mapping) `if (rebaselined)` guard: this string is unique in the
    // file and sits immediately before the lock acquisition it bounds, the
    // TRUE anchor for the assertions below.
    const rebaselineAt = source.indexOf("set local lock_timeout = '180s'");
    expect(rebaselineAt).toBeGreaterThan(-1);
    const lockAt = source.indexOf('pg_advisory_xact_lock(hashtext($1))', rebaselineAt);
    expect(lockAt).toBeGreaterThan(rebaselineAt);
    // Not the _shared variant -- a rebaseline is an EXCLUSIVE writer, same as
    // eviction, and must exclude a concurrent resolveIntent SHARED reader.
    const snippet = source.slice(lockAt, lockAt + 40);
    expect(snippet).not.toContain('pg_advisory_xact_lock_shared');
    // Keyed on `tableId` -- the SAME variable name/column resolveIntent and
    // eviction both key their own acquisition on for the identical table.
    expect(source.slice(lockAt, lockAt + 80)).toContain('[tableId]');
  });
});
