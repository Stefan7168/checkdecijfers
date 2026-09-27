// Two-measure scatter (spec 2026-09-27, #296 part 2 Task 4): the template-only
// scatter ANSWER out of respondToIntent — the one seam both public entry
// points (and the zero-LLM click take) funnel into.
//
// What this pins:
//  - a pair intent answers as a scatter: `chart: null`, a `scatter` spec with
//    one point per paired region, the x leg as `pairedResult`, the Dutch body
//    and coverage line from the SAME pure builders the audit re-derives with
//    (R8), both tables' attribution sentences in the text, no chips;
//  - NO LLM call anywhere on the path (the injected client counts and throws);
//  - a leg that refuses refuses the pair — never a one-measure answer;
//  - staleness runs on BOTH legs: warn-and-serve joins both warnings, and a
//    recency-implying question refuses when either leg is stale.
//
// Hermetic: fixture-ingested PGlite (ADR 009) + a hand-built intent
// ParseOutcome (the parser never emits `pairWith`; the doorway is a click
// chip, spec D1).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { respondToIntent } from '../../src/answer/respond/respond.ts';
import type { ParseOutcome } from '../../src/answer/intent/types.ts';
import type { LlmClient, LlmResponse } from '../../src/answer/llm/client.ts';
import { scatterBodyNl, scatterLineNl } from '../../src/chart/scatter-text.ts';
import { buildAttributionLine } from '../../src/answer/compose/format.ts';
import type { StructuredIntent } from '../../src/query/index.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

const REFERENCE_DATE = '2026-08-15';
/** Far past every fixture table's yearly cadence (549 days) — both legs stale. */
const STALE_REFERENCE_DATE = '2031-01-01';

/** Counts every call and fails it — the scatter path must never reach a model. */
class CountingThrowingClient implements LlmClient {
  calls = 0;
  async complete(): Promise<LlmResponse> {
    this.calls += 1;
    throw new Error('the scatter answer path must never call an LLM');
  }
}

function pairIntent(period = '2024JJ00'): StructuredIntent {
  return {
    schemaVersion: 1,
    target: { kind: 'canonical', key: 'average_home_sale_price_by_gemeente' },
    regionSet: { kind: 'all_provincies' },
    period: { kind: 'codes', codes: [period] },
    derivation: 'none',
    pairWith: { kind: 'canonical', key: 'population_on_1_january' },
  };
}

function stubIntent(
  question: string,
  intent: StructuredIntent,
  impliedRecency = false,
): Extract<ParseOutcome, { kind: 'intent' }> {
  return {
    kind: 'intent',
    question,
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
    impliedRecency,
    ranked: [],
  };
}

const QUESTION = 'Gemiddelde verkoopprijs per provincie in 2024';

describe('respondToIntent — a pair intent answers as a template-only scatter', () => {
  it('provinces 2024: scatter of 12 points, x leg = population (03759ned), no chart, no chips, no LLM call', async () => {
    const client = new CountingThrowingClient();
    const response = await respondToIntent(db, QUESTION, stubIntent(QUESTION, pairIntent()), {
      answerClient: client,
      referenceDate: REFERENCE_DATE,
      clickOptionsEnabled: true,
    });
    if (response.kind !== 'answer') throw new Error(`expected an answer, got ${response.kind}: ${response.text}`);
    expect(client.calls).toBe(0);

    expect(response.chart).toBeNull();
    expect(response.chartAlternates).toEqual([]);
    expect(response.suggestions).toEqual([]);
    expect('pending' in response).toBe(false);
    expect('english' in response).toBe(false);

    const scatter = response.scatter;
    const paired = response.pairedResult;
    if (scatter === undefined || paired === undefined) throw new Error('expected scatter + pairedResult');
    expect(scatter.points).toHaveLength(12);
    expect(response.result.attribution.tableId).toBe('83625NED');
    expect(paired.attribution.tableId).toBe('03759ned');

    const answer = response.answer;
    expect(answer.source).toBe('template');
    expect(answer.model).toBeNull();
    expect(answer.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(answer.attempts).toEqual([]);
    expect(answer.validation).toEqual({ ok: true, problems: [] });
    expect(answer.body).toBe(scatterBodyNl(scatter));
    expect(answer.scatterLine).toBe(scatterLineNl(scatter));
    expect(answer.definitionLine).toBeNull();
    expect(answer.markingLine).toBeNull();
    expect(answer.attributionLine).toBe(buildAttributionLine(response.result));

    // Both tables' R4 sentences, y first, after the coverage line — the
    // compose.ts assemble() join (body, blank line, structural lines, one per line).
    const yAttribution = buildAttributionLine(response.result);
    const xAttribution = buildAttributionLine(paired);
    expect(answer.text).toBe([answer.body, '', answer.scatterLine, yAttribution, xAttribution].join('\n'));
    expect(response.text).toContain(yAttribution);
    expect(response.text).toContain(xAttribution);
    expect(response.stalenessWarning).toBeNull();
    expect(response.text).toBe(answer.text);
  });

  it('a pair with a leg that refuses (2026JJ00: only 03759ned has it) is a refusal, not a one-measure answer', async () => {
    const client = new CountingThrowingClient();
    const response = await respondToIntent(db, QUESTION, stubIntent(QUESTION, pairIntent('2026JJ00')), {
      answerClient: client,
      referenceDate: REFERENCE_DATE,
    });
    expect(response.kind).toBe('refusal');
    if (response.kind !== 'refusal') return;
    expect(response.queryRefusal?.intent.pairWith).toEqual({ kind: 'canonical', key: 'population_on_1_january' });
    // The LEG's own refusal (re-pinned to the pair intent) — not runQuery's
    // blanket invalid_intent for a paired intent it never answers.
    expect(response.queryRefusal?.refusal.kind).not.toBe('invalid_intent');
    expect(client.calls).toBe(0);
  });

  it('both legs stale, historical question: warn-and-serve with both legs\' warnings, y first', async () => {
    const response = await respondToIntent(db, QUESTION, stubIntent(QUESTION, pairIntent()), {
      answerClient: new CountingThrowingClient(),
      referenceDate: STALE_REFERENCE_DATE,
    });
    if (response.kind !== 'answer') throw new Error(`expected an answer, got ${response.kind}: ${response.text}`);
    const warning = response.stalenessWarning;
    expect(warning).not.toBeNull();
    const parts = warning!.split('\n');
    expect(parts).toHaveLength(2);
    for (const part of parts) expect(part.startsWith('Let op: deze tabel')).toBe(true);
    expect(response.text).toBe(`${response.answer.text}\n\n${warning}`);
  });

  it('a stale leg under a recency-implying question refuses (staleness), exactly like the one-measure path', async () => {
    const response = await respondToIntent(db, QUESTION, stubIntent(QUESTION, pairIntent(), true), {
      answerClient: new CountingThrowingClient(),
      referenceDate: STALE_REFERENCE_DATE,
    });
    expect(response.kind).toBe('refusal');
    if (response.kind !== 'refusal') return;
    expect(response.reason).toBe('staleness');
  });
});
