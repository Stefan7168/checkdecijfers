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
import type { ComposedResponse, RespondOptions } from '../../src/answer/respond/index.ts';
import { INTERNAL_REFUSAL_TEXT_EN, toInternalRefusal } from '../../src/answer/respond/refusals.ts';
import type { NonAnswerEnglish } from '../../src/answer/translate/types.ts';
import type { LlmClient, LlmResponse } from '../../src/answer/llm/client.ts';
import type { ParseOutcome } from '../../src/answer/intent/types.ts';
import {
  answerQuestionAudited,
  loadAuditRecord,
  reconstructionReport,
} from '../../src/answer/audit/index.ts';
import type { AuditRecord } from '../../src/answer/audit/index.ts';
import { REFUSAL_TASK_QUESTIONS } from '../helpers/benchmark-intents.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
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

      it('`english.chips`\' `submit` values equal the Dutch offered strings', () => {
        const { english } = en as WithEnglish;
        const dutchOffered =
          kind === 'refusal'
            ? (en as Extract<ComposedResponse, { kind: 'refusal' }>).suggestions
            : (en as Extract<ComposedResponse, { kind: 'clarification' }>).options;
        expect(english.chips.map((c) => c.submit)).toEqual(dutchOffered);
      });
    });
  }
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
    await db.query('update cbs_tables set last_sync_at = $2 where id = $1', [
      '86141NED',
      '2020-01-01T00:00:00.000Z',
    ]);
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
