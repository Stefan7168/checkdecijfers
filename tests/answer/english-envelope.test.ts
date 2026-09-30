// ADR 058 phase 2 (#332), Task 5: the envelope-attach step — proves the
// invariant the whole design doc hinges on: "the Dutch path is byte-
// identical." A refusal/clarification envelope gains an `english` key ONLY
// when respond ran for an English reader (`lang === 'en'`); a Dutch or
// lang-less run (benchmark, CLI, tests — every caller before this task) is
// UNCHANGED, not merely "close enough."
//
// Hermetic throughout: the fixture DB (tests/helpers/ingested-db.ts) +
// replayed LLM fixtures (the same intent/answer/clarify fixtures
// respond-pipeline.test.ts drives B15-B20 through) for the end-to-end cases;
// hand-built inputs (no db, no LLM) for toInternalRefusal; a clock-injected
// stale table (respond-staleness.test.ts's own recipe) for the staleness
// refusal. Zero live LLM calls, zero network, matching every other suite in
// this directory.
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReplayLlmClient, stableStringify } from '../../src/answer/llm/client.ts';
import { respondToQuestion, respondToIntent } from '../../src/answer/respond/index.ts';
// M7 fix (2026-09-27 review): a direct-unit-testing export, same rationale
// as respondToIntent's own (see that export's doc comment) — not part of the
// module's public barrel (src/answer/respond/index.ts), imported straight
// from the implementation file like isRescuePending/isStrippedCarrier
// already are in tests/answer/wp26-trust-boundary.test.ts.
import { respondToParseOutcome } from '../../src/answer/respond/respond.ts';
import type { ComposedResponse, RespondOptions } from '../../src/answer/respond/index.ts';
import { INTERNAL_REFUSAL_TEXT_EN, toInternalRefusal } from '../../src/answer/respond/refusals.ts';
import type { NonAnswerEnglish } from '../../src/answer/translate/types.ts';
import type { LlmClient, LlmResponse } from '../../src/answer/llm/client.ts';
import type { ParseOutcome, RawParse } from '../../src/answer/intent/types.ts';
import {
  answerQuestionAudited,
  loadAuditRecord,
  reconstructionReport,
} from '../../src/answer/audit/index.ts';
import type { AuditRecord } from '../../src/answer/audit/index.ts';
import { REFUSAL_TASK_QUESTIONS } from '../helpers/benchmark-intents.ts';
import { backdateTableSync, createIngestedDb } from '../helpers/ingested-db.ts';
import { loadLabelledSet } from '../helpers/intent-expectations.ts';
import type { Db } from '../../src/db/types.ts';

const INTENT_FIXTURES = fileURLToPath(new URL('../fixtures/llm/intent', import.meta.url));
const ANSWER_FIXTURES = fileURLToPath(new URL('../fixtures/llm/answer', import.meta.url));
const REFERENCE_DATE = loadLabelledSet().referenceDate;

function fixtureClients(lang?: 'nl' | 'en'): RespondOptions {
  return {
    intentClient: new ReplayLlmClient(INTENT_FIXTURES),
    answerClient: new ReplayLlmClient(ANSWER_FIXTURES),
    referenceDate: REFERENCE_DATE,
    ...(lang !== undefined ? { lang } : {}),
  };
}

type WithEnglish = ComposedResponse & { english: NonAnswerEnglish };

/** Strips every collected untranslated (Dutch) fragment out of `text` first
 * — those are the ONE documented non-template ingredient (design doc "Why
 * templates, not the translation model") and are allowed to stay Dutch
 * inside an otherwise-English sentence. What's left is belt-checked for a
 * few unmistakably-Dutch function words; a real English sentence never
 * contains any of them as a standalone word. */
function assertReadsAsEnglish(text: string, untranslated: string[]): void {
  const cleaned = untranslated.reduce((acc, fragment) => acc.split(fragment).join(''), text);
  for (const stopword of [' het ', ' een ', ' niet ']) {
    expect(
      cleaned,
      `leftover Dutch stopword ${JSON.stringify(stopword)} in ${JSON.stringify(cleaned)} (untranslated: ${JSON.stringify(untranslated)})`,
    ).not.toContain(stopword);
  }
}

// ---------------------------------------------------------------------------
// End-to-end: a refusal (B17 scope, B18 forecast) and a clarification
// (B15, B16), each run three ways — no `lang`, `lang: 'nl'`, `lang: 'en'`.
// ---------------------------------------------------------------------------

