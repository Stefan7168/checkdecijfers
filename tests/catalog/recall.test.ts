// Stage-1 recall: hermetic FTS over the real catalog fixture, plus the
// principle-(c) exclusions (Text-type, non-nl) proven with synthetic rows.
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixtureSource, loadCatalogFixture } from '../../src/cbs-adapter/fixture-source.ts';
import { ingestCatalog } from '../../src/catalog/ingest.ts';
import {
  recallCandidates,
  RECALL_HISTORIC_SLOTS,
  RECALL_LIMIT,
  RECALL_REGULIER_SLOTS,
} from '../../src/catalog/recall.ts';
import { expandTopicTerms, ALIAS_HINTS } from '../../src/catalog/aliases.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import { resetTestDb } from '../helpers/reset-db.ts';
import type { Db } from '../../src/db/types.ts';
import { CBS_SOURCE_KEY, EUROSTAT_SOURCE_KEY } from '../../src/sources/registry.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));

async function insertRow(
  db: Db,
  row: {
    id: string;
    title: string;
    summary?: string;
    type?: string;
    lang?: string;
    status?: string;
    /** WP30c/E1 (Amendment B2): defaults to 'cbs', matching migration 016's
     *  own column default — only the deny-gate test below overrides it. */
    source?: string;
  },
): Promise<void> {
  await db.query(
    `insert into cbs_catalog (table_id, title, summary, status, dataset_type, language, refreshed_at, source)
     values ($1, $2, $3, $4, $5, $6, now(), $7)`,
    [
      row.id,
      row.title,
      row.summary ?? '',
      row.status ?? 'Regulier',
      row.type ?? 'Numeric',
      row.lang ?? 'nl',
      row.source ?? CBS_SOURCE_KEY,
    ],
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

  // Perf (#245 Action 3, session 110): boots ONE PGlite instance for the
  // whole describe instead of once per test; the fixture ingest re-runs
  // after every TRUNCATE reset (beforeEach).
  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });
  afterAll(async () => {
    await close();
  });
  beforeEach(async () => {
    await resetTestDb(db);
    await ingestCatalog(db, new FixtureSource({}, loadCatalogFixture(FIXTURES_DIR)), CBS_SOURCE_KEY);
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

// WP27 amendment A2 (owner-approved 2026-07-08): Regulier-first shortlist
// quotas. MEASURED driver on the live 4,858-row mirror: the raw "bijstand"
// top-20 held 14 discontinued tables and the only v1-deliverable table
// (37789ksz) sat at overall position 51 — Stage 2 can only choose among what
// Stage 1 shows. Synthetic rows pin the quota mechanics exactly.
describe('recallCandidates — Regulier-first quota (WP27 A2)', () => {
  let db: Db;
  let close: () => Promise<void>;

  // Perf (#245 Action 3, session 110): boots ONE PGlite instance for the
  // whole describe; the synthetic-row setup re-runs after every TRUNCATE
  // reset (beforeEach), same as before the reset was a full boot.
  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });
  afterAll(async () => {
    await close();
  });
  beforeEach(async () => {
    await resetTestDb(db);
    // NO fixture catalog: fully synthetic, so counts are exact. Discontinued
    // rows repeat the term (higher FTS rank); Regulier rows mention it once —
    // the crowding shape measured live.
    for (let i = 1; i <= 30; i++) {
      await insertRow(db, {
        id: `HIST${String(i).padStart(2, '0')}`,
        title: `Kwarkstat kwarkstat kwarkstat, reeks ${i}`,
        summary: 'Oude kwarkstat cijfers, kwarkstat.',
        status: 'Gediscontinueerd',
      });
    }
    for (let i = 1; i <= 25; i++) {
      await insertRow(db, {
        id: `REG${String(i).padStart(2, '0')}`,
        title: `Sociale reeks ${i}`,
        summary: `Bevat ook kwarkstat cijfers.`,
        status: 'Regulier',
      });
    }
  });

  it('fills the default shortlist with the Regulier quota + the historic slots', async () => {
    const got = await recallCandidates(db, 'kwarkstat');
    expect(got).toHaveLength(RECALL_LIMIT);
    const regulier = got.filter((c) => c.status === 'Regulier');
    const historic = got.filter((c) => c.status !== 'Regulier');
    // 25 Regulier match but only the quota enters; the historic slots survive
    // even though EVERY discontinued row outranks EVERY Regulier row.
    expect(regulier).toHaveLength(RECALL_REGULIER_SLOTS);
    expect(historic).toHaveLength(RECALL_HISTORIC_SLOTS);
  });

  it('low-ranked Regulier tables beat higher-ranked discontinued ones for shortlist MEMBERSHIP', async () => {
    const got = await recallCandidates(db, 'kwarkstat');
    // The live 37789ksz shape: without the quota, zero REG rows would enter
    // (all 30 HIST rows rank higher).
    expect(got.filter((c) => c.tableId.startsWith('REG')).length).toBe(RECALL_REGULIER_SLOTS);
  });

  it('keeps pure relevance ORDER within the merged shortlist (strongest matches lead)', async () => {
    const got = await recallCandidates(db, 'kwarkstat');
    for (let i = 1; i < got.length; i++) {
      expect(got[i - 1].rank).toBeGreaterThanOrEqual(got[i].rank);
    }
    // With historic rows ranking highest, the shortlist LEADS with them — the
    // quota decides membership, not order (the rerank prompt judges status).
    expect(got[0].tableId.startsWith('HIST')).toBe(true);
  });

  it('unused historic slots go to Regulier rows (few historic matches)', async () => {
    await db.query(`delete from cbs_catalog where table_id like 'HIST%' and table_id > 'HIST02'`);
    const got = await recallCandidates(db, 'kwarkstat');
    expect(got).toHaveLength(RECALL_LIMIT);
    expect(got.filter((c) => c.status !== 'Regulier')).toHaveLength(2);
    expect(got.filter((c) => c.status === 'Regulier')).toHaveLength(RECALL_LIMIT - 2);
  });

  it('unused Regulier slots go to historic rows (few Regulier matches) — todays behavior preserved', async () => {
    await db.query(`delete from cbs_catalog where table_id like 'REG%' and table_id > 'REG03'`);
    const got = await recallCandidates(db, 'kwarkstat');
    expect(got).toHaveLength(RECALL_LIMIT);
    expect(got.filter((c) => c.status === 'Regulier')).toHaveLength(3);
    expect(got.filter((c) => c.status !== 'Regulier')).toHaveLength(RECALL_LIMIT - 3);
  });

  it('a small custom limit degrades to plain Regulier-first fill (no reserve)', async () => {
    const got = await recallCandidates(db, 'kwarkstat', { limit: 5 });
    expect(got).toHaveLength(5);
    // limit ≤ the Regulier quota → no historic reserve; all slots Regulier.
    expect(got.every((c) => c.status === 'Regulier')).toBe(true);
  });
});

