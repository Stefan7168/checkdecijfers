// WP26 mechanism A (ADR 024, take-path A2) — clickable clarification options.
//
// What these prove, in the order the execute-brief (§3, §8) asks for:
//  1. FLAG-OFF BYTE-NEUTRALITY. Unset CLARIFY_CLICK_ENABLED ⇒ no dry-runs, no
//     clickOptions on the pending, no `suggestions` key on the envelope — the
//     clarification is the pre-WP26 object, key for key.
//  2. OFFERS ARE PROVEN. Every offered option carries a fully resolved intent
//     that was dry-run through the REAL query layer first; an option that
//     would refuse never becomes a chip (the dead-end guarantee).
//  3. THE TAKE IS LLM-FREE. A reply byte-equal to an offered label resolves
//     from the stored intent with BOTH clients throwing — the strongest
//     available proof that no model call happens on that path — and composes
//     through the deterministic template rung (ADR 024: "no LLM call at all").
//  4. NOTHING IS GUESSED. A reply that does not match falls through to the
//     normal LLM merge; a stale option re-queried at take time REFUSES
//     honestly instead of serving an offer that no longer holds.
//  5. THE PAYLOAD IS UNTRUSTED. The client-held options come back through a
//     schema check that drops forgeries (principle c's structural half).
//
// Hermetic: fixture-ingested PGlite + canned/throwing clients. No API key, no
// network — exactly what CI runs.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import {
  CLICK_TAKE_MODEL,
  respondToClarificationReply,
  respondToQuestion,
  validateClickOptions,
  withValidatedClickOptions,
} from '../../src/answer/respond/index.ts';
import type { ClickOption, PendingClarification } from '../../src/answer/respond/index.ts';
import { MAX_CLICK_OPTIONS } from '../../src/answer/intent/types.ts';
import { parseFollowUpQuestion } from '../../src/answer/intent/followup.ts';
import { CONTEXT_VERSION } from '../../src/answer/context/types.ts';
import type { ConversationContext } from '../../src/answer/context/types.ts';
import type { LlmClient, LlmResponse } from '../../src/answer/llm/client.ts';
import type { RawParse } from '../../src/answer/intent/types.ts';
import type { StructuredIntent } from '../../src/query/index.ts';

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

/** Any call to this is a test failure by construction: the take-path must not
 * touch a model, and the offer path must not phrase anything. */
class ThrowingClient implements LlmClient {
  async complete(): Promise<LlmResponse> {
    throw new Error('LLM call attempted on a path that must be deterministic');
  }
}

function rawDataQuery(...candidates: Record<string, unknown>[]): RawParse {
  return {
    version: 3,
    kind: 'data_query',
    candidates: candidates as never,
    unmatchedMeasureTerm: null,
    nearestCanonicalKeys: [],
    note: null,
  };
}

/** Bare "Utrecht" on the population measure: the flagship ambiguity (gemeente
 * GM0344 vs provincie PV26), where the options ARE the competing readings. */
const AMBIGUOUS_UTRECHT = rawDataQuery({
  canonicalKey: 'population_on_1_january',
  regions: [{ name: 'Utrecht', kind: 'onbekend' }],
  period: { kind: 'year', year: 2024 },
  derivation: 'none',
  confidence: 0.95,
  reading: 'bevolking van Utrecht in 2024',
});

function askOptions(intentClient: LlmClient, clickOptionsEnabled?: boolean) {
  return {
    intentClient,
    answerClient: new ThrowingClient(),
    referenceDate: REFERENCE_DATE,
    ...(clickOptionsEnabled === undefined ? {} : { clickOptionsEnabled }),
  };
}

async function clarify(raw: RawParse, clickOptionsEnabled?: boolean) {
  const response = await respondToQuestion(
    db,
    'Hoeveel inwoners had Utrecht in 2024?',
    askOptions(new CannedClient(raw), clickOptionsEnabled),
  );
  if (response.kind !== 'clarification') {
    throw new Error(`expected a clarification, got ${response.kind}: ${response.text}`);
  }
  return response;
}

