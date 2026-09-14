// The findTable orchestrator: confidence routing, exercised with an injected
// stub rerank so the routing is proven WITHOUT recorded LLM fixtures. Recall is
// the real FTS over the ingested fixture.
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FixtureSource, loadCatalogFixture } from '../../src/cbs-adapter/fixture-source.ts';
import { ingestCatalog } from '../../src/catalog/ingest.ts';
import { findTable, DISCLOSE_LIMIT } from '../../src/catalog/find.ts';
import type { CatalogCandidate, FindTableQuery, RerankFn, RerankResult } from '../../src/catalog/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import type { Db } from '../../src/db/types.ts';
import { CBS_SOURCE_KEY, EUROSTAT_SOURCE_KEY, sourceKeyForTableId } from '../../src/sources/registry.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));

/** Topic-as-question query shorthand — these routing tests carry no distinct
 *  question; the threading itself is pinned in rerank.test.ts + the finder
 *  tests. */
function q(topic: string): FindTableQuery {
  return { topic, question: topic };
}

/** A stub rerank that picks shortlist[0] with a given confidence + alternatives. */
function stubPickFirst(confidence: number, altOffsets: number[] = []): RerankFn {
  return (_query: FindTableQuery, shortlist: CatalogCandidate[]): Promise<RerankResult> =>
    Promise.resolve({
      tableId: shortlist[0].tableId,
      confidence,
      reading: 'stub',
      alternativeIds: altOffsets.map((i) => shortlist[i]?.tableId).filter(Boolean) as string[],
    });
}

describe('findTable routing', () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    await ingestCatalog(db, new FixtureSource({}, loadCatalogFixture(FIXTURES_DIR)), CBS_SOURCE_KEY);
  });
  afterEach(async () => {
    await close();
  });

  it('returns none when recall finds nothing', async () => {
    const outcome = await findTable(db, q('volstrekt onbekend kwark xyzzy'), { rerank: stubPickFirst(0.99) });
    expect(outcome).toEqual({ kind: 'none', reason: 'no_recall' });
  });

  it('returns confident when the pick clears the threshold', async () => {
    const outcome = await findTable(db, q('huizenprijzen'), {
      rerank: stubPickFirst(0.95),
      config: { highConfidence: 0.8 },
    });
    expect(outcome.kind).toBe('confident');
    if (outcome.kind === 'confident') {
      expect(outcome.confidence).toBe(0.95);
      expect(outcome.pick.tableId).toBeDefined();
      expect(outcome.candidates.length).toBeGreaterThan(0);
      // the pick is one of the recalled candidates
      expect(outcome.candidates.some((c) => c.tableId === outcome.pick.tableId)).toBe(true);
    }
  });

  it('discloses (low_confidence) when the pick is below the threshold, pick first then alternatives', async () => {
    const outcome = await findTable(db, q('bijstand'), {
      rerank: stubPickFirst(0.4, [1, 2]),
      config: { highConfidence: 0.8 },
    });
    expect(outcome.kind).toBe('disclose');
    if (outcome.kind === 'disclose') {
      expect(outcome.reason).toBe('low_confidence');
      expect(outcome.candidates.length).toBeGreaterThanOrEqual(1);
      expect(outcome.candidates.length).toBeLessThanOrEqual(DISCLOSE_LIMIT);
    }
  });

  it('a confident pick CARRIES its sanitized alternativeIds (WP27 — the try-next-candidate chain)', async () => {
    const outcome = await findTable(db, q('bijstand'), {
      rerank: stubPickFirst(0.95, [1, 2]),
      config: { highConfidence: 0.8 },
    });
    expect(outcome.kind).toBe('confident');
    if (outcome.kind === 'confident') {
      expect(outcome.alternativeIds).toHaveLength(2);
      // Real shortlist ids, never the pick itself.
      expect(outcome.alternativeIds).not.toContain(outcome.pick.tableId);
      for (const id of outcome.alternativeIds) {
        expect(outcome.candidates.some((c) => c.tableId === id)).toBe(true);
      }
    }
  });

  it('a confident pick with off-allowlist alternatives from a rogue stub → alternatives sanitized out', async () => {
    const rogueAlts: RerankFn = (_query, shortlist) =>
      Promise.resolve({
        tableId: shortlist[0].tableId,
        confidence: 0.95,
        reading: 'stub',
        alternativeIds: ['INVENTED', shortlist[0].tableId, shortlist[1]?.tableId].filter(
          Boolean,
        ) as string[],
      });
    const outcome = await findTable(db, q('bijstand'), { rerank: rogueAlts });
    expect(outcome.kind).toBe('confident');
    if (outcome.kind === 'confident') {
      // The invented id and the pick itself are dropped; the real runner-up stays.
      expect(outcome.alternativeIds).not.toContain('INVENTED');
      expect(outcome.alternativeIds).not.toContain(outcome.pick.tableId);
      expect(outcome.alternativeIds).toHaveLength(1);
    }
  });

  it('treats the threshold as inclusive (confidence == threshold → confident)', async () => {
    const outcome = await findTable(db, q('bijstand'), {
      rerank: stubPickFirst(0.8),
      config: { highConfidence: 0.8 },
    });
    expect(outcome.kind).toBe('confident');
  });

  it('discloses (rerank_error) when the rerank throws', async () => {
    const outcome = await findTable(db, q('bijstand'), {
      rerank: () => Promise.reject(new Error('model exploded')),
    });
    expect(outcome.kind).toBe('disclose');
    if (outcome.kind === 'disclose') expect(outcome.reason).toBe('rerank_error');
  });

  it('discloses (rerank_error) when a stub picks an id not in the shortlist', async () => {
    const rogue: RerankFn = () =>
      Promise.resolve({ tableId: 'NOT_IN_LIST', confidence: 0.99, reading: 'x', alternativeIds: [] });
    const outcome = await findTable(db, q('bijstand'), { rerank: rogue });
    expect(outcome.kind).toBe('disclose');
    if (outcome.kind === 'disclose') expect(outcome.reason).toBe('rerank_error');
  });

  it('caps a disclosure at DISCLOSE_LIMIT even with many alternatives', async () => {
    const outcome = await findTable(db, q('bijstand'), {
      rerank: stubPickFirst(0.1, [1, 2, 3, 4]),
      config: { highConfidence: 0.8 },
      recall: { limit: 20 },
    });
    expect(outcome.kind).toBe('disclose');
    if (outcome.kind === 'disclose') expect(outcome.candidates.length).toBeLessThanOrEqual(DISCLOSE_LIMIT);
  });
});

