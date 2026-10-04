// Owner decision 2026-10-04 (the Eurostat chip): the reader's source choice at the answer pipeline.
//   * The pre-parse belt refuses when NO data source is selected (neither CBS nor Eurostat), web-only text
//     naming the official sources neutrally.
//   * CBS off, Eurostat on: the curated path must never answer. A curated intent or clarification is routed
//     through the Eurostat-only whole-question finder (a confident pick -> the finder's onboarding
//     outcome; no pick / no finder -> the no_eurostat_table refusal). Non-data outcomes pass through.
//   * Every other selection (and no selection) behaves exactly as before.
// Hermetic: fixture-ingested PGlite + canned parses + stub finders. No LLM, no network.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import {
  buildNoEurostatTableRefusal,
  buildWebOnlyRefusal,
  respondToClarificationReply,
  respondToQuestion,
  RESPONSE_SCHEMA_VERSION,
} from '../../src/answer/respond/index.ts';
import type { PendingClarification } from '../../src/answer/respond/index.ts';
import { eurostatOnlyOverride, isEurostatOnly, memoizeFinder } from '../../src/answer/respond/source-override.ts';
import type { OnboardingRouting, TableFinder } from '../../src/answer/intent/policy.ts';
import type { LlmClient, LlmResponse } from '../../src/answer/llm/client.ts';
import type { ParseOutcome, RawParse } from '../../src/answer/intent/types.ts';
import { numbersInText } from '../../src/answer/compose/format.ts';

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

const REFERENCE_DATE = '2026-08-15';

