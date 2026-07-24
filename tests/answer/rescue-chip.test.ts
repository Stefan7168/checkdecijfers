// WP26c (ADR 024 §6) — the rescue chip on a MISFIRED refusal.
//
// Both target cases are measured, from the s52 anonymous-trial smoke: a
// past-tense question about an already-published month classified as
// `forecast_request`, and a bare data question classified as `meta`. A trial
// visitor gets two free questions and today both can land on a refusal.
//
// What is pinned here:
//  1. The refusal TEXT never changes, and the classification is untouched. The
//     chip is an escape hatch beside an honest refusal, not a correction of it.
//  2. A chip is offered ONLY when deterministic code proved the asked figure
//     loaded and servable — no strong single match, no period, or a failed
//     dry-run ⇒ no chip, byte-identical to today.
//  3. Taking the chip resolves WITHOUT re-entering the parse that misfired
//     (that is the whole point: you cannot fix an unstable classification by
//     asking it again).
//  4. A rescue pending is NOT an open clarification round: anything else the
//     user types is answered as a FRESH question, never merged with the
//     refused one.
//  5. Flag off ⇒ no chip, no pending, no extra envelope keys.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { respondToQuestion, respondToClarificationReply } from '../../src/answer/respond/index.ts';
import { absolutePeriodInText } from '../../src/answer/respond/rescue.ts';
import type { LlmClient, LlmResponse } from '../../src/answer/llm/client.ts';
import type { RawParse } from '../../src/answer/intent/types.ts';

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

class ThrowingClient implements LlmClient {
  async complete(): Promise<LlmResponse> {
    throw new Error('LLM call attempted on a path that must be deterministic');
  }
}

/** The captured misfire: a data question the classifier put in a non-data
 * bucket, with the topic still recognized in nearestCanonicalKeys. */
function misfire(kind: RawParse['kind'], nearest: string[]): RawParse {
  return {
    version: 3,
    kind,
    candidates: [],
    unmatchedMeasureTerm: null,
    nearestCanonicalKeys: nearest,
    note: null,
  };
}

function options(clickOptionsEnabled?: boolean) {
  return {
    intentClient: new ThrowingClient(),
    answerClient: new ThrowingClient(),
    referenceDate: REFERENCE_DATE,
    ...(clickOptionsEnabled === undefined ? {} : { clickOptionsEnabled }),
  };
}

async function ask(question: string, raw: RawParse, clickOptionsEnabled?: boolean) {
  return respondToQuestion(db, question, {
    ...options(clickOptionsEnabled),
    intentClient: new CannedClient(raw),
  });
}

describe('the deterministic period reader', () => {
  it('reads one absolute period, and refuses to choose when there are several', () => {
    expect(absolutePeriodInText('Wat was de inflatie in juni 2026?')).toBe('2026MM06');
    expect(absolutePeriodInText('Hoeveel inwoners in 2024?')).toBe('2024JJ00');
    // Two distinct periods: rescuing one would be a guess.
    expect(absolutePeriodInText('inflatie in juni 2026 en juli 2026')).toBeNull();
    expect(absolutePeriodInText('Wat is de inflatie?')).toBeNull();
    // Not a plausible year.
    expect(absolutePeriodInText('regel 1234 van het besluit')).toBeNull();
  });
});

