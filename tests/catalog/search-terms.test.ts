// The front door's meaning step (session 153, #362): output validation and
// the "a failure is never a pick" contract. No model call — stub clients only.
import { describe, expect, it } from 'vitest';
import {
  SEARCH_TERMS_MAX,
  buildEnglishSearchTermsRequest,
  buildSearchTermsRequest,
  suggestEnglishSearchTerms,
  suggestSearchTerms,
  validateSearchTerms,
} from '../../src/catalog/search-terms.ts';
import type { LlmClient, LlmRequest, LlmResponse } from '../../src/answer/llm/client.ts';

function stub(outputText: string | Error): LlmClient & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    calls,
    async complete(request: LlmRequest): Promise<LlmResponse> {
      calls.push(request);
      if (outputText instanceof Error) throw outputText;
      return { outputText, model: 'stub', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
    },
  };
}

describe('validateSearchTerms', () => {
  it('keeps plain words and phrases, lower-cased, deduplicated', () => {
    expect(validateSearchTerms('{"terms":["Huwelijkssluitingen","huwelijkssluitingen"," partnerschappen ","huishoudelijk afval"]}')).toEqual([
      'huwelijkssluitingen',
      'partnerschappen',
      'huishoudelijk afval',
    ]);
  });

  it('drops anything that is not a plain word: numbers, codes, query syntax, over-long strings', () => {
    expect(validateSearchTerms(`{"terms":["2023","85245NED","sloop & export","a:*","${'x'.repeat(41)}","overgewicht"]}`)).toEqual([
      'overgewicht',
    ]);
  });

  it(`caps at ${SEARCH_TERMS_MAX} terms; malformed output → []`, () => {
    expect(validateSearchTerms(`{"terms":${JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((x) => `woord${x}`))}}`)).toHaveLength(SEARCH_TERMS_MAX);
    expect(validateSearchTerms('not json')).toEqual([]);
    expect(validateSearchTerms('{"terms":"overgewicht"}')).toEqual([]);
  });
});

describe('suggestSearchTerms', () => {
  it('sends the question as the user turn on the cheap tier, and returns the validated terms', async () => {
    const client = stub('{"terms":["overgewicht"]}');
    expect(await suggestSearchTerms('Hoeveel procent is te zwaar?', client)).toEqual(['overgewicht']);
    expect(client.calls[0]!.question).toBe('Hoeveel procent is te zwaar?');
    expect(client.calls[0]!.model).toBe(buildSearchTermsRequest('x').model);
  });

  it('a failing call is [] (never a pick)', async () => {
    expect(await suggestSearchTerms('vraag', stub(new Error('network down')))).toEqual([]);
  });
});

describe('the Dutch → English bridge for Eurostat (session 153, #357 step 3)', () => {
  it('is a SEPARATE prompt: the Dutch request is unchanged, the English one differs only in its system prompt', () => {
    const nl = buildSearchTermsRequest('Hoe hoog is de staatsschuld?');
    const en = buildEnglishSearchTermsRequest('Hoe hoog is de staatsschuld?');
    expect(en.system).not.toBe(nl.system);
    expect({ ...en, system: nl.system }).toEqual(nl);
    expect(en.system).toContain('Eurostat');
  });

  it("never teaches to the labelled set: none of its Dutch topics appear as an example", () => {
    const system = buildEnglishSearchTermsRequest('x').system;
    for (const topic of ['werkloosheid', 'inflatie', 'bbp', 'asielaanvragen', 'huizenprijzen', 'minimumloon', 'levensverwachting', 'staatsschuld', 'broeikasgassen']) {
      expect(system.toLowerCase()).not.toContain(topic);
    }
  });

  it('returns validated English terms; a failing call is []', async () => {
    expect(await suggestEnglishSearchTerms('vraag', stub('{"terms":["Government debt"]}'))).toEqual(['government debt']);
    expect(await suggestEnglishSearchTerms('vraag', stub(new Error('down')))).toEqual([]);
  });
});

