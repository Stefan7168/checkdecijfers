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
    await ingestCatalog(db, new FixtureSource({}, loadCatalogFixture(FIXTURES_DIR)));
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
