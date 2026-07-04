// WP9 clarification-reply regressions (adversarial review, 2026-07-03):
//
//  1. R7 end-to-end: a reply can NEVER produce a second clarification — not
//     even via the query layer's needs_clarification (the missing-region
//     check deliberately lives there, resolve.ts's pass-through policy, so
//     respondToClarificationReply must convert it to the still-ambiguous
//     refusal; the HIGH review finding showed it previously asked again).
//  2. Clock injection: parseClarificationReply resolves relative periods
//     against pending.referenceDate — a wall-clock regression previously
//     survived the whole suite.
//  3. toClarificationResponse purity: pending mirrors the envelope exactly.
//  4. Fail-closed catch-all: ANY error (thrown client, schema-garbage LLM
//     output) becomes an 'internal' refusal with the diagnostic in
//     internalNote — never a throw, never a partial answer.
//
// All hermetic: stub clients returning canned RawParse JSON — no fixtures,
// no network, no API key.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import {
  respondToClarificationReply,
  respondToQuestion,
  toClarificationResponse,
} from '../../src/answer/respond/index.ts';
import type { PendingClarification } from '../../src/answer/respond/index.ts';
import { parseClarificationReply } from '../../src/answer/intent/clarify.ts';
import type { LlmClient, LlmResponse } from '../../src/answer/llm/client.ts';
import type { ParseOutcome, RawParse } from '../../src/answer/intent/types.ts';

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

/** Returns one canned RawParse for every request — the parse the LLM would
 * have produced, minus the LLM. */
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
    throw new Error('boom: stubbed API failure');
  }
}

class GarbageClient implements LlmClient {
  async complete(): Promise<LlmResponse> {
    return { outputText: 'this is not json', model: 'stub', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
  }
}

function rawDataQuery(candidate: Record<string, unknown>): RawParse {
  return {
    version: 3,
    kind: 'data_query',
    candidates: [candidate as never],
    unmatchedMeasureTerm: null,
    nearestCanonicalKeys: [],
    note: null,
  };
}

const PENDING: PendingClarification = {
  version: 1,
  question: 'Hoeveel inwoners waren er in 2024?',
  referenceDate: '2026-08-15',
  axes: ['region'],
  questionNl: 'Kun je aangeven voor welke regio?',
  options: [],
};

function options(intentClient: LlmClient) {
  return { intentClient, answerClient: new ThrowingClient(), referenceDate: PENDING.referenceDate };
}

describe('R7: a reply never produces a second clarification', () => {
  it('query-level needs_clarification after a reply becomes the still-ambiguous refusal', async () => {
    // The merged parse is honest but STILL has no region on a geo canonical
    // measure — the intent layer passes through, runQuery says
    // needs_clarification, and the reply round must refuse-with-guidance.
    const client = new CannedClient(
      rawDataQuery({
        canonicalKey: 'population_on_1_january',
        regions: null,
        period: { kind: 'year', year: 2024 },
        derivation: 'none',
        confidence: 0.95,
        reading: 'bevolking in 2024, regio onbekend',
      }),
    );
    const response = await respondToClarificationReply(db, PENDING, 'in 2024', options(client));
    expect(response.kind).toBe('refusal');
    if (response.kind !== 'refusal') throw new Error('unreachable');
    expect(response.reason).toBe('still_ambiguous');
    expect(response.guidance).not.toBeNull();
    expect((response as unknown as { pending?: unknown }).pending).toBeUndefined();
  });

  it('the SAME parse on the first turn may legitimately clarify (the asymmetry is the rule)', async () => {
    const client = new CannedClient(
      rawDataQuery({
        canonicalKey: 'population_on_1_january',
        regions: null,
        period: { kind: 'year', year: 2024 },
        derivation: 'none',
        confidence: 0.95,
        reading: 'bevolking in 2024, regio onbekend',
      }),
    );
    const response = await respondToQuestion(db, PENDING.question, options(client));
    expect(response.kind).toBe('clarification');
    if (response.kind !== 'clarification') throw new Error('unreachable');
    expect(response.options.length).toBeGreaterThan(0); // docs/05: options resolve in loaded data
  });
});

describe('clock injection: relative periods resolve against pending.referenceDate', () => {
  it('"vorige maand" in a merged reply resolves from the PENDING reference date, never the wall clock', async () => {
    const client = new CannedClient(
      rawDataQuery({
        canonicalKey: 'cpi_yearly_inflation',
        regions: null,
        period: { kind: 'relative', unit: 'month', offset: -1 },
        derivation: 'none',
        confidence: 0.95,
        reading: 'inflatie vorige maand',
      }),
    );
    const outcome: ParseOutcome = await parseClarificationReply(db, PENDING, 'vorige maand', {
      client,
    });
    expect(outcome.kind).toBe('intent');
    if (outcome.kind !== 'intent') throw new Error('unreachable');
    // 2026-08-15 -> previous month 2026MM07. A wall-clock regression would
    // yield the month before the test's own run date instead.
    expect(outcome.intent.period).toEqual({ kind: 'codes', codes: ['2026MM07'] });
    expect(outcome.impliedRecency).toBe(true);
  });
});

describe('toClarificationResponse purity (pending mirrors the envelope)', () => {
  it('copies question/referenceDate/axes/questionNl/options into pending verbatim', () => {
    const parse = { kind: 'clarification' } as unknown as ParseOutcome; // audit payload, not read by the builder
    const envelope = toClarificationResponse({
      question: 'Q?',
      referenceDate: '2026-08-15',
      axes: ['region', 'period'],
      questionNl: 'Welke regio en periode?',
      options: ['a', 'b'],
      parse,
    });
    expect(envelope.text).toBe('Welke regio en periode?');
    expect(envelope.pending).toEqual({
      version: 1,
      question: 'Q?',
      referenceDate: '2026-08-15',
      axes: ['region', 'period'],
      questionNl: 'Welke regio en periode?',
      options: ['a', 'b'],
    });
    expect(envelope.axes).toEqual(envelope.pending.axes);
    expect(envelope.options).toEqual(envelope.pending.options);
    // Round-trips through JSON (the future chat UI persists it).
    expect(JSON.parse(JSON.stringify(envelope.pending))).toEqual(envelope.pending);
  });
});

describe('fail-closed catch-all (the pipeline never throws, never serves a partial answer)', () => {
  it('a throwing intent client -> internal refusal with the diagnostic in internalNote', async () => {
    const response = await respondToQuestion(db, 'Wat was de inflatie in 2024?', options(new ThrowingClient()));
    expect(response.kind).toBe('refusal');
    if (response.kind !== 'refusal') throw new Error('unreachable');
    expect(response.reason).toBe('internal');
    expect(response.internalNote).toContain('boom');
    expect(response.parse).toBeNull();
  });

  it('schema-garbage LLM output -> internal refusal noting RawParseValidationError', async () => {
    const response = await respondToQuestion(db, 'Wat was de inflatie in 2024?', options(new GarbageClient()));
    expect(response.kind).toBe('refusal');
    if (response.kind !== 'refusal') throw new Error('unreachable');
    expect(response.reason).toBe('internal');
    expect(response.internalNote).toContain('RawParseValidationError');
  });

  it('the reply entry point fails closed the same way', async () => {
    const response = await respondToClarificationReply(db, PENDING, 'Utrecht', options(new ThrowingClient()));
    expect(response.kind).toBe('refusal');
    if (response.kind !== 'refusal') throw new Error('unreachable');
    expect(response.reason).toBe('internal');
    expect(response.internalNote).toContain('boom');
  });
});
