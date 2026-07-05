// Stage-1 recall: hermetic FTS over the real catalog fixture, plus the
// principle-(c) exclusions (Text-type, non-nl) proven with synthetic rows.
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FixtureSource, loadCatalogFixture } from '../../src/cbs-adapter/fixture-source.ts';
import { ingestCatalog } from '../../src/catalog/ingest.ts';
import { recallCandidates } from '../../src/catalog/recall.ts';
import { expandTopicTerms, ALIAS_HINTS } from '../../src/catalog/aliases.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import type { Db } from '../../src/db/types.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));

async function insertRow(
  db: Db,
  row: { id: string; title: string; summary?: string; type?: string; lang?: string; status?: string },
): Promise<void> {
  await db.query(
    `insert into cbs_catalog (table_id, title, summary, status, dataset_type, language, refreshed_at)
     values ($1, $2, $3, $4, $5, $6, now())`,
    [row.id, row.title, row.summary ?? '', row.status ?? 'Regulier', row.type ?? 'Numeric', row.lang ?? 'nl'],
  );
}

describe('expandTopicTerms (alias hints)', () => {
  it('includes the raw topic plus alias expansions when a trigger fires', () => {
    const terms = expandTopicTerms('bijstand', ALIAS_HINTS);
    expect(terms).toContain('bijstand');
    expect(terms).toContain('participatiewet');
  });

  it('bridges colloquial → official (zonnepanelen → zonnestroom, huizenprijzen → koopwoningen)', () => {
    expect(expandTopicTerms('zonnepanelen')).toContain('zonnestroom');
    expect(expandTopicTerms('huizenprijzen')).toContain('koopwoningen');
  });

  it('bridges population + housing-stock phrasings (session-25 measured gaps)', () => {
    // "hoeveel inwoners heeft nederland" → the CBS "Bevolking" vocabulary.
    expect(expandTopicTerms('hoeveel inwoners heeft nederland')).toContain('bevolking');
    // "aantal woningen" → the housing STOCK vocabulary (distinct from prices).
    expect(expandTopicTerms('aantal woningen in nederland')).toContain('voorraad woningen');
  });

  it('returns just the topic when no hint fires', () => {
    // 'schoenmaat' maps to nothing (mirrors the labelled-set "onbekend" case).
    expect(expandTopicTerms('schoenmaat')).toEqual(['schoenmaat']);
  });
});

describe('recallCandidates', () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    await ingestCatalog(db, new FixtureSource({}, loadCatalogFixture(FIXTURES_DIR)));
  });
  afterEach(async () => {
    await close();
  });

  it('recalls on-topic tables for "bijstand", ranked, all numeric', async () => {
    const got = await recallCandidates(db, 'bijstand', { limit: 5 });
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((c) => /bijstand/i.test(`${c.title} ${c.summary}`))).toBe(true);
    expect(got.every((c) => c.datasetType !== 'Text')).toBe(true);
    // ranked descending
    for (let i = 1; i < got.length; i++) expect(got[i - 1].rank).toBeGreaterThanOrEqual(got[i].rank);
  });

  it('finds the house-price table via the huizenprijzen → koopwoningen alias', async () => {
    const got = await recallCandidates(db, 'huizenprijzen', { limit: 10 });
    expect(got.some((c) => c.tableId === '85773NED')).toBe(true);
  });

  it('finds the Bevolking table for a plain "hoeveel inwoners" question (session-25 gap)', async () => {
    // Without the alias this AND-ed common words to zero recall; the OR-ed
    // "bevolking" term now surfaces 03759ned.
    const got = await recallCandidates(db, 'hoeveel inwoners heeft nederland', { limit: 20 });
    expect(got.some((c) => c.tableId === '03759ned')).toBe(true);
  });

  it('finds the housing-STOCK table (not just price tables) for "aantal woningen" (session-25 gap)', async () => {
    const got = await recallCandidates(db, 'aantal woningen in nederland', { limit: 20 });
    expect(got.some((c) => c.tableId === '82235NED')).toBe(true);
  });

  it('respects the shortlist limit', async () => {
    const got = await recallCandidates(db, 'bijstand', { limit: 2 });
    expect(got.length).toBeLessThanOrEqual(2);
  });

  it('excludes Text-type tables even on a strong keyword match (principle c)', async () => {
    await insertRow(db, {
      id: 'TXT1',
      title: 'Bijstand toelichting',
      summary: 'Uitgebreide bijstand tekst zonder cijfers',
      type: 'Text',
    });
    const got = await recallCandidates(db, 'bijstand', { limit: 30 });
    expect(got.some((c) => c.tableId === 'TXT1')).toBe(false);
  });

  it('excludes non-nl tables', async () => {
    await insertRow(db, { id: 'EN1', title: 'Social assistance bijstand', lang: 'en' });
    const got = await recallCandidates(db, 'bijstand', { limit: 30 });
    expect(got.some((c) => c.tableId === 'EN1')).toBe(false);
  });

  it('returns an empty shortlist for a topic absent from the catalog', async () => {
    expect(await recallCandidates(db, 'volstrekt onbekend kwark xyzzy', { limit: 10 })).toEqual([]);
  });

  it('returns an empty shortlist for an all-stopword / empty topic', async () => {
    expect(await recallCandidates(db, '   ', { limit: 10 })).toEqual([]);
  });
});