// WP30c/E1 (ADR 048, Amendment B2 — the Task 4 "Amendment 3 test"): the deny
// gate keeping an unannounced source (Eurostat, D3) off the live NL chat
// finder/query path. As originally scoped this assertion could pass
// VACUOUSLY — E1 registers zero real Eurostat tables (Task 7's own honest
// empty state), so with nothing eurostat:-prefixed in cbs_catalog at all, "no
// eurostat result is ever returned" would be true regardless of whether the
// guard code exists. The fix (per Amendment B2, as ORIGINALLY built): hand-
// insert a synthetic eurostat: candidate that would otherwise be a STRONG
// match, then prove both a negative case and a positive control.
//
// Whole-branch-review correction (found before the PR, see recall.ts's own
// header comment): the positive control originally toggled
// EUROSTAT_EXPLORER_ENABLED to show the SAME candidate become reachable —
// but that made the internal explorer's own visibility flag double as the
// only thing protecting live chat from an unannounced source, so enabling
// the explorer (the RUNBOOK's own documented next step) would ALSO have
// lifted this deny gate. The filter is now UNCONDITIONAL, no flag at all.
// The positive control is now the search mechanism itself: an
// otherwise-identical row registered under a non-eurostat source (the third
// test below) proves the query WOULD match this exact content — so the
// first test's empty result is the filter actively working, not the
// search failing to match anything in the first place.
describe('recallCandidates — the Eurostat deny gate (WP30c/E1, Amendment B2)', () => {
  let db: Db;
  let close: () => Promise<void>;

  // Perf (#245 Action 3, session 110): boots ONE PGlite instance for the
  // whole describe; the synthetic-row setup re-runs after every TRUNCATE
  // reset (beforeEach).
  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });
  afterAll(async () => {
    await close();
  });
  beforeEach(async () => {
    await resetTestDb(db);
    // A strong, unambiguous match for 'kwarkproductie' — no CBS row competes
    // for this term, so a non-empty shortlist can ONLY mean the eurostat row
    // got through.
    await insertRow(db, {
      id: 'eurostat:kwarkproductie_test',
      title: 'Kwarkproductie kwarkproductie kwarkproductie',
      summary: 'Synthetic Eurostat test row (Amendment B2) — never a real dataset.',
      source: EUROSTAT_SOURCE_KEY,
    });
  });

  it('an eurostat: candidate is NEVER recalled, unconditionally, even though it is the only match for the term', async () => {
    const got = await recallCandidates(db, 'kwarkproductie', { limit: 10 });
    expect(got).toEqual([]);
    expect(got.some((c) => c.tableId === 'eurostat:kwarkproductie_test')).toBe(false);
  });

  it('the gate never touches a CBS candidate for the same term (no over-filtering), and the same title IS recalled under a non-eurostat source — proving the search mechanism genuinely matches this content, so the eurostat exclusion above is the filter working, not a query that never matched', async () => {
    await insertRow(db, {
      id: 'CBS_KWARK_TEST',
      title: 'Kwarkproductie kwarkproductie kwarkproductie (CBS)',
      source: CBS_SOURCE_KEY,
    });
    const got = await recallCandidates(db, 'kwarkproductie', { limit: 10 });
    expect(got.some((c) => c.tableId === 'CBS_KWARK_TEST')).toBe(true);
    expect(got.some((c) => c.tableId === 'eurostat:kwarkproductie_test')).toBe(false);
  });
});
