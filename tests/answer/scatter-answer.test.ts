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
import { buildAttributionLine, buildDefinitionLine } from '../../src/answer/compose/format.ts';
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
    // docs/05: both measures' chosen definitions are stated, y first.
    const yDefinition = buildDefinitionLine(response.result);
    const xDefinition = buildDefinitionLine(paired);
    expect(yDefinition).not.toBeNull();
    expect(xDefinition).not.toBeNull();
    expect(answer.definitionLine).toBe(yDefinition);
    expect(answer.pairedDefinitionLine).toBe(xDefinition);
    expect('alternatesLine' in answer).toBe(false);
    expect(answer.markingLine).toBeNull();
    expect(answer.attributionLine).toBe(buildAttributionLine(response.result));

    // The compose.ts assemble() join (body, blank line, structural lines one
    // per line): coverage, the two definitions, then both tables' R4
    // sentences — y first each time.
    const yAttribution = buildAttributionLine(response.result);
    const xAttribution = buildAttributionLine(paired);
    expect(answer.text).toBe(
      [answer.body, '', answer.scatterLine, yDefinition, xDefinition, yAttribution, xAttribution].join('\n'),
    );
    expect(response.text).toContain(yAttribution);
    expect(response.text).toContain(xAttribution);
    expect(response.stalenessWarning).toBeNull();
    expect(response.text).toBe(answer.text);
  });

  it('the y leg refuses (2026JJ00: only 03759ned has it) — the leg\'s own no_data refusal, not a one-measure answer', async () => {
    const client = new CountingThrowingClient();
    const response = await respondToIntent(db, QUESTION, stubIntent(QUESTION, pairIntent('2026JJ00')), {
      answerClient: client,
      referenceDate: REFERENCE_DATE,
      clickOptionsEnabled: true,
    });
    expect(response.kind).toBe('refusal');
    if (response.kind !== 'refusal') return;
    expect(response.queryRefusal?.refusal.kind).toBe('no_data');
    expect(response.reason).toBe('internal');
    expect(response.queryRefusal?.intent.target).toEqual({ kind: 'canonical', key: 'average_home_sale_price_by_gemeente' });
    expect(response.queryRefusal?.pairedFrom?.pairWith).toEqual({ kind: 'canonical', key: 'population_on_1_january' });
    expect(response.suggestions).toEqual([]);
    expect('pending' in response).toBe(false);
    expect(client.calls).toBe(0);
  });

  it('the x leg refuses (2017JJ00: before 03759ned\'s loaded slice) — worded about the x measure, with no retry chip', async () => {
    const client = new CountingThrowingClient();
    const response = await respondToIntent(db, QUESTION, stubIntent(QUESTION, pairIntent('2017JJ00')), {
      answerClient: client,
      referenceDate: REFERENCE_DATE,
      clickOptionsEnabled: true,
    });
    expect(response.kind).toBe('refusal');
    if (response.kind !== 'refusal') return;
    expect(response.queryRefusal?.refusal.kind).toBe('outside_loaded_slice');
    expect(response.reason).toBe('outside_loaded_slice');
    // The refusal names the measure that has no figure (population), never the
    // y measure that does.
    expect(response.text).toContain('bevolking op 1 januari');
    expect(response.text).not.toContain('verkoopprijs');
    expect(response.queryRefusal?.intent.target).toEqual({ kind: 'canonical', key: 'population_on_1_january' });
    expect(response.queryRefusal?.pairedFrom?.pairWith).toEqual({ kind: 'canonical', key: 'population_on_1_january' });
    // A one-measure retry chip would silently drop the pairing.
    expect(response.suggestions).toEqual([]);
    expect('pending' in response).toBe(false);
    expect(client.calls).toBe(0);
  });

  it('both legs stale, historical question: warn-and-serve, one line per leg, each naming its own table (y first)', async () => {
    const response = await respondToIntent(db, QUESTION, stubIntent(QUESTION, pairIntent()), {
      answerClient: new CountingThrowingClient(),
      referenceDate: STALE_REFERENCE_DATE,
    });
    if (response.kind !== 'answer') throw new Error(`expected an answer, got ${response.kind}: ${response.text}`);
    const warning = response.stalenessWarning;
    expect(warning).not.toBeNull();
    const parts = warning!.split('\n');
    expect(parts).toHaveLength(2);
    expect(parts[0]!.startsWith('Let op: de tabel 83625NED (')).toBe(true);
    expect(parts[1]!.startsWith('Let op: de tabel 03759ned (')).toBe(true);
    for (const part of parts) {
      expect(part).toContain(' wordt normaal jaarlijks bijgewerkt door CBS, ');
      expect(part).not.toContain('deze tabel');
    }
    expect(response.text).toBe(`${response.answer.text}\n\n${warning}`);
  });

  it('a stale leg under a recency-implying question refuses (staleness), naming the stale table', async () => {
    const response = await respondToIntent(db, QUESTION, stubIntent(QUESTION, pairIntent(), true), {
      answerClient: new CountingThrowingClient(),
      referenceDate: STALE_REFERENCE_DATE,
      lang: 'en',
    });
    expect(response.kind).toBe('refusal');
    if (response.kind !== 'refusal') return;
    expect(response.reason).toBe('staleness');
    expect(response.text.startsWith('De cijfers van de tabel 83625NED (')).toBe(true);
    expect(response.english?.text.startsWith('The figures of table 83625NED (')).toBe(true);
  });

  describe('only ONE leg stale (03759ned carries no recognised cadence here)', () => {
    beforeAll(async () => {
      await db.query(`update cbs_tables set update_cadence = null where id = '03759ned'`);
    });
    afterAll(async () => {
      await db.query(`update cbs_tables set update_cadence = 'yearly (next CBS update Q2 2027)' where id = '03759ned'`);
    });

    it('warn-and-serve names that table only', async () => {
      const response = await respondToIntent(db, QUESTION, stubIntent(QUESTION, pairIntent()), {
        answerClient: new CountingThrowingClient(),
        referenceDate: STALE_REFERENCE_DATE,
      });
      if (response.kind !== 'answer') throw new Error(`expected an answer, got ${response.kind}: ${response.text}`);
      const warning = response.stalenessWarning!;
      expect(warning.split('\n')).toHaveLength(1);
      expect(warning.startsWith('Let op: de tabel 83625NED (')).toBe(true);
      expect(warning).not.toContain('03759ned');
    });
  });
});
