// Two-measure scatter (spec 2026-09-27, #296 part 2 Task 5): the hermetic
// end-to-end click-take — the "Zet af tegen …" chip minted under a REAL CBS
// region-set answer, taken through the ordinary WP26 mechanism A carrier
// (respondToClarificationReply), landing on the Task 4 template-only scatter
// answer shape. Zero LLM calls across BOTH turns: the first turn is a
// hand-built ParseOutcome (the intent parser never emits `pairWith` — the
// only doorway is this click, per scatter-answer.test.ts's own header), and
// the second turn's `matchClickOption` fast path (respond.ts) takes the
// stored, dry-run-proven pair intent without ever reaching the intent
// client — both injected clients throw on any call.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { respondToClarificationReply, respondToIntent } from '../../src/answer/respond/index.ts';
import type { ParseOutcome } from '../../src/answer/intent/types.ts';
import type { LlmClient, LlmResponse } from '../../src/answer/llm/client.ts';
import type { StructuredIntent } from '../../src/query/index.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { fixedEnglishChipLabels, prepareTranslation } from '../../src/answer/translate/translate.ts';

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

const REFERENCE_DATE = '2026-08-15';
const QUESTION = 'Gemiddelde verkoopprijs per provincie in 2024';
// ADR 061 part 2 (spec D6): SCATTER_PARTNERS prefers population_density for
// average_home_sale_price_by_gemeente over the registry-order fallback
// (population_on_1_january), which this end-to-end test exercised before.
const CHIP_LABEL = 'Zet af tegen bevolkingsdichtheid';

/** Any call to this is a test failure by construction — the whole flow
 * (offer AND take) must cost zero tokens. */
class ThrowingClient implements LlmClient {
  calls = 0;
  async complete(): Promise<LlmResponse> {
    this.calls += 1;
    throw new Error('LLM call attempted on a path that must be deterministic');
  }
}

const homePriceAllProvinces: StructuredIntent = {
  schemaVersion: 1,
  target: { kind: 'canonical', key: 'average_home_sale_price_by_gemeente' },
  regionSet: { kind: 'all_provincies' },
  period: { kind: 'codes', codes: ['2024JJ00'] },
  derivation: 'none',
};

function stubIntent(intent: StructuredIntent): Extract<ParseOutcome, { kind: 'intent' }> {
  return {
    kind: 'intent',
    question: QUESTION,
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
    intent,
    confidence: 1,
    impliedRecency: false,
    ranked: [],
  };
}

describe('the "Zet af tegen …" chip: offer + click-take, hermetic end to end', () => {
  it('answers the provinces home-price region-set question, offers the chip, and taking it lands on the Task 4 scatter answer — zero LLM calls throughout', async () => {
    const answerClient = new ThrowingClient();
    const intentClient = new ThrowingClient();

    // Turn 1: the ordinary CBS region-set answer (no pairWith — the parser
    // never emits one).
    const answered = await respondToIntent(db, QUESTION, stubIntent(homePriceAllProvinces), {
      answerClient,
      referenceDate: REFERENCE_DATE,
      clickOptionsEnabled: true,
    });
    if (answered.kind !== 'answer') throw new Error(`expected an answer, got ${answered.kind}: ${answered.text}`);
    expect(answered.result.shape).toBe('region_set');

    const pending = answered.pending;
    if (pending === undefined) throw new Error('expected a chip-carrier pending offering the plotAgainst chip');
    expect(pending.rescueOnly).toBe(true);
    // The chip is minted FIRST (build-plan Task 5: plotAgainst runs ahead of
    // every other generator) — its own id prefix, 'pair-1'.
    expect(pending.options[0]).toBe(CHIP_LABEL);
    expect(pending.clickOptions?.[0]).toMatchObject({ id: 'pair-1', label: CHIP_LABEL });

    // #296 final-review fix I1: the chip carries its deterministic English
    // label, so an English reader's translation request leaves it out and
    // shows the fixed label in its place (a plotAgainst chip whose label
    // names a measure WITH a digit, e.g. "bevolking op 1 januari", would
    // otherwise survive masking and send the whole English answer to the
    // Dutch fallback — the digit-survival check below covers that case
    // generally, not only this particular pair).
    expect(pending.clickOptions?.[0]?.labelEn).toBe('Plot against population density');
    expect(fixedEnglishChipLabels(answered)[answered.suggestions.indexOf(CHIP_LABEL)]).toBe(
      'Plot against population density',
    );
    const prep = prepareTranslation(answered);
    expect(prep.maskedDutch.chips).toHaveLength(answered.suggestions.length - 1);
    expect(prep.maskedDutch.chips.join(' ')).not.toContain('Zet af tegen');
    expect(prep.digitSurvived).toBe(false);

    // Turn 2: the click-take, through the ordinary WP26 mechanism A fast
    // path — a reply BYTE-EQUAL to the offered label never reaches
    // intentClient.
    const taken = await respondToClarificationReply(db, pending, CHIP_LABEL, {
      intentClient,
      answerClient,
      referenceDate: REFERENCE_DATE,
      clickOptionsEnabled: true,
    });

    expect(intentClient.calls).toBe(0);
    expect(answerClient.calls).toBe(0);

    if (taken.kind !== 'answer') throw new Error(`expected the take to answer, got ${taken.kind}: ${taken.text}`);
    // Task 4's template-only scatter answer shape: no chart, no chips, both
    // legs present, an audited template take with the click model.
    expect(taken.chart).toBeNull();
    expect('pending' in taken).toBe(false);
    expect(taken.suggestions).toEqual([]);
    const scatter = taken.scatter;
    const paired = taken.pairedResult;
    if (scatter === undefined || paired === undefined) {
      throw new Error('expected a scatter answer (scatter + pairedResult present)');
    }
    expect(scatter.points.length).toBeGreaterThanOrEqual(3);
    expect(taken.result.attribution.tableId).toBe('83625NED');
    expect(paired.attribution.tableId).toBe('70072ned');
    expect(taken.answer.source).toBe('template');
    expect(taken.answer.model).toBeNull();
    expect(taken.parse.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    // R8: the audited question stays the two-measure ask, not the y leg's
    // own one-measure intent (legIntents strips pairWith before either leg
    // runs) — pair.ts's own `intent` field on PairedResults carries it.
    if (taken.parse.kind !== 'intent') throw new Error(`expected the take's own parse kind 'intent', got ${taken.parse.kind}`);
    expect(taken.parse.intent.pairWith).toEqual({ kind: 'canonical', key: 'population_density' });
  });
});