describe('flag off: byte-identical to the pre-WP26 clarification', () => {
  it('offers no click options and serializes no extra keys (region ambiguity)', async () => {
    const response = await clarify(AMBIGUOUS_UTRECHT);
    expect(response.options).toContain('Utrecht (gemeente)');
    // Absent KEYS, not empty arrays: an empty `suggestions: []` would already
    // change the stored envelope's bytes for every flag-off turn.
    expect(Object.hasOwn(response, 'suggestions')).toBe(false);
    expect(Object.hasOwn(response.pending, 'clickOptions')).toBe(false);
  });

  it('offers no click options on a two-reading (rule 4) clarification', async () => {
    const response = await clarify(
      rawDataQuery(
        {
          canonicalKey: 'population_on_1_january',
          regions: [{ name: 'Amsterdam', kind: 'gemeente' }],
          period: { kind: 'year', year: 2024 },
          derivation: 'none',
          confidence: 0.95,
          reading: 'bevolking van Amsterdam in 2024',
        },
        {
          canonicalKey: 'population_on_1_january',
          regions: [{ name: 'Amsterdam', kind: 'gemeente' }],
          period: { kind: 'year', year: 2023 },
          derivation: 'none',
          confidence: 0.6,
          reading: 'bevolking van Amsterdam in 2023',
        },
      ),
    );
    expect(response.options).toHaveLength(2);
    expect(Object.hasOwn(response, 'suggestions')).toBe(false);
    expect(Object.hasOwn(response.pending, 'clickOptions')).toBe(false);
  });
});