// WP30c/E1 (ADR 048, Amendment B2/Amendment 3 — the Task 4 "Amendment 3
// test"): the SAME deny gate proven at the recall.ts unit level
// (tests/catalog/recall.test.ts), here exercised through the ACTUAL live
// NL-chat finder entry point (findTable, wired into the chat path via
// buildOnboardingFinder). A synthetic eurostat: candidate is hand-inserted
// (mirroring Task 5's cross-source isolation-test pattern) so this assertion
// cannot pass vacuously — a stub rerank that would confidently PICK it if it
// ever reached Stage 2 proves the guard fires before rerank, not merely that
// nothing matched.
//
// Whole-branch-review correction (found before the PR, see recall.ts's own
// header comment): the deny gate is now UNCONDITIONAL, no
// EUROSTAT_EXPLORER_ENABLED flag at all — that flag also gates the internal
// explorer's own visibility, so tying live-chat exposure to it would have
// meant enabling the explorer (the RUNBOOK's own documented next step) also
// lifting the only protection keeping Eurostat out of live chat. The
// positive control is now a same-content row under a non-eurostat source,
// proving the recall/rerank mechanism genuinely would have picked this exact
// candidate had it not been eurostat-sourced.
describe('findTable — the Eurostat deny gate (WP30c/E1, Amendment B2)', () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    await ingestCatalog(db, new FixtureSource({}, loadCatalogFixture(FIXTURES_DIR)), CBS_SOURCE_KEY);
    // No CBS table competes for this made-up term — a non-empty outcome can
    // only mean the eurostat: candidate reached the shortlist.
    await db.query(
      `insert into cbs_catalog (table_id, title, summary, status, dataset_type, language, refreshed_at, source)
       values ($1, $2, $3, $4, $5, $6, now(), $7)`,
      [
        'eurostat:kwarkexport_test',
        'Kwarkexport kwarkexport kwarkexport',
        'Synthetic Eurostat test row (Amendment B2) — never a real dataset.',
        'Regulier',
        'Numeric',
        'nl',
        EUROSTAT_SOURCE_KEY,
      ],
    );
  });
  afterEach(async () => {
    await close();
  });

  it('an eurostat: candidate is NEVER reachable, unconditionally, even to a rerank that would confidently pick it', async () => {
    const outcome = await findTable(db, q('kwarkexport'), { rerank: stubPickFirst(0.99) });
    // Nothing reached the shortlist at all (no CBS competitor for this term).
    expect(outcome).toEqual({ kind: 'none', reason: 'no_recall' });
  });

  it('the SAME title, under a non-eurostat source, IS reachable and confidently picked — proving the mechanism genuinely matches this content, so the exclusion above is the deny gate working, not a query that never matched', async () => {
    await db.query(
      `insert into cbs_catalog (table_id, title, summary, status, dataset_type, language, refreshed_at, source)
       values ($1, $2, $3, $4, $5, $6, now(), $7)`,
      [
        'CBS_KWARKEXPORT_TEST',
        'Kwarkexport kwarkexport kwarkexport (CBS)',
        'Control row — a non-eurostat source, same content shape.',
        'Regulier',
        'Numeric',
        'nl',
        CBS_SOURCE_KEY,
      ],
    );
    const outcome = await findTable(db, q('kwarkexport'), { rerank: stubPickFirst(0.99) });
    expect(outcome.kind).toBe('confident');
    if (outcome.kind === 'confident') {
      expect(outcome.pick.tableId).toBe('CBS_KWARKEXPORT_TEST');
      expect(sourceKeyForTableId(outcome.pick.tableId)).toBe(CBS_SOURCE_KEY);
    }
  });

});
