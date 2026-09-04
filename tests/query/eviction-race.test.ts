// #196 (session 72): a concurrent eviction must never turn into a false "no
// data"/"not published" refusal for a live read of the exact table it is
// evicting. Reproduced deterministically with `withEvictionRace`
// (tests/helpers/eviction-race.ts — its header has the full technique and
// what it cannot prove under single-connection PGlite); this file covers
// run.ts's read arc (resolveIntent has already returned by the time any race
// here lands). The structural follow-up — the SAME eviction racing
// resolveIntent's OWN reads, one step earlier — is
// tests/query/resolve-eviction-race.test.ts, reusing this exact helper.
//
// Four cases (session 73 review of PR #121 added the last two):
//  - the eviction commits BEFORE the fetch runs → the fetch sees nothing →
//    run.ts must recognize "table evicted mid-flight" and refuse with
//    `table_evicted`, NEVER `no_data`/`not_published`/`freshness`/
//    `table_not_registered` (a data gap it is not; an anomaly it is not).
//  - the eviction commits AFTER the fetch already captured the real rows →
//    the in-flight read must not be disturbed retroactively: the answer
//    still serves (`ok: true`) with the real cell values, the real period
//    LABELS (they ride the fetch — no later dimension_labels read to empty)
//    and the same attribution date. A regression pin: the old ordering served
//    the values too — but with raw period codes for labels.
//  - the eviction commits INSIDE diagnoseMissing, after its dimension_labels
//    check and before its later reads (the TOCTOU the session-72 guard left
//    open: it checked registration BEFORE the diagnosis) → still
//    `table_evicted`, because the check now runs LAST on the one branch a
//    fully evicted table can reach.
//  - a served turn issues NO read after the fetch (labels and retained-batch
//    dates ride the fetch): the only later statement is the bookkeeping touch.
import { describe, expect, it } from 'vitest';
import { runQuery } from '../../src/query/index.ts';
import type { Db, QueryResultRow } from '../../src/db/types.ts';
import { createIngestedDb, tableIdForCanonicalKey } from '../helpers/ingested-db.ts';
import { ANSWERABLE_TASKS } from '../helpers/benchmark-intents.ts';
import { withEvictionRace } from '../helpers/eviction-race.ts';

const B1 = ANSWERABLE_TASKS.B1!; // population_on_1_january, NL01, 2025 — single coordinate
/** A fragment unique to runQuery's observations fetch (src/query/run.ts): the
 * `any($4::text[])` region filter. NOT 'from observations' — resolveIntent's
 * answer-first lookup (resolve.ts) and diagnoseMissing's reads contain that
 * too, so a race armed on it could fire in the wrong place. */
const FETCH = 'region_code = any(';
/** diagnoseMissing's dimension_labels "is this period published" check — the
 * statement the TOCTOU case arms on (its `code = $3` is unique to it). */
const PUBLISHED_CHECK = 'and code = $3';

describe('#196 — an eviction racing a live read', () => {
  it('commits BEFORE the fetch: an honest table_evicted refusal, never no_data/not_published/freshness/table_not_registered', async () => {
    const { db, close } = await createIngestedDb();
    try {
      if (B1.intent.target.kind !== 'canonical') throw new Error('expected a canonical target');
      const tableId = await tableIdForCanonicalKey(db, B1.intent.target.key);

      const raced = withEvictionRace(db, tableId, 'before', FETCH);
      const outcome = await runQuery(raced, B1.intent);

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.refusal.kind).toBe('table_evicted');
      expect(outcome.refusal.kind).not.toBe('table_not_registered');
      expect(outcome.refusal.kind).not.toBe('no_data');
      expect(outcome.refusal.kind).not.toBe('not_published');
      expect(outcome.refusal.kind).not.toBe('freshness');
      expect(outcome.refusal.message).toContain('evicted while this query was in flight');
      expect(outcome.refusal.message).toContain(tableId);
    } finally {
      await close();
    }
  });

  it('commits AFTER the fetch already captured the real rows: the answer still serves with the real cells', async () => {
    const { db, close } = await createIngestedDb();
    try {
      if (B1.intent.target.kind !== 'canonical') throw new Error('expected a canonical target');
      const tableId = await tableIdForCanonicalKey(db, B1.intent.target.key);

      // Baseline against the SAME, not-yet-mutated database — what an
      // unraced read of this exact intent actually returns.
      const expected = await runQuery(db, B1.intent);
      if (!expected.ok) throw new Error(`fixture intent did not serve: ${expected.refusal.kind}`);

      const raced = withEvictionRace(db, tableId, 'after', FETCH);
      const outcome = await runQuery(raced, B1.intent);

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('unreachable');
      // The values already captured by the fetch — the R1 traceability
      // handle and the actual figure — survive an eviction landing right
      // after, untouched (the byCoordinate map is in-memory by that point).
      const surface = (r: typeof expected) =>
        r.cells.map((c) => ({ resultId: c.resultId, value: c.value, unit: c.unit, periodLabel: c.periodLabel }));
      expect(surface(outcome)).toEqual(surface(expected));
      // The label is a real label, not the raw code the old post-fetch
      // dimension_labels read fell back to once the table was gone.
      for (const cell of outcome.cells) expect(cell.periodLabel).not.toBe(cell.periodCode);
      expect(outcome.attribution.syncedAt).toBe(expected.attribution.syncedAt);
    } finally {
      await close();
    }
  });

  it('commits INSIDE diagnoseMissing (after its published check): still table_evicted, never not_published', async () => {
    const { db, close } = await createIngestedDb();
    try {
      if (B1.intent.target.kind !== 'canonical') throw new Error('expected a canonical target');
      const tableId = await tableIdForCanonicalKey(db, B1.intent.target.key);
      // A quarter of a yearly table: the fetch finds nothing, fetchFreshness
      // finds nothing at that grain (no freshness branch), the period is not in
      // dimension_labels (no no_data branch) — the not_published branch, the
      // only one a fully evicted table can reach. Unraced it IS not_published.
      const quarterly = { ...B1.intent, period: { kind: 'codes' as const, codes: ['2024KW01'] } };
      const unraced = await runQuery(db, quarterly);
      expect(unraced.ok).toBe(false);
      if (unraced.ok) throw new Error('unreachable');
      expect(unraced.refusal.kind).toBe('not_published');

      // The eviction lands right after the published check, before the grains
      // and earliest-period reads — inside the window the session-72 guard
      // (registration checked BEFORE diagnoseMissing) could not see.
      const raced = withEvictionRace(db, tableId, 'after', PUBLISHED_CHECK);
      const outcome = await runQuery(raced, quarterly);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.refusal.kind).toBe('table_evicted');
      expect(outcome.refusal.message).toContain('evicted while this query was in flight');
    } finally {
      await close();
    }
  });

  it('a served turn reads nothing after the fetch — labels and retained-batch dates ride the fetch; only the touch follows', async () => {
    const { db, close } = await createIngestedDb();
    try {
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
      const fetchAt = statements.findIndex((s) => s.includes(FETCH));
      expect(fetchAt).toBeGreaterThan(-1);
      const fetch = statements[fetchAt]!;
      expect(fetch).toContain('left join dimension_labels');
      expect(fetch).toContain('left join ingestion_batches');
      const after = statements.slice(fetchAt + 1);
      expect(after).toHaveLength(1);
      expect(after[0]).toContain('set last_queried_at');
    } finally {
      await close();
    }
  });
});