describe('the forecast misfire', () => {
  const QUESTION = 'Wat was de inflatie in 2024?';

  it('keeps refusing, but offers one proven chip', async () => {
    const response = await ask(QUESTION, misfire('forecast_request', ['cpi_yearly_inflation']), true);
    expect(response.kind).toBe('refusal');
    if (response.kind !== 'refusal') throw new Error('unreachable');
    // The classification and the honest text are UNTOUCHED.
    expect(response.reason).toBe('forecast');
    expect(response.text).toContain('CBS publiceert gerealiseerde cijfers');
    // ...and beside it, exactly one chip, naming the period it can serve.
    expect(response.suggestions).toHaveLength(1);
    expect(response.suggestions[0]).toContain('2024');
    expect(response.suggestions[0]).toContain('al gepubliceerd');
    const rescue = response.pending?.clickOptions ?? [];
    expect(rescue).toHaveLength(1);
    expect(rescue[0]!.intent.period).toEqual({ kind: 'codes', codes: ['2024JJ00'] });
    expect(response.pending?.rescueOnly).toBe(true);
  });

  it('taking the chip answers WITHOUT re-entering the parse that misfired', async () => {
    const refusal = await ask(QUESTION, misfire('forecast_request', ['cpi_yearly_inflation']), true);
    if (refusal.kind !== 'refusal' || !refusal.pending) throw new Error('expected a rescue pending');
    // Both clients throw: reaching any model on this path fails the test.
    const taken = await respondToClarificationReply(
      db,
      refusal.pending,
      refusal.suggestions[0]!,
      { ...options(true) },
    );
    expect(taken.kind).toBe('answer');
    if (taken.kind !== 'answer') throw new Error('unreachable');
    expect(taken.result.cells).toHaveLength(1);
    expect(taken.result.cells[0]!.periodCode).toBe('2024JJ00');
    expect(taken.answer.source).toBe('template');
  });

  it('offers nothing when the period is not one we can serve', async () => {
    // 1850 is loaded nowhere: the dry-run fails, so no chip is offered and the
    // refusal is byte-identical to today's.
    const response = await ask(
      'Wat was de inflatie in 1850?',
      misfire('forecast_request', ['cpi_yearly_inflation']),
      true,
    );
    if (response.kind !== 'refusal') throw new Error('unreachable');
    expect(response.suggestions).toEqual([]);
    expect(response.pending).toBeUndefined();
  });

  it('offers nothing when the topic is not ONE strong match', async () => {
    for (const nearest of [[], ['cpi_yearly_inflation', 'population_on_1_january']]) {
      const response = await ask(QUESTION, misfire('forecast_request', nearest), true);
      if (response.kind !== 'refusal') throw new Error('unreachable');
      expect(response.suggestions).toEqual([]);
      expect(response.pending).toBeUndefined();
    }
  });
});

describe('the meta misfire', () => {
  it('offers the freshest figure for the one recognized topic', async () => {
    const response = await ask(
      'Wat is het consumentenvertrouwen?',
      misfire('smalltalk_or_other', ['cpi_yearly_inflation']),
      true,
    );
    if (response.kind !== 'refusal') throw new Error('unreachable');
    expect(response.suggestions).toHaveLength(1);
    expect(response.suggestions[0]).toContain('Toon het cijfer voor');
    const rescue = response.pending?.clickOptions ?? [];
    expect(rescue[0]!.intent.target).toEqual({ kind: 'canonical', key: 'cpi_yearly_inflation' });
    // A rescue names an explicit published period — it makes no "what is it
    // now" claim, so the staleness rule must not treat it as one.
    expect(rescue[0]!.impliedRecency).toBe(false);
  });
});

describe('a rescue pending is not an open clarification round', () => {
  it('anything else the user types is answered as a FRESH question', async () => {
    const refusal = await ask(
      'Wat was de inflatie in 2024?',
      misfire('forecast_request', ['cpi_yearly_inflation']),
      true,
    );
    if (refusal.kind !== 'refusal' || !refusal.pending) throw new Error('expected a rescue pending');
    // The user ignores the chip and asks something unrelated. It must be
    // parsed as a NEW question (here: the canned parse answers it), never
    // merged with the refused one.
    const next = await respondToClarificationReply(db, refusal.pending, 'Hoeveel inwoners had Amsterdam in 2024?', {
      ...options(true),
      intentClient: new CannedClient({
        version: 3,
        kind: 'data_query',
        candidates: [
          {
            canonicalKey: 'population_on_1_january',
            regions: [{ name: 'Amsterdam', kind: 'gemeente' }],
            period: { kind: 'year', year: 2024 },
            derivation: 'none',
            confidence: 0.95,
            reading: 'bevolking van Amsterdam in 2024',
          },
        ] as never,
        unmatchedMeasureTerm: null,
        nearestCanonicalKeys: [],
        note: null,
      }),
      answerClient: new (class implements LlmClient {
        async complete(): Promise<LlmResponse> {
          throw new Error('compose falls back to the template — fine');
        }
      })(),
    });
    expect(next.kind).toBe('answer');
    if (next.kind !== 'answer') throw new Error('unreachable');
    // The NEW question's subject, not the refused one's.
    expect(next.result.intent.regions).toEqual(['GM0363']);
    expect(next.question).toBe('Hoeveel inwoners had Amsterdam in 2024?');
  });
});

describe('flag off', () => {
  it('offers no chip and carries no pending', async () => {
    const response = await ask(
      'Wat was de inflatie in 2024?',
      misfire('forecast_request', ['cpi_yearly_inflation']),
    );
    if (response.kind !== 'refusal') throw new Error('unreachable');
    expect(response.suggestions).toEqual([]);
    expect(Object.hasOwn(response, 'pending')).toBe(false);
  });
});