class CannedClient implements LlmClient {
  private readonly raw: RawParse;
  calls = 0;
  constructor(raw: RawParse) {
    this.raw = raw;
  }
  async complete(): Promise<LlmResponse> {
    this.calls += 1;
    return {
      outputText: JSON.stringify(this.raw),
      model: 'stub',
      stopReason: 'end_turn',
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}

class ThrowingClient implements LlmClient {
  async complete(): Promise<LlmResponse> {
    throw new Error('the answer client must not be reached');
  }
}

/** A confident, fully specified curated reading: inhabitants of Amsterdam in 2024. */
function curatedIntent(): RawParse {
  return {
    version: 4,
    kind: 'data_query',
    candidates: [
      {
        canonicalKey: 'population_on_1_january',
        regions: [{ name: 'Amsterdam', kind: 'gemeente' }],
        regionScope: null,
        period: { kind: 'year', year: 2024 },
        derivation: 'none',
        confidence: 0.95,
        reading: 'bevolking van Amsterdam in 2024',
      },
    ] as never,
    unmatchedMeasureTerm: null,
    nearestCanonicalKeys: [],
    note: null,
  };
}

/** A topic no curated measure matches -> the unmatched exit (the B15 clarification without a finder). */
function unmatchedTopic(): RawParse {
  return {
    version: 4,
    kind: 'data_query',
    candidates: [],
    unmatchedMeasureTerm: 'kwarkproductie',
    nearestCanonicalKeys: [],
    note: null,
  };
}

function noData(kind: RawParse['kind']): RawParse {
  return { version: 4, kind, candidates: [], unmatchedMeasureTerm: null, nearestCanonicalKeys: [], note: null };
}

const BOTH = { sources: ['cbs', 'eurostat'], web: false };
const CBS_ONLY = { sources: ['cbs'], web: false };
const EUROSTAT_ONLY = { sources: ['eurostat'], web: false };

const eurostatPick = (calls: { term: string; question: string }[]): TableFinder => async (term, question) => {
  calls.push({ term, question });
  return {
    tableId: 'eurostat:une_rt_m',
    topicTerm: term,
    confidence: 0.92,
    alreadyPending: false,
    candidateIds: ['eurostat:une_rt_m'],
  } satisfies OnboardingRouting;
};

const noPick = (calls: { term: string; question: string }[]): TableFinder => async (term, question) => {
  calls.push({ term, question });
  return null;
};

function ask(
  question: string,
  raw: RawParse,
  sourceSelection: { sources: string[]; web: boolean } | undefined,
  extra: { questionFinder?: TableFinder; lang?: 'nl' | 'en' } = {},
) {
  const intentClient = new CannedClient(raw);
  return {
    intentClient,
    response: respondToQuestion(db, question, {
      intentClient,
      answerClient: new ThrowingClient(),
      referenceDate: REFERENCE_DATE,
      ...(sourceSelection ? { sourceSelection } : {}),
      ...extra,
    }),
  };
}

describe('the no-sources belt names the official sources neutrally', () => {
  it('web-only text no longer names CBS (Dutch and English)', () => {
    const built = buildWebOnlyRefusal();
    expect(built.text).toContain('de officiële databronnen uitgeschakeld');
    expect(built.text).not.toMatch(/CBS/);
    expect(built.en.text).toContain('the official data sources');
    expect(built.en.text).not.toMatch(/CBS/);
  });

  it('an empty selection refuses before any parse (no_sources / web_only), zero LLM calls', async () => {
    for (const [web, reason] of [
      [false, 'no_sources'],
      [true, 'web_only'],
    ] as const) {
      const { intentClient, response } = ask('Hoeveel inwoners heeft Amsterdam?', curatedIntent(), { sources: [], web });
      const r = await response;
      if (r.kind !== 'refusal') throw new Error('unreachable');
      expect(r.reason).toBe(reason);
      expect(intentClient.calls).toBe(0);
    }
  });

  it('Eurostat alone is a data source: it does NOT hit the belt (the override handles it after the parse)', async () => {
    const { intentClient, response } = ask('Hoeveel inwoners heeft Amsterdam?', curatedIntent(), EUROSTAT_ONLY);
    const r = await response;
    expect(intentClient.calls).toBe(1);
    if (r.kind === 'refusal') expect(r.reason).not.toBe('no_sources');
  });
});

describe('buildNoEurostatTableRefusal', () => {
  it('is the owner-specified text in both languages: digit-free, never a question', () => {
    const built = buildNoEurostatTableRefusal();
    expect(built.reason).toBe('no_eurostat_table');
    expect(built.text).toBe(
      'Ik vond bij Eurostat geen tabel die deze vraag beantwoordt. Zet ook CBS aan als je Nederlandse cijfers wilt gebruiken.',
    );
    expect(built.en.text).toBe(
      'I found no Eurostat table that answers this question. Switch CBS on as well if you want to use Dutch figures.',
    );
    expect([...numbersInText(built.text)]).toHaveLength(0);
    expect(built.text.trimEnd().endsWith('?')).toBe(false);
    expect(built.en.text.trimEnd().endsWith('?')).toBe(false);
  });
});

describe('selections that leave CBS on are unchanged', () => {
  for (const [label, selection] of [
    ['no selection', undefined],
    ['CBS only', CBS_ONLY],
    ['CBS and Eurostat', BOTH],
  ] as const) {
    it(`${label}: a curated intent answers from CBS data, no finder involved`, async () => {
      const calls: { term: string; question: string }[] = [];
      const { response } = ask('Hoeveel inwoners had Amsterdam in 2024?', curatedIntent(), selection, {
        questionFinder: noPick(calls),
      });
      const r = await response;
      expect(r.kind).toBe('answer');
      expect(calls).toEqual([]);
    });
  }
});

describe('CBS off, Eurostat on: the curated path never answers', () => {
  const Q = 'Hoeveel inwoners had Amsterdam in 2024?';

  it('a curated intent + a confident Eurostat pick -> the pick is routed (onboarding envelope), nothing curated answers', async () => {
    const calls: { term: string; question: string }[] = [];
    const { response } = ask(Q, curatedIntent(), EUROSTAT_ONLY, { questionFinder: eurostatPick(calls) });
    const r = await response;
    expect(r.kind).toBe('refusal');
    if (r.kind !== 'refusal') throw new Error('unreachable');
    expect(r.reason).toBe('onboarding_pending');
    expect(r.onboarding?.tableId).toBe('eurostat:une_rt_m');
    // The whole question went to the finder, as both term and question.
    expect(calls).toEqual([{ term: Q, question: Q }]);
  });

  it('a curated intent + no pick -> the no_eurostat_table refusal (Dutch text, parse not recorded)', async () => {
    const calls: { term: string; question: string }[] = [];
    const { response } = ask(Q, curatedIntent(), EUROSTAT_ONLY, { questionFinder: noPick(calls) });
    const r = await response;
    if (r.kind !== 'refusal') throw new Error('unreachable');
    expect(r.reason).toBe('no_eurostat_table');
    expect(r.text).toBe(buildNoEurostatTableRefusal().text);
    expect(r.parse).toBeNull();
    expect(r.question).toBe(Q);
    expect(calls).toHaveLength(1);
  });

  it('a curated intent + no finder at all -> the same refusal; English readers get the English sibling', async () => {
    const { response } = ask(Q, curatedIntent(), EUROSTAT_ONLY, { lang: 'en' });
    const r = await response;
    if (r.kind !== 'refusal') throw new Error('unreachable');
    expect(r.reason).toBe('no_eurostat_table');
    expect(r.english?.text).toBe(buildNoEurostatTableRefusal().en.text);
  });

  it('a curated CLARIFICATION (unmatched topic) is not asked: routed like an intent', async () => {
    // Without the chip logic this is the B15 clarification "I have no CBS figures about ...".
    const none = await ask('Hoeveel kwark wordt er gemaakt?', unmatchedTopic(), EUROSTAT_ONLY).response;
    if (none.kind !== 'refusal') throw new Error('expected a refusal, not a CBS clarification');
    expect(none.reason).toBe('no_eurostat_table');

    const calls: { term: string; question: string }[] = [];
    const picked = await ask('Hoeveel kwark wordt er gemaakt?', unmatchedTopic(), EUROSTAT_ONLY, {
      questionFinder: eurostatPick(calls),
    }).response;
    if (picked.kind !== 'refusal') throw new Error('unreachable');
    expect(picked.reason).toBe('onboarding_pending');
    // The parse already ran the whole-question search; the override reused it (one paid search, not two).
    expect(calls).toHaveLength(1);
  });

  it('the same single search holds when nothing is found', async () => {
    const calls: { term: string; question: string }[] = [];
    const r = await ask('Hoeveel kwark wordt er gemaakt?', unmatchedTopic(), EUROSTAT_ONLY, {
      questionFinder: noPick(calls),
    }).response;
    if (r.kind !== 'refusal') throw new Error('unreachable');
    expect(r.reason).toBe('no_eurostat_table');
    expect(calls).toHaveLength(1);
  });

  it('non-data outcomes pass through unchanged (forecast, causal, compound, smalltalk)', async () => {
    for (const [kind, reason] of [
      ['forecast_request', 'forecast'],
      ['causal_question', 'causal'],
      ['compound', 'compound'],
      ['smalltalk_or_other', 'smalltalk'],
    ] as const) {
      const r = await ask('test vraag', noData(kind), EUROSTAT_ONLY, { questionFinder: noPick([]) }).response;
      if (r.kind !== 'refusal') throw new Error('unreachable');
      expect(r.reason, kind).toBe(reason);
    }
  });

  it('out_of_scope with no route stays the out_of_scope (scope) refusal; with a route the parse already routed it', async () => {
    const stay = await ask('Wat is de zin van het leven?', noData('out_of_scope'), EUROSTAT_ONLY, {
      questionFinder: noPick([]),
    }).response;
    if (stay.kind !== 'refusal') throw new Error('unreachable');
    expect(stay.reason).toBe('scope');

    const routed = await ask('Hoeveel werklozen zijn er in Frankrijk?', noData('out_of_scope'), EUROSTAT_ONLY, {
      questionFinder: eurostatPick([]),
    }).response;
    if (routed.kind !== 'refusal') throw new Error('unreachable');
    expect(routed.reason).toBe('onboarding_pending');
    expect(routed.onboarding?.tableId).toBe('eurostat:une_rt_m');
  });

  it('a reply turn: a curated merge never answers (no finder on reply turns); the click-take rung is skipped', async () => {
    const pending: PendingClarification = {
      version: RESPONSE_SCHEMA_VERSION,
      question: 'Hoeveel inwoners telde Utrecht?',
      referenceDate: REFERENCE_DATE,
      axes: ['region'],
      questionNl: 'Bedoel je de gemeente Utrecht of de provincie Utrecht?',
      options: ['Utrecht (gemeente)', 'Utrecht (PV)'],
    };
    const r = await respondToClarificationReply(db, pending, 'de gemeente', {
      intentClient: new CannedClient(curatedIntent()),
      answerClient: new ThrowingClient(),
      referenceDate: REFERENCE_DATE,
      clickOptionsEnabled: true,
      sourceSelection: EUROSTAT_ONLY,
    });
    if (r.kind !== 'refusal') throw new Error('unreachable');
    expect(r.reason).toBe('no_eurostat_table');
    expect(r.question).toBe(pending.question);
  });
});

describe('eurostatOnlyOverride decides every ParseOutcome kind explicitly', () => {
  const base = {
    question: 'q',
    raw: noData('data_query'),
    model: 'stub',
    usage: { inputTokens: 0, outputTokens: 0 },
  };
  const sel = { sources: ['eurostat'], web: false };
  const finder = eurostatPick([]);

  it('isEurostatOnly: CBS off + Eurostat on only', () => {
    expect(isEurostatOnly(undefined)).toBe(false);
    expect(isEurostatOnly({ sources: ['cbs'], web: false })).toBe(false);
    expect(isEurostatOnly({ sources: ['cbs', 'eurostat'], web: false })).toBe(false);
    expect(isEurostatOnly({ sources: [], web: false })).toBe(false);
    expect(isEurostatOnly({ sources: ['eurostat'], web: true })).toBe(true);
  });

  it('refusal -> passes through', async () => {
    const parse = { ...base, kind: 'refusal', refusalKind: 'forecast', note: null } as ParseOutcome;
    expect(await eurostatOnlyOverride(parse, sel, undefined)).toBe(parse);
  });

  it('onboarding -> passes through only for a table of a selected source', async () => {
    const eu = { ...base, kind: 'onboarding', tableId: 'eurostat:une_rt_m', topicTerm: 't', confidence: 0.9, alreadyPending: false, candidateIds: ['eurostat:une_rt_m'] } as ParseOutcome;
    const cbs = { ...eu, tableId: '83693NED', candidateIds: ['83693NED'] } as ParseOutcome;
    expect(await eurostatOnlyOverride(eu, sel, undefined)).toBe(eu);
    expect(await eurostatOnlyOverride(cbs, sel, undefined)).toBeNull();
  });

  it('intent and clarification -> routed through the finder, or null', async () => {
    for (const kind of ['intent', 'clarification'] as const) {
      const parse = { ...base, kind } as ParseOutcome;
      const routed = await eurostatOnlyOverride(parse, sel, finder);
      expect(routed?.kind, kind).toBe('onboarding');
      expect(await eurostatOnlyOverride(parse, sel, undefined), kind).toBeNull();
      expect(await eurostatOnlyOverride(parse, sel, noPick([])), kind).toBeNull();
    }
  });

  it('a finder pick from a source that is not selected is refused', async () => {
    const cbsPick: TableFinder = async (term) => ({
      tableId: '83693NED',
      topicTerm: term,
      confidence: 0.9,
      alreadyPending: false,
      candidateIds: ['83693NED'],
    });
    expect(await eurostatOnlyOverride({ ...base, kind: 'intent' } as ParseOutcome, sel, cbsPick)).toBeNull();
  });

  it('memoizeFinder answers a repeat (term, question) from its first call', async () => {
    const calls: { term: string; question: string }[] = [];
    const memo = memoizeFinder(eurostatPick(calls))!;
    await memo('a', 'q');
    await memo('a', 'q');
    await memo('b', 'q');
    expect(calls).toHaveLength(2);
    expect(memoizeFinder(undefined)).toBeUndefined();
  });
});
