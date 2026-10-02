// Session 153 (#357 step 5): the Dutch → English bridge in the live finder. A Dutch question about a Eurostat
// topic shares no word with Eurostat's English catalogue; when the Dutch searches are not confident, English
// search words (suggestEnglishSearchTerms) are searched as phrases (recallPhrases) and reranked against the
// reader's own question. Hermetic: the CBS + Eurostat catalogue fixtures (scripts/eurostat-finder-recall.ts
// buildFinderDb), stub model clients, a stub rerank.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LlmClient } from '../../src/answer/llm/client.ts';
import { recallPhrases } from '../../src/catalog/recall.ts';
import type { RerankFn } from '../../src/catalog/types.ts';
import type { Db } from '../../src/db/types.ts';
import { buildOnboardingFinder } from '../../src/ingestion/onboarding-finder.ts';
import { buildFinderDb } from '../../scripts/eurostat-finder-recall.ts';

const QUESTION = 'Hoe hoog was de werkloosheid in Duitsland in 2024?';

function termsClient(terms: string[]): LlmClient & { calls: number } {
  return {
    calls: 0,
    async complete() {
      this.calls++;
      return { outputText: JSON.stringify({ terms }), model: 'stub', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
    },
  };
}

/** Confident only on a shortlist that holds a Eurostat dataset — the Dutch searches never do here. */
const rerank: RerankFn = (_query, shortlist) => {
  const eu = shortlist.find((c) => c.tableId.startsWith('eurostat:'));
  return Promise.resolve({
    tableId: (eu ?? shortlist[0]!).tableId,
    confidence: eu !== undefined ? 0.9 : 0.4,
    reading: 'stub',
    alternativeIds: [],
  });
};

describe('the English bridge in the finder (#357 step 5)', () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await buildFinderDb());
  });
  afterAll(async () => {
    await close();
  });

  it('recallPhrases merges per-term phrase searches over Eurostat rows', async () => {
    const shortlist = await recallPhrases(db, ['unemployment', 'labour force']);
    expect(shortlist.some((c) => c.tableId.startsWith('eurostat:') && /unemploy/i.test(c.title))).toBe(true);
    expect(new Set(shortlist.map((c) => c.tableId)).size).toBe(shortlist.length);
  });

  it('a Dutch question the Dutch searches cannot place reaches the Eurostat dataset through English words', async () => {
    const dutch = termsClient(['werkloosheidspercentage']);
    const english = termsClient(['unemployment']);
    const finder = buildOnboardingFinder({
      db,
      userId: randomUUID(),
      rerank,
      recall: { mode: 'any', includeEurostat: false },
      searchTermsClient: dutch,
      englishSearchTermsClient: english,
    });
    const routing = await finder(QUESTION, QUESTION);
    expect(routing?.tableId.startsWith('eurostat:')).toBe(true);
    const picked = (await db.query('select title from cbs_catalog where table_id = $1', [routing!.tableId])).rows[0];
    expect(String(picked?.title)).toMatch(/unemploy/i);
    expect(english.calls).toBe(1);
  });

  it('without the English client (the Eurostat finder off) nothing changes: no extra call, no Eurostat pick', async () => {
    const english = termsClient(['unemployment']);
    const finder = buildOnboardingFinder({
      db,
      userId: randomUUID(),
      rerank,
      recall: { mode: 'any', includeEurostat: false },
      searchTermsClient: termsClient(['werkloosheidspercentage']),
    });
    expect(await finder(QUESTION, QUESTION)).toBeNull();
    expect(english.calls).toBe(0);
  });

  it('no English words → no extra search, null (never a guess)', async () => {
    const finder = buildOnboardingFinder({
      db,
      userId: randomUUID(),
      rerank,
      recall: { mode: 'any', includeEurostat: false },
      englishSearchTermsClient: termsClient([]),
    });
    expect(await finder(QUESTION, QUESTION)).toBeNull();
  });
});