describe('flag on: every offered option is a proven, resolved reading', () => {
  it('an ambiguous region becomes one chip per competing code', async () => {
    const response = await clarify(AMBIGUOUS_UTRECHT, true);
    const clickOptions = response.pending.clickOptions ?? [];
    expect(clickOptions).toHaveLength(2);
    // The label a chip fills the input with must be BYTE-EQUAL to the option
    // it decorates — the deterministic rung matches on exactly that string.
    expect(clickOptions.map((o) => o.label)).toEqual(
      response.options.filter((o) => clickOptions.some((c) => c.label === o)),
    );
    expect(response.suggestions).toEqual(clickOptions.map((o) => o.label));
    // Each carries the FULL intent, with the region pinned to its own code and
    // the rest of the question (measure, period) resolved identically.
    const regions = clickOptions.map((o) => o.intent.regions?.[0]);
    expect(regions).toContain('GM0344');
    expect(regions).toContain('PV26');
    for (const option of clickOptions) {
      expect(option.intent.target).toEqual({ kind: 'canonical', key: 'population_on_1_january' });
      expect(option.intent.period).toEqual({ kind: 'codes', codes: ['2024JJ00'] });
    }
  });

  it('a doubted single reading (rule 3) becomes one confirm-chip', async () => {
    const response = await clarify(
      rawDataQuery({
        canonicalKey: 'population_on_1_january',
        regions: [{ name: 'Amsterdam', kind: 'gemeente' }],
        period: { kind: 'year', year: 2024 },
        derivation: 'none',
        // Below the 0.9 answer threshold ⇒ rule 3 confirms instead of answering.
        confidence: 0.7,
        reading: 'bevolking van Amsterdam in 2024',
      }),
      true,
    );
    const clickOptions = response.pending.clickOptions ?? [];
    expect(clickOptions).toHaveLength(1);
    expect(clickOptions[0]!.label).toBe(response.options[0]);
    expect(clickOptions[0]!.intent.regions).toEqual(['GM0363']);
  });

  it('two competing readings (rule 4) each become a chip — the measured dead-end class', async () => {
    const response = await clarify(
      rawDataQuery(
        {
          canonicalKey: 'population_on_1_january',
          regions: [{ name: 'Utrecht', kind: 'gemeente' }],
          period: { kind: 'year', year: 2024 },
          derivation: 'none',
          confidence: 0.95,
          reading: 'bevolking van de gemeente Utrecht in 2024',
        },
        {
          canonicalKey: 'population_on_1_january',
          regions: [{ name: 'Amsterdam', kind: 'gemeente' }],
          period: { kind: 'year', year: 2024 },
          derivation: 'none',
          confidence: 0.6,
          reading: 'bevolking van Amsterdam in 2024',
        },
      ),
      true,
    );
    const clickOptions = response.pending.clickOptions ?? [];
    expect(clickOptions).toHaveLength(2);
    expect(clickOptions.map((o) => o.label)).toEqual(response.options);
    expect(clickOptions.map((o) => o.intent.regions?.[0])).toEqual(['GM0344', 'GM0363']);
  });

  it('offers no region chip when the question named OTHER regions too', async () => {
    // Review finding (session 56): resolveRegions returns on the first
    // ambiguous term, discarding the codes it already resolved — so an option
    // intent built from the ambiguous code alone would answer about Utrecht
    // and silently drop Amsterdam. No chip: the reply falls through to the
    // merge, which still sees the whole original question.
    const response = await clarify(
      rawDataQuery({
        canonicalKey: 'population_on_1_january',
        regions: [
          { name: 'Amsterdam', kind: 'gemeente' },
          { name: 'Utrecht', kind: 'onbekend' },
        ],
        period: { kind: 'year', year: 2024 },
        derivation: 'none',
        confidence: 0.95,
        reading: 'bevolking van Amsterdam en Utrecht in 2024',
      }),
      true,
    );
    expect(response.options).toContain('Utrecht (gemeente)');
    expect(response.pending.clickOptions ?? []).toEqual([]);
    expect(Object.hasOwn(response, 'suggestions')).toBe(false);
  });

  it('a FOLLOW-UP region ambiguity offers chips too — the second call site', async () => {
    // #176 threaded clickOptionsEnabled into resolveCandidate from BOTH
    // parse.ts and followup.ts. Only parse.ts was covered here, and the way
    // this fails is silent: forget the follow-up call site and the resolver
    // never builds the intents, so policy.ts finds nothing to offer and the
    // clarification renders perfectly — minus its chips. Nothing throws.
    const context: ConversationContext = {
      version: CONTEXT_VERSION,
      topicKey: 'population_on_1_january',
      regions: [{ name: 'Amsterdam', kind: 'gemeente' }],
      period: { kind: 'year', year: 2024 },
      derivation: 'none',
    };
    const outcome = await parseFollowUpQuestion(
      db,
      context,
      'En Utrecht?',
      {
        client: new CannedClient(AMBIGUOUS_UTRECHT),
        referenceDate: REFERENCE_DATE,
        clickOptionsEnabled: true,
      },
    );
    if (outcome.kind !== 'clarification') {
      throw new Error(`expected a clarification, got ${outcome.kind}`);
    }
    const regions = (outcome.clickOptions ?? []).map((o) => o.intent.regions?.[0]);
    expect(regions).toContain('GM0344');
    expect(regions).toContain('PV26');
  });

  it("a 'max' derivation on an ambiguous region still yields no chips", async () => {
    // A GUARD, not a proof — it passes with the #176 gate removed too, because
    // regionOptionIntents early-outs on 'max' on its own (resolve.ts:932): a
    // comparison needs several regions, so one-code-per-option intents would
    // answer a question nobody asked. Kept because the #176 gate now sits
    // directly above that early-out and a future edit could swallow it.
    const response = await clarify(
      rawDataQuery({
        canonicalKey: 'population_on_1_january',
        regions: [{ name: 'Utrecht', kind: 'onbekend' }],
        period: { kind: 'year', year: 2024 },
        derivation: 'max',
        confidence: 0.95,
        reading: 'gemeente met de meeste inwoners in 2024',
      }),
      true,
    );
    expect(response.options).toContain('Utrecht (gemeente)');
    expect(response.pending.clickOptions ?? []).toEqual([]);
    expect(Object.hasOwn(response, 'suggestions')).toBe(false);
  });

  it('an unservable reading is NEVER offered as a chip (the dead-end guarantee)', async () => {
    // 1850 exists in no loaded slice: the reading resolves, but the dry-run
    // refuses — so the option stays plain text and no chip promises an answer.
    const response = await clarify(
      rawDataQuery({
        canonicalKey: 'population_on_1_january',
        regions: [{ name: 'Amsterdam', kind: 'gemeente' }],
        period: { kind: 'year', year: 1850 },
        derivation: 'none',
        confidence: 0.7,
        reading: 'bevolking van Amsterdam in 1850',
      }),
      true,
    );
    expect(response.pending.clickOptions ?? []).toEqual([]);
    expect(Object.hasOwn(response, 'suggestions')).toBe(false);
  });
});