describe('respondToQuestion: `english` is present-only for lang "en", Dutch/lang-less byte-identical', () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createIngestedDb());
  }, 300_000);

  afterAll(async () => {
    await close();
  });

  const TASKS: { id: 'B17' | 'B18' | 'B15' | 'B16'; kind: 'refusal' | 'clarification' }[] = [
    { id: 'B17', kind: 'refusal' }, // scope
    { id: 'B18', kind: 'refusal' }, // forecast
    { id: 'B15', kind: 'clarification' },
    { id: 'B16', kind: 'clarification' },
  ];

  for (const { id, kind } of TASKS) {
    describe(id, () => {
      let noLang: ComposedResponse;
      let nl: ComposedResponse;
      let en: ComposedResponse;

      beforeAll(async () => {
        const question = REFUSAL_TASK_QUESTIONS[id]!;
        noLang = await respondToQuestion(db, question, fixtureClients());
        nl = await respondToQuestion(db, question, fixtureClients('nl'));
        en = await respondToQuestion(db, question, fixtureClients('en'));
      }, 60_000);

      it(`produces a ${kind} envelope`, () => {
        expect(noLang.kind).toBe(kind);
      });

      it('no `lang` and `lang: "nl"` carry no `english` key and are byte-identical', () => {
        expect('english' in noLang).toBe(false);
        expect('english' in nl).toBe(false);
        expect(stableStringify(nl)).toBe(stableStringify(noLang));
      });

      it('`lang: "en"` equals the Dutch envelope plus exactly one extra key, `english`', () => {
        expect('english' in en).toBe(true);
        const { english: _english, ...enWithoutEnglish } = en as WithEnglish;
        expect(stableStringify(enWithoutEnglish)).toBe(stableStringify(noLang));
      });

      it('`english.text` reads as English (Dutch survives only inside `untranslated`)', () => {
        const { english } = en as WithEnglish;
        expect(english.source).toBe('template');
        assertReadsAsEnglish(english.text, english.untranslated);
      });

      // I2 fix (2026-09-27 review): a clarification's English chips must be
      // EXACTLY the takeable options — the same set the Dutch envelope's own
      // `suggestions` carries (built only from clickOptions, never from the
      // plain option list) — not every plain-text option. `suggestions` is
      // present-only on BOTH kinds (refusal: always `[]` at minimum;
      // clarification: absent when no click option survived), so `?? []`
      // covers both uniformly. These labelled-set tasks run with
      // clickOptionsEnabled unset (off), so `[]` on both sides for every
      // task here is itself the regression pin: before the I2 fix, a
      // clarification's `english.chips` was built from ALL of `options`
      // instead, which this equality would have caught.
      it('`english.chips`\' `submit` values equal `response.suggestions ?? []`', () => {
        const { english } = en as WithEnglish;
        const dutchOffered = (en as ComposedResponse & { suggestions?: string[] }).suggestions ?? [];
        expect(english.chips.map((c) => c.submit)).toEqual(dutchOffered);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// I1 + I2 fix regression (2026-09-27 review), click options ON. The
// labelled-set tasks above all run with clickOptionsEnabled unset (off), so
// they never exercise a clarification that actually carries `clickOptions` —
// exactly the state a labelEn leak (I1) and a wrong englishChips source (I2)
// need to be visible in. Uses clarify-click.test.ts's own hand-canned-client
// recipe (the flagship Utrecht gemeente-vs-provincie region ambiguity, whose
// options ARE the competing readings, so `clickOptionsEnabled: true`
// actually mints two click options) rather than ReplayLlmClient — a canned
// client needs no fixture file and cannot go stale.
// ---------------------------------------------------------------------------

class CannedIntentClient implements LlmClient {
  private readonly raw: RawParse;
  constructor(raw: RawParse) {
    this.raw = raw;
  }
  async complete(): Promise<LlmResponse> {
    return {
      outputText: JSON.stringify(this.raw),
      model: 'stub',
      stopReason: 'end_turn',
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}

const AMBIGUOUS_UTRECHT: RawParse = {
  version: 4,
  kind: 'data_query',
  candidates: [
    {
      regionScope: null,
      canonicalKey: 'population_on_1_january',
      regions: [{ name: 'Utrecht', kind: 'onbekend' }],
      period: { kind: 'year', year: 2024 },
      derivation: 'none',
      confidence: 0.95,
      reading: 'bevolking van Utrecht in 2024',
    },
  ] as never,
  unmatchedMeasureTerm: null,
  nearestCanonicalKeys: [],
  note: null,
};

describe('click options ON: no labelEn leak into stored parse/pending (I1), english.chips == suggestions (I2)', () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createIngestedDb());
  }, 300_000);

  afterAll(async () => {
    await close();
  });

  async function ask(lang?: 'nl' | 'en'): Promise<Extract<ComposedResponse, { kind: 'clarification' }>> {
    const response = await respondToQuestion(db, 'Hoeveel inwoners had Utrecht in 2024?', {
      intentClient: new CannedIntentClient(AMBIGUOUS_UTRECHT),
      answerClient: new ThrowingAnswerClient(),
      referenceDate: '2026-08-15',
      clickOptionsEnabled: true,
      ...(lang !== undefined ? { lang } : {}),
    });
    if (response.kind !== 'clarification') {
      throw new Error(`expected a clarification, got ${response.kind}: ${response.text}`);
    }
    return response;
  }

  it('sanity: this scenario actually mints click options (region_ambiguous)', async () => {
    const response = await ask();
    expect(response.pending.clickOptions ?? []).toHaveLength(2);
    expect(response.suggestions).toEqual((response.pending.clickOptions ?? []).map((o) => o.label));
  });

  it('I1: the stored (Dutch/lang-less) envelope carries no `labelEn` anywhere', async () => {
    const noLang = await ask();
    const nl = await ask('nl');
    // Belt: the click options really are on the envelope (a `labelEn`-free
    // result over an EMPTY clickOptions array would be a false pass).
    expect(noLang.pending.clickOptions ?? []).not.toHaveLength(0);
    expect(stableStringify(noLang)).not.toContain('labelEn');
    expect(stableStringify(nl)).not.toContain('labelEn');
    // withoutEnglish's own strip target: `parse.clickOptions` (present on this
    // clarification's ParseOutcome, per policy.ts's withClickOptions).
    const parse = noLang.parse as Extract<ParseOutcome, { kind: 'clarification' }>;
    expect(parse.clickOptions).toBeDefined();
    for (const option of parse.clickOptions ?? []) {
      expect(Object.hasOwn(option, 'labelEn')).toBe(false);
    }
  });

  it('I2: `english.chips`\' `submit` values equal `response.suggestions` (not every plain option)', async () => {
    const en = await ask('en');
    const withEnglish = en as unknown as WithEnglish;
    expect('english' in en).toBe(true);
    // The regression this pins: before the I2 fix, englishChips was built
    // from ALL of `options` (length 2 here too, by coincidence of this
    // scenario) — so the real proof is the CONTENT match against
    // `suggestions`, not merely equal lengths.
    expect(withEnglish.english.chips.map((c) => c.submit)).toEqual(en.suggestions);
    expect(en.suggestions).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// toInternalRefusal — hand-built, no db, no LLM.
// ---------------------------------------------------------------------------

describe('toInternalRefusal: `english` present only for lang "en"', () => {
  it('absent lang and lang "nl" carry no `english`; lang "en" carries the fixed English body', () => {
    const noLang = toInternalRefusal('een vraag', 'note');
    const nl = toInternalRefusal('een vraag', 'note', 'nl');
    const en = toInternalRefusal('een vraag', 'note', 'en');

    expect('english' in noLang).toBe(false);
    expect('english' in nl).toBe(false);
    expect(stableStringify(nl)).toBe(stableStringify(noLang));

    expect('english' in en).toBe(true);
    const { english: _english, ...enWithoutEnglish } = en as typeof en & { english: NonAnswerEnglish };
    expect(stableStringify(enWithoutEnglish)).toBe(stableStringify(noLang));
    expect((en as typeof en & { english: NonAnswerEnglish }).english).toEqual({
      source: 'template',
      text: INTERNAL_REFUSAL_TEXT_EN,
      chips: [],
      untranslated: [],
    });
  });
});

// ---------------------------------------------------------------------------
// The staleness refusal (respond.ts's inline BuiltRefusal) — the
// respond-staleness.test.ts recipe: a clock-injected stale table via
// respondToIntent directly (never the wall clock).
// ---------------------------------------------------------------------------

class ThrowingAnswerClient implements LlmClient {
  async complete(): Promise<LlmResponse> {
    throw new Error('should not be called: the staleness refusal never reaches compose');
  }
}

function stubIntentOutcome(): Extract<ParseOutcome, { kind: 'intent' }> {
  return {
    kind: 'intent',
    question: 'Wat is de inflatie nu?',
    raw: {
      version: 4,
      kind: 'data_query',
      candidates: [],
      unmatchedMeasureTerm: null,
      nearestCanonicalKeys: [],
      note: null,
    },
    model: 'stub',
    usage: { inputTokens: 0, outputTokens: 0 },
    intent: {
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'cpi_yearly_inflation' },
      period: { kind: 'codes', codes: ['2024JJ00'] },
      derivation: 'none',
    },
    confidence: 0.97,
    impliedRecency: true,
    ranked: [],
  };
}

describe('the staleness refusal: `english` present only for lang "en"', () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createIngestedDb());
    // 86141NED (CPI) is registered 'monthly' -> maxAgeDays 47; this pushes it
    // far past that so impliedRecency=true refuses (never warns-and-serves).
    // At the table's own date source in either build mode (whole-table or
    // slice-stored, INGEST_FIXTURE_MODE).
    await backdateTableSync(db, '86141NED', '2020-01-01T00:00:00.000Z');
  }, 300_000);

  afterAll(async () => {
    await close();
  });

  it('lang absent/"nl" carry no `english`; lang "en" carries an English body naming the same period', async () => {
    const parse = stubIntentOutcome();
    const noLang = await respondToIntent(db, 'Wat is de inflatie nu?', parse, {
      answerClient: new ThrowingAnswerClient(),
      referenceDate: '2026-07-03',
    });
    const nl = await respondToIntent(db, 'Wat is de inflatie nu?', parse, {
      answerClient: new ThrowingAnswerClient(),
      referenceDate: '2026-07-03',
      lang: 'nl',
    });
    const en = await respondToIntent(db, 'Wat is de inflatie nu?', parse, {
      answerClient: new ThrowingAnswerClient(),
      referenceDate: '2026-07-03',
      lang: 'en',
    });

    expect(noLang.kind).toBe('refusal');
    if (noLang.kind !== 'refusal') throw new Error('unreachable');
    expect(noLang.reason).toBe('staleness');

    expect('english' in noLang).toBe(false);
    expect('english' in nl).toBe(false);
    expect(stableStringify(nl)).toBe(stableStringify(noLang));

    expect('english' in en).toBe(true);
    const { english: _english, ...enWithoutEnglish } = en as WithEnglish;
    expect(stableStringify(enWithoutEnglish)).toBe(stableStringify(noLang));
    const { english } = en as WithEnglish;
    assertReadsAsEnglish(english.text, english.untranslated);
  });
});

// ---------------------------------------------------------------------------
// I2 fix regression, second call site (2026-09-27 review): the QUERY-level
// needs_clarification (respondToIntent's own `built.kind === 'clarification'`
// branch, answer-first-region.test.ts's own "flag off" recipe below) — this
// clarification NEVER carries a ClickOption
// (buildNeedsClarificationAsClarification never sets one), so its Dutch
// envelope never carries `suggestions` either; `english.chips` must match
// that with `[]`. None of the labelled-set tasks above reach this call site
// (B15/B16 are the PARSE-level clarification, a different branch) — this is
// the only regression coverage for it.
// ---------------------------------------------------------------------------

function stubRegionlessOutcome(): Extract<ParseOutcome, { kind: 'intent' }> {
  return {
    kind: 'intent',
    question: 'Hoeveel inwoners heeft Nederland?',
    raw: {
      version: 4,
      kind: 'data_query',
      candidates: [],
      unmatchedMeasureTerm: null,
      nearestCanonicalKeys: [],
      note: null,
    },
    model: 'stub',
    usage: { inputTokens: 0, outputTokens: 0 },
    // Same shape as answer-first-region.test.ts's own `regionlessIntent`
    // helper — a geo measure with NO region named, answerFirstEnabled left
    // off (not set below), which is the exact pre-WP26 dead-end that reaches
    // resolve.ts's `needs_clarification` refusal with the region axis.
    intent: {
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'population_on_1_january' },
      period: { kind: 'codes', codes: ['2024JJ00'] },
      derivation: 'none',
    },
    confidence: 0.95,
    impliedRecency: false,
    ranked: [],
  };
}

describe('the query-level needs_clarification: `english.chips` is `[]`, matching the Dutch envelope having no `suggestions`', () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createIngestedDb());
  }, 300_000);

  afterAll(async () => {
    await close();
  });

  it('lang "en": produces a clarification with no `suggestions` and an empty `english.chips`', async () => {
    const parse = stubRegionlessOutcome();
    const response = await respondToIntent(db, parse.question, parse, {
      answerClient: new ThrowingAnswerClient(),
      referenceDate: '2026-07-03',
      lang: 'en',
    });
    expect(response.kind).toBe('clarification');
    if (response.kind !== 'clarification') throw new Error('unreachable');
    expect(Object.hasOwn(response, 'suggestions')).toBe(false);
    const { english } = response as WithEnglish;
    expect(english.chips).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// An audited run (respond-audited's entry point): the stored envelope
// carries `english`, and reconstruction finds nothing wrong with it.
// ---------------------------------------------------------------------------

describe('answerQuestionAudited: lang "en" stores `english` on the row, reconstructs clean', () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createIngestedDb());
  }, 300_000);

  afterAll(async () => {
    await close();
  });

  it('B17 (refusal, scope)', async () => {
    const audited = await answerQuestionAudited(db, REFUSAL_TASK_QUESTIONS.B17!, fixtureClients('en'));
    expect(audited.auditId).not.toBeNull();
    const record = (await loadAuditRecord(db, audited.auditId!)) as AuditRecord;
    expect(record.response.kind).toBe('refusal');
    expect('english' in record.response).toBe(true);
    expect(reconstructionReport(record)).toEqual({ ok: true, problems: [] });
  });

  it('B15 (clarification)', async () => {
    const audited = await answerQuestionAudited(db, REFUSAL_TASK_QUESTIONS.B15!, fixtureClients('en'));
    expect(audited.auditId).not.toBeNull();
    const record = (await loadAuditRecord(db, audited.auditId!)) as AuditRecord;
    expect(record.response.kind).toBe('clarification');
    expect('english' in record.response).toBe(true);
    expect(reconstructionReport(record)).toEqual({ ok: true, problems: [] });
  });
});

