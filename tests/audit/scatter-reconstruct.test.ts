// Two-measure scatter (spec 2026-09-27 D10, #296 part 2 Task 4): R8 for the
// scatter answer. The row is written through the REAL audited click-take
// entry (answerClarificationReplyAudited over a chip-carrier pending whose one
// option is the pair intent — the spec D1 doorway), then reconstructed from
// the stored row alone.
//
// What this pins:
//  - the audited intent is the FULL pair intent (with `pairWith`), so the
//    intent hash differs from the one-measure answer's; both tables are listed;
//  - the row reconstructs clean: the scatter spec re-derives from the stored
//    `result` + `pairedResult`, and body / coverage line / text byte-match;
//  - tampering with a plotted value, the coverage line, or dropping the x leg
//    each reconstructs with a divergence;
//  - no English translation is attempted for a scatter answer, even for an
//    English reader (English is derived at render time, spec D7) — the
//    injected translate client throws if reached.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import {
  answerClarificationReplyAudited,
  loadAuditRecord,
  reconstructionReport,
} from '../../src/answer/audit/index.ts';
import type { AuditRecord } from '../../src/answer/audit/types.ts';
import type { AnswerResponse, PendingClarification } from '../../src/answer/respond/types.ts';
import { CHIP_CARRIER_QUESTION_NL } from '../../src/answer/respond/respond.ts';
import type { LlmClient, LlmResponse } from '../../src/answer/llm/client.ts';
import { intentHash } from '../../src/answer/audit/write.ts';
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
const LABEL = 'Zet af tegen bevolking op 1 januari';

class CountingThrowingClient implements LlmClient {
  calls = 0;
  async complete(): Promise<LlmResponse> {
    this.calls += 1;
    throw new Error('LLM call attempted on the deterministic scatter path');
  }
}

const PAIR_INTENT: StructuredIntent = {
  schemaVersion: 1,
  target: { kind: 'canonical', key: 'average_home_sale_price_by_gemeente' },
  regionSet: { kind: 'all_provincies' },
  period: { kind: 'codes', codes: ['2024JJ00'] },
  derivation: 'none',
  pairWith: { kind: 'canonical', key: 'population_on_1_january' },
};

/** The chip carrier a region-set answer mints (Task 5 will mint it for real):
 * one takeable option whose intent is the pair intent. */
const PENDING: PendingClarification = {
  version: 1,
  question: 'Gemiddelde verkoopprijs per provincie in 2024',
  referenceDate: REFERENCE_DATE,
  axes: ['measure'],
  questionNl: CHIP_CARRIER_QUESTION_NL,
  options: [LABEL],
  clickOptions: [{ id: 'opt-1', label: LABEL, intent: PAIR_INTENT, impliedRecency: false }],
  rescueOnly: true,
};

let stored: AuditRecord;
let intentClient: CountingThrowingClient;
let answerClient: CountingThrowingClient;
let translateClient: CountingThrowingClient;

function clone(record: AuditRecord): AuditRecord {
  return JSON.parse(JSON.stringify(record)) as AuditRecord;
}