describe('the take-path resolves without any LLM call', () => {
  async function offeredPending(): Promise<PendingClarification> {
    return (await clarify(AMBIGUOUS_UTRECHT, true)).pending;
  }

  it('a reply byte-equal to an offered label answers from the stored intent', async () => {
    const pending = await offeredPending();
    const gemeente = (pending.clickOptions ?? []).find((o) => o.intent.regions?.[0] === 'GM0344')!;
    // BOTH clients throw: any model call on this path fails the test.
    const response = await respondToClarificationReply(db, pending, gemeente.label, {
      intentClient: new ThrowingClient(),
      answerClient: new ThrowingClient(),
      referenceDate: REFERENCE_DATE,
      clickOptionsEnabled: true,
    });
    expect(response.kind).toBe('answer');
    if (response.kind !== 'answer') throw new Error('unreachable');
    // The reading the user picked is the one that ran.
    expect(response.result.intent.regions).toEqual(['GM0344']);
    // ADR 024: composed by the deterministic template rung, valid by
    // construction — and recorded as such for R8.
    expect(response.answer.source).toBe('template');
    expect(response.answer.model).toBeNull();
    expect(response.answer.validation.ok).toBe(true);
    expect(response.parse.model).toBe(CLICK_TAKE_MODEL);
    expect(response.parse.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('surrounding whitespace still matches; a different reply does not', async () => {
    const pending = await offeredPending();
    const provincie = (pending.clickOptions ?? []).find((o) => o.intent.regions?.[0] === 'PV26')!;
    const padded = await respondToClarificationReply(db, pending, `  ${provincie.label}  `, {
      intentClient: new ThrowingClient(),
      answerClient: new ThrowingClient(),
      referenceDate: REFERENCE_DATE,
      clickOptionsEnabled: true,
    });
    expect(padded.kind).toBe('answer');
    if (padded.kind !== 'answer') throw new Error('unreachable');
    expect(padded.result.intent.regions).toEqual(['PV26']);

    // Free text near-but-not-equal must NOT be snapped onto an option: it goes
    // to the normal LLM merge, which here is a throwing client ⇒ the honest
    // internal refusal. That the rung did not swallow it is the point.
    const freeText = await respondToClarificationReply(db, pending, 'Utrecht (gemeen)', {
      intentClient: new ThrowingClient(),
      answerClient: new ThrowingClient(),
      referenceDate: REFERENCE_DATE,
      clickOptionsEnabled: true,
    });
    expect(freeText.kind).toBe('refusal');
    if (freeText.kind !== 'refusal') throw new Error('unreachable');
    expect(freeText.reason).toBe('internal');
  });

  it('with the flag off the same pending falls through to the LLM merge', async () => {
    const pending = await offeredPending();
    const gemeente = (pending.clickOptions ?? []).find((o) => o.intent.regions?.[0] === 'GM0344')!;
    const response = await respondToClarificationReply(db, pending, gemeente.label, {
      intentClient: new ThrowingClient(),
      answerClient: new ThrowingClient(),
      referenceDate: REFERENCE_DATE,
    });
    expect(response.kind).toBe('refusal');
    if (response.kind !== 'refusal') throw new Error('unreachable');
    expect(response.reason).toBe('internal');
  });

  it('an option whose data moved between offer and click refuses honestly', async () => {
    // The offer-then-sync drift case (brief §8 (v)): the take re-runs the REAL
    // query rather than replaying a promise, so an intent that no longer
    // serves produces an honest refusal — not a stale number, not a crash.
    const stale: ClickOption = {
      id: 'opt-1',
      label: 'bevolking van Amsterdam in 1850',
      intent: {
        schemaVersion: 1,
        target: { kind: 'canonical', key: 'population_on_1_january' },
        regions: ['GM0363'],
        period: { kind: 'codes', codes: ['1850JJ00'] },
        derivation: 'none',
      },
      impliedRecency: false,
    };
    const pending: PendingClarification = {
      version: 1,
      question: 'Hoeveel inwoners had Amsterdam?',
      referenceDate: REFERENCE_DATE,
      axes: ['period'],
      questionNl: 'Welke periode bedoel je?',
      options: [stale.label],
      clickOptions: [stale],
    };
    const response = await respondToClarificationReply(db, pending, stale.label, {
      intentClient: new ThrowingClient(),
      answerClient: new ThrowingClient(),
      referenceDate: REFERENCE_DATE,
      clickOptionsEnabled: true,
    });
    expect(response.kind).toBe('refusal');
    if (response.kind !== 'refusal') throw new Error('unreachable');
    // An honest, TYPED data refusal — not the catch-all internal one, and not
    // an answer. (Its text may name a period boundary: period codes and years
    // are not data values, per the #37 policy.)
    expect(['outside_loaded_slice', 'not_published', 'freshness', 'no_data']).toContain(
      response.reason,
    );
    expect(response.queryRefusal).not.toBeNull();
  });
});

describe('the client-held payload is untrusted', () => {
  const valid: ClickOption = {
    id: 'opt-1',
    label: 'bevolking van Amsterdam in 2024',
    intent: {
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'population_on_1_january' },
      regions: ['GM0363'],
      period: { kind: 'codes', codes: ['2024JJ00'] },
      derivation: 'none',
    },
    impliedRecency: false,
  };

  it('keeps a well-formed option', () => {
    expect(validateClickOptions([valid])).toEqual([valid]);
  });

  it('drops forgeries the parser could never have produced', () => {
    const forged = [
      // An 'explicit' target names a table+measure directly — the one shape
      // that could reach data the parser would never choose.
      { ...valid, intent: { ...valid.intent, target: { kind: 'explicit', tableId: '03759ned', measure: 'x' } } },
      // A canonical key outside the registry.
      { ...valid, intent: { ...valid.intent, target: { kind: 'canonical', key: 'nonexistent_measure' } } },
      // A period code that is not a CBS code.
      { ...valid, intent: { ...valid.intent, period: { kind: 'codes', codes: ["2024JJ00' or 1=1"] } } },
      // Extra fields, wrong types, missing fields.
      { ...valid, extra: 'smuggled' },
      { ...valid, impliedRecency: 'yes' },
      { id: 'opt-9', label: 'no intent' },
      'not an object',
      null,
    ];
    for (const entry of forged) {
      expect(validateClickOptions([entry])).toEqual([]);
    }
    expect(validateClickOptions('not an array')).toEqual([]);
    expect(validateClickOptions(undefined)).toEqual([]);
  });

  it('bounds how many options it will walk', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ ...valid, id: `opt-${i}` }));
    expect(validateClickOptions(many)).toHaveLength(MAX_CLICK_OPTIONS);
  });

  it('strips the key entirely when nothing survives (pre-WP26 field set)', () => {
    const pending = {
      version: 1,
      question: 'q',
      referenceDate: REFERENCE_DATE,
      axes: ['region'],
      questionNl: 'welke regio?',
      options: ['a'],
      clickOptions: [{ id: 'x', label: 'a' }],
    } as unknown as PendingClarification;
    const cleaned = withValidatedClickOptions(pending);
    expect(Object.hasOwn(cleaned, 'clickOptions')).toBe(false);
    expect(cleaned.options).toEqual(['a']);
  });
});