// ---------------------------------------------------------------------------
// M7 fix regression (2026-09-27 review): respondToParseOutcome's clarification
// branch used `parse.question_en ?? ''` — an empty string is still "present"
// (`??` only falls through on null/undefined), so a ParseOutcome missing
// question_en produced an EMPTY English bubble instead of falling back to the
// Dutch question. Every real parser output sets question_en unconditionally
// (policy.ts), so this is exercised with a hand-built ParseOutcome — the same
// "defensive, never exercised by real output" status as
// ClarificationEnvelopeInput.english's own identical fallback one layer up
// (refusals.ts), which this test also indirectly proves stays correct
// (real fallback text, not '').
// ---------------------------------------------------------------------------

describe('respondToParseOutcome: a clarification missing `question_en` falls back to the Dutch question, never an empty string', () => {
  function clarificationMissingQuestionEn(): Extract<ParseOutcome, { kind: 'clarification' }> {
    return {
      kind: 'clarification',
      question: 'synthetische vraag',
      raw: {
        version: 4,
        kind: 'data_query',
        candidates: [],
        unmatchedMeasureTerm: null,
        nearestCanonicalKeys: [],
        note: null,
      },
      model: 'stub',
      usage: { inputTokens: 0, outputTokens: 0 },
      axes: ['measure'],
      question_nl: 'Welk cijfer bedoel je precies?',
      options: ['Optie A', 'Optie B'],
      // question_en deliberately OMITTED — the case `?? ''` handled wrong.
      reason: 'synthetic_missing_question_en',
    };
  }

  it('lang "en": `english.text` is the Dutch question, not an empty string', async () => {
    // No db call happens on this branch (toClarificationResponse builds the
    // envelope directly from `parse`) — a stub is enough.
    const stubDb = {} as Db;
    const parse = clarificationMissingQuestionEn();
    const response = await respondToParseOutcome(stubDb, parse.question, parse, {
      answerClient: { complete: () => Promise.reject(new Error('must not be called')) },
      referenceDate: '2026-09-27',
      lang: 'en',
    });
    expect(response.kind).toBe('clarification');
    if (response.kind !== 'clarification') throw new Error('unreachable');
    const { english } = response as WithEnglish;
    expect(english.text).not.toBe('');
    expect(english.text).toBe(parse.question_nl);
  });
});
