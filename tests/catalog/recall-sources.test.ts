// Owner decision 2026-10-04 (the Eurostat chip): the reader's source choice narrows the table search.
// `RecallOptions.sources` is a restriction applied INSIDE the query (so the per-class quota is spent on the
// sources in play, never starved by rows dropped afterwards) and it only ever narrows: Eurostat rows still
// need the finder flag or an explicit includeEurostat. Hermetic: synthetic catalogue rows in PGlite.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { recallCandidates, recallPhrases } from '../../src/catalog/recall.ts';
import type { Db } from '../../src/db/types.ts';
import { CBS_SOURCE_KEY, EUROSTAT_SOURCE_KEY } from '../../src/sources/registry.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import { resetTestDb } from '../helpers/reset-db.ts';

async function insertRow(
  db: Db,
  row: { id: string; title: string; lang?: string; status?: string; source?: string },
): Promise<void> {
  await db.query(
    `insert into cbs_catalog (table_id, title, summary, status, dataset_type, language, refreshed_at, source)
     values ($1, $2, '', $3, 'Numeric', $4, now(), $5)`,
    [row.id, row.title, row.status ?? 'Regulier', row.lang ?? 'nl', row.source ?? CBS_SOURCE_KEY],
  );
}

describe("recallCandidates — the reader's source choice (RecallOptions.sources)", () => {
  let db: Db;
  let close: () => Promise<void>;
  const CBS_ONLY = new Set([CBS_SOURCE_KEY]);
  const EUROSTAT_ONLY = new Set([EUROSTAT_SOURCE_KEY]);
  const BOTH = new Set([CBS_SOURCE_KEY, EUROSTAT_SOURCE_KEY]);
  const savedFlag = process.env.EUROSTAT_FINDER_ENABLED;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });
  afterAll(async () => {
    await close();
  });
  afterEach(() => {
    if (savedFlag === undefined) delete process.env.EUROSTAT_FINDER_ENABLED;
    else process.env.EUROSTAT_FINDER_ENABLED = savedFlag;
  });
  beforeEach(async () => {
    delete process.env.EUROSTAT_FINDER_ENABLED;
    await resetTestDb(db);
    await insertRow(db, { id: 'CBS_KWARK', title: 'Kwarkproductie kwarkproductie (CBS)' });
    await insertRow(db, {
      id: 'eurostat:kwark_test',
      title: 'Kwarkproductie kwarkproductie (Eurostat)',
      lang: 'en',
      status: 'current',
      source: EUROSTAT_SOURCE_KEY,
    });
  });

  const ids = (got: { tableId: string }[]): string[] => got.map((c) => c.tableId).sort();

  for (const mode of ['all', 'any'] as const) {
    describe(`mode ${mode}`, () => {
      const topic = mode === 'all' ? 'kwarkproductie' : 'Hoeveel kwarkproductie is er?';

      it('no restriction: both sources, exactly as before the chip', async () => {
        expect(ids(await recallCandidates(db, topic, { mode, includeEurostat: true }))).toEqual([
          'CBS_KWARK',
          'eurostat:kwark_test',
        ]);
        expect(ids(await recallCandidates(db, topic, { mode, includeEurostat: true, sources: BOTH }))).toEqual([
          'CBS_KWARK',
          'eurostat:kwark_test',
        ]);
      });

      it('CBS only: no Eurostat row, even with the Eurostat finder open', async () => {
        process.env.EUROSTAT_FINDER_ENABLED = '1';
        expect(ids(await recallCandidates(db, topic, { mode, sources: CBS_ONLY }))).toEqual(['CBS_KWARK']);
        expect(ids(await recallCandidates(db, topic, { mode, includeEurostat: true, sources: CBS_ONLY }))).toEqual([
          'CBS_KWARK',
        ]);
      });

      it('Eurostat only: no CBS row', async () => {
        expect(
          ids(await recallCandidates(db, topic, { mode, includeEurostat: true, sources: EUROSTAT_ONLY })),
        ).toEqual(['eurostat:kwark_test']);
        process.env.EUROSTAT_FINDER_ENABLED = '1';
        expect(ids(await recallCandidates(db, topic, { mode, sources: EUROSTAT_ONLY }))).toEqual([
          'eurostat:kwark_test',
        ]);
      });

      it('a restriction only narrows: Eurostat chosen but the finder closed finds nothing', async () => {
        expect(await recallCandidates(db, topic, { mode, sources: EUROSTAT_ONLY })).toEqual([]);
      });

      it('an empty restriction finds nothing', async () => {
        expect(await recallCandidates(db, topic, { mode, includeEurostat: true, sources: new Set() })).toEqual([]);
      });

      it('the restriction is applied inside the query: many stronger CBS rows cannot starve the Eurostat shortlist', async () => {
        for (let i = 0; i < 12; i++) {
          await insertRow(db, {
            id: `CBS_KWARK_${i}`,
            title: `Kwarkproductie kwarkproductie kwarkproductie kwarkproductie ${i}`,
          });
        }
        const got = await recallCandidates(db, topic, {
          mode,
          includeEurostat: true,
          sources: EUROSTAT_ONLY,
          limit: 3,
        });
        expect(ids(got)).toEqual(['eurostat:kwark_test']);
      });
    });
  }

  it('recallPhrases (which forces the Eurostat gate open) still honours the restriction', async () => {
    expect(ids(await recallPhrases(db, ['kwarkproductie']))).toEqual(['CBS_KWARK', 'eurostat:kwark_test']);
    expect(ids(await recallPhrases(db, ['kwarkproductie'], { sources: CBS_ONLY }))).toEqual(['CBS_KWARK']);
    expect(ids(await recallPhrases(db, ['kwarkproductie'], { sources: EUROSTAT_ONLY }))).toEqual([
      'eurostat:kwark_test',
    ]);
  });
});