describe('the audited scatter take writes a row that reconstructs (R8)', () => {
  beforeAll(async () => {
    intentClient = new CountingThrowingClient();
    answerClient = new CountingThrowingClient();
    translateClient = new CountingThrowingClient();
    const outcome = await answerClarificationReplyAudited(db, PENDING, LABEL, {
      intentClient,
      answerClient,
      referenceDate: REFERENCE_DATE,
      clickOptionsEnabled: true,
      sourceTag: 'validation',
      lang: 'en',
      translateClient,
    });
    if (outcome.response.kind !== 'answer') {
      throw new Error(`expected a scatter answer, got ${outcome.response.kind}: ${outcome.response.text}`);
    }
    expect(outcome.auditId).not.toBeNull();
    const record = await loadAuditRecord(db, outcome.auditId!);
    if (record === null) throw new Error('audit row missing');
    stored = record;
  }, 120_000);

  it('no LLM call of any role — parse, compose or translate — and no English rendering', () => {
    expect(intentClient.calls).toBe(0);
    expect(answerClient.calls).toBe(0);
    expect(translateClient.calls).toBe(0);
    expect(stored.llmCalls).toEqual([]);
    expect('english' in stored.response).toBe(false);
  });

  it('records the full pair intent and both tables', () => {
    const response = stored.response as AnswerResponse;
    const intent = stored.intent as StructuredIntent;
    expect(intent.pairWith).toEqual({ kind: 'canonical', key: 'population_on_1_january' });
    expect(stored.intentHash).toBe(intentHash(intent));
    expect(stored.intentHash).not.toBe(intentHash(response.result.intent));
    expect(stored.tables.map((t) => t.tableId)).toEqual(['83625NED', '03759ned']);
    expect(stored.tableIds).toEqual(['83625NED', '03759ned']);
    expect(stored.resultIds).toEqual([
      ...response.result.cells.map((c) => c.resultId),
      ...response.pairedResult!.cells.map((c) => c.resultId),
    ]);
    expect(stored.answerSource).toBe('template');
    expect(stored.chartEmitted).toBe(false);
  });

  it('reconstructs clean from the stored row alone', () => {
    expect(reconstructionReport(stored).problems).toEqual([]);
  });

  it('a tampered plotted value diverges', () => {
    const record = clone(stored);
    (record.response as AnswerResponse).scatter!.points[0]!.y += 1;
    const report = reconstructionReport(record);
    expect(report.ok).toBe(false);
    expect(report.problems).toContain('scatter spec does not re-derive from the stored results');
  });

  it('a tampered coverage line diverges', () => {
    const record = clone(stored);
    const answer = (record.response as AnswerResponse).answer;
    answer.scatterLine = `${answer.scatterLine} (bewerkt)`;
    const report = reconstructionReport(record);
    expect(report.ok).toBe(false);
    expect(report.problems).toContain('scatter coverage line does not re-derive from the stored results');
  });

  it('dropping the x leg diverges', () => {
    const record = clone(stored);
    delete (record.response as AnswerResponse).pairedResult;
    const report = reconstructionReport(record);
    expect(report.ok).toBe(false);
    expect(report.problems).toContain('a scatter answer must carry both scatter and pairedResult');
  });

  it('dropping the scatter spec (keeping the x leg) diverges', () => {
    const record = clone(stored);
    delete (record.response as AnswerResponse).scatter;
    const report = reconstructionReport(record);
    expect(report.ok).toBe(false);
    expect(report.problems).toContain('a scatter answer must carry both scatter and pairedResult');
  });

  it('a tampered x-measure definition line diverges', () => {
    const record = clone(stored);
    const answer = (record.response as AnswerResponse).answer;
    expect(answer.pairedDefinitionLine).toMatch(/^Definitie: /);
    answer.pairedDefinitionLine = 'Definitie: iets anders.';
    const report = reconstructionReport(record);
    expect(report.ok).toBe(false);
    expect(report.problems).toContain('paired definition line does not re-derive from the stored x-leg attribution');
  });

  it('x leg over a different region class diverges (the pair precondition, re-checked on the stored legs)', () => {
    const record = clone(stored);
    const paired = (record.response as AnswerResponse).pairedResult!;
    paired.regionSet = { ...paired.regionSet!, scope: { kind: 'all_landsdelen' } };
    const report = reconstructionReport(record);
    expect(report.ok).toBe(false);
    expect(report.problems).toContain('the two scatter legs do not share one region class');
  });

  it('a tampered body diverges', () => {
    const record = clone(stored);
    const answer = (record.response as AnswerResponse).answer;
    answer.body = answer.body.replace('niet dat het ene het andere veroorzaakt', 'en het ene veroorzaakt het andere');
    const report = reconstructionReport(record);
    expect(report.ok).toBe(false);
    expect(report.problems).toContain('scatter body does not re-derive from the stored results');
  });
});

describe('an audited pair-leg refusal records the pair it was asked as', () => {
  it('x leg refuses (2017JJ00): the stored intent is the pair, the text names the x measure, no chips, reconstructs clean', async () => {
    const label = 'Zet af tegen bevolking op 1 januari (2017)';
    const pairIntent: StructuredIntent = { ...PAIR_INTENT, period: { kind: 'codes', codes: ['2017JJ00'] } };
    const pending: PendingClarification = {
      ...PENDING,
      options: [label],
      clickOptions: [{ id: 'opt-1', label, intent: pairIntent, impliedRecency: false }],
    };
    const outcome = await answerClarificationReplyAudited(db, pending, label, {
      intentClient: new CountingThrowingClient(),
      answerClient: new CountingThrowingClient(),
      referenceDate: REFERENCE_DATE,
      clickOptionsEnabled: true,
      sourceTag: 'validation',
    });
    expect(outcome.response.kind).toBe('refusal');
    if (outcome.response.kind !== 'refusal') return;
    expect(outcome.response.reason).toBe('outside_loaded_slice');
    expect(outcome.response.text).toContain('bevolking op 1 januari');
    expect(outcome.response.suggestions ?? []).toEqual([]);
    const record = await loadAuditRecord(db, outcome.auditId!);
    if (record === null) throw new Error('audit row missing');
    expect(record.intent).toEqual(pairIntent);
    expect(record.intentHash).toBe(intentHash(pairIntent));
    expect(reconstructionReport(record).problems).toEqual([]);
  });
});
