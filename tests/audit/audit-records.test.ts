// WP10 done-criterion, hermetic: every produced response writes ONE
// audit_answers row that RECONSTRUCTS it (R8) — driven end-to-end through the
// audited entry points over the fixture-ingested PGlite database and replayed
// LLM fixtures. No API key, no network: exactly what CI runs.
//
// Invariants at stake: R8 (the record itself), R1/R4 re-verified FROM the
// record (reconstruct.ts re-runs the scan/attribution derivation on stored
// data alone), plus the ADR 015 wrap-site obligations (reply text, pending
// clarification, the three prompt-version constants) and the ADR 016
// fail-closed policy (an unrecorded answer is never shown).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReplayLlmClient, stableStringify } from '../../src/answer/llm/client.ts';
import { PROMPT_VERSION } from '../../src/answer/intent/prompt.ts';
import { CLARIFY_PROMPT_VERSION } from '../../src/answer/intent/clarify.ts';
import { COMPOSE_PROMPT_VERSION } from '../../src/answer/compose/prompt.ts';
import { FOLLOWUP_PROMPT_VERSION } from '../../src/answer/intent/followup.ts';
import {
  answerClarificationReplyAudited,
  answerQuestionAudited,
  intentHash,
  loadAllAuditRecords,
  loadAuditRecord,
  reconstructionReport,
  AUDIT_SCHEMA_VERSION,
} from '../../src/answer/audit/index.ts';
import type { AuditRecord, AuditedResponse } from '../../src/answer/audit/index.ts';
import type { StructuredIntent } from '../../src/query/index.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { ANSWERABLE_TASKS, REFUSAL_TASK_QUESTIONS } from '../helpers/benchmark-intents.ts';
import { checkComposedAnswer, loadAnswerKey } from '../helpers/answer-expectations.ts';
import { loadLabelledSet } from '../helpers/intent-expectations.ts';

const INTENT_FIXTURES = fileURLToPath(new URL('../fixtures/llm/intent', import.meta.url));
const ANSWER_FIXTURES = fileURLToPath(new URL('../fixtures/llm/answer', import.meta.url));
const CLARIFY_FIXTURES = fileURLToPath(new URL('../fixtures/llm/clarify', import.meta.url));

const labelledSet = loadLabelledSet();
const REFERENCE_DATE = labelledSet.referenceDate;
const answerKey = loadAnswerKey();

let db: Db;
let close: () => Promise<void>;

function respondOptions(referenceDate: string = REFERENCE_DATE) {
  return {
    intentClient: new ReplayLlmClient(INTENT_FIXTURES),
    answerClient: new ReplayLlmClient(ANSWER_FIXTURES),
    referenceDate,
  };
}

function clarifyReplyOptions(referenceDate: string = REFERENCE_DATE) {
  return {
    intentClient: new ReplayLlmClient(CLARIFY_FIXTURES),
    answerClient: new ReplayLlmClient(ANSWER_FIXTURES),
    referenceDate,
  };
}

/** A Db that rejects writes to audit_answers but passes everything else
 * through — the audit-failure probe for the ADR 016 fail-closed policy.
 * `failures` counts down: 1 = only the first audit insert fails. */
function withFailingAuditInserts(inner: Db, failures: number = Number.POSITIVE_INFINITY): Db {
  let remaining = failures;
  return {
    query(text: string, params?: unknown[]) {
      if (/insert into audit_answers/i.test(text) && remaining > 0) {
        remaining -= 1;
        return Promise.reject(new Error('injected audit-insert failure'));
      }
      return inner.query(text, params);
    },
    withTransaction: (fn) => inner.withTransaction(fn),
  };
}

async function mustLoad(id: number | null): Promise<AuditRecord> {
  expect(id).not.toBeNull();
  const record = await loadAuditRecord(db, id!);
  expect(record).not.toBeNull();
  return record!;
}

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

describe('answer flows write reconstructable records', () => {
  const flows = new Map<string, { audited: AuditedResponse; record: AuditRecord }>();

  beforeAll(async () => {
    for (const taskId of ['B1', 'B4', 'B13', 'B14']) {
      const audited = await answerQuestionAudited(
        db,
        ANSWERABLE_TASKS[taskId]!.question,
        respondOptions(),
      );
      flows.set(taskId, { audited, record: await mustLoad(audited.auditId) });
    }
  }, 300_000);

  it('every flow produced an answer with a non-null auditId', () => {
    for (const [taskId, { audited }] of flows) {
      expect(audited.response.kind, taskId).toBe('answer');
      expect(audited.auditId, taskId).not.toBeNull();
    }
  });

  it('the stored envelope round-trips byte-identically (jsonb in = envelope out)', () => {
    for (const [taskId, { audited, record }] of flows) {
      expect(stableStringify(record.response), taskId).toBe(stableStringify(audited.response));
    }
  });

  it('promoted columns match the envelope: final text, result ids, tables, kind, source', () => {
    for (const [taskId, { audited, record }] of flows) {
      if (audited.response.kind !== 'answer') throw new Error('unreachable');
      expect(record.kind, taskId).toBe('answer');
      expect(record.question, taskId).toBe(audited.response.question);
      expect(record.finalText, taskId).toBe(audited.response.text);
      expect(record.resultIds, taskId).toEqual(audited.response.result.cells.map((c) => c.resultId));
      expect(record.tableIds, taskId).toEqual([audited.response.result.attribution.tableId]);
      expect(record.tables, taskId).toEqual([
        {
          tableId: audited.response.result.attribution.tableId,
          tableVersion: audited.response.result.attribution.tableVersion,
          syncedAt: audited.response.result.attribution.syncedAt,
        },
      ]);
      expect(record.answerSource, taskId).toBe(audited.response.answer.source);
      expect(record.refusalReason, taskId).toBeNull();
      expect(record.schemaVersion, taskId).toBe(AUDIT_SCHEMA_VERSION);
      expect(record.userId, taskId).toBeNull();
      expect(record.referenceDate, taskId).toBe(REFERENCE_DATE);
      expect(record.replyText, taskId).toBeNull();
      expect(record.pendingClarification, taskId).toBeNull();
    }
  });

  it('intent + intent_hash: the stored intent is the envelope intent and the hash recomputes', () => {
    for (const [taskId, { audited, record }] of flows) {
      if (audited.response.kind !== 'answer') throw new Error('unreachable');
      expect(record.intent, taskId).toEqual(audited.response.result.intent);
      expect(record.intentHash, taskId).toBe(intentHash(record.intent as StructuredIntent));
    }
  });

  it('chart_emitted matches the envelope (B4 series charts, B1 single does not)', () => {
    expect(flows.get('B4')!.record.chartEmitted).toBe(true);
    expect(flows.get('B1')!.record.chartEmitted).toBe(false);
  });

  it('prompt versions record the four exported constants (ADR 015 obligation; followup since WP15/ADR 021)', () => {
    for (const [taskId, { record }] of flows) {
      expect(record.promptVersions, taskId).toEqual({
        intent: PROMPT_VERSION,
        clarify: CLARIFY_PROMPT_VERSION,
        compose: COMPOSE_PROMPT_VERSION,
        followup: FOLLOWUP_PROMPT_VERSION,
      });
    }
  });

  it('llm_calls record the intent + compose calls with model ids; totals sum them', () => {
    for (const [taskId, { audited, record }] of flows) {
      if (audited.response.kind !== 'answer') throw new Error('unreachable');
      const roles = record.llmCalls.map((c) => c.role);
      expect(roles, taskId).toContain('intent');
      expect(roles, taskId).toContain('compose');
      expect(roles, taskId).not.toContain('clarify');
      // Role↔call BINDING, not just set membership: each role's recorded
      // model must equal the model the envelope recorded independently for
      // that pipeline step (parse.model from WP6, answer.model from WP7) —
      // a tracker that swapped role labels would pass a contains-check but
      // fails this (mutation-probe finding, 2026-07-03).
      const intentCall = record.llmCalls.find((c) => c.role === 'intent')!;
      expect(intentCall.model, taskId).toBe(audited.response.parse.model);
      expect(intentCall.inputTokens, taskId).toBe(audited.response.parse.usage.inputTokens);
      expect(intentCall.outputTokens, taskId).toBe(audited.response.parse.usage.outputTokens);
      if (audited.response.answer.model !== null) {
        const composeCall = record.llmCalls.find((c) => c.role === 'compose')!;
        expect(composeCall.model, taskId).toBe(audited.response.answer.model);
      }
      for (const call of record.llmCalls) {
        expect(call.model, taskId).toBeTruthy();
        expect(call.inputTokens, taskId).toBeGreaterThan(0);
      }
      const inputSum = record.llmCalls.reduce((s, c) => s + c.inputTokens, 0);
      const outputSum = record.llmCalls.reduce((s, c) => s + c.outputTokens, 0);
      expect(record.inputTokens, taskId).toBe(inputSum);
      expect(record.outputTokens, taskId).toBe(outputSum);
      expect(record.latencyMs, taskId).toBeGreaterThanOrEqual(0);
    }
  });

  it('R8: every record reconstructs from the stored row alone', () => {
    for (const [taskId, { record }] of flows) {
      const report = reconstructionReport(record);
      expect(report.problems, taskId).toEqual([]);
    }
  });

  it('reconstruction has teeth: tampered records FAIL (value, text, attribution, chart, result ids)', () => {
    const clone = (record: AuditRecord): AuditRecord => JSON.parse(JSON.stringify(record)) as AuditRecord;
    const record = flows.get('B4')!.record;

    // (a) a stored cell value changes -> the stored body is no longer backed
    const valueTamper = clone(record);
    if (valueTamper.response.kind !== 'answer') throw new Error('unreachable');
    valueTamper.response.result.cells[0]!.value = (valueTamper.response.result.cells[0]!.value ?? 0) + 1;
    expect(reconstructionReport(valueTamper).ok).toBe(false);

    // (b) the final text is edited after the fact
    const textTamper = clone(record);
    textTamper.finalText = textTamper.finalText.replace('3', '4');
    expect(reconstructionReport(textTamper).ok).toBe(false);

    // (c) the attribution sync date is edited
    const attributionTamper = clone(record);
    if (attributionTamper.response.kind !== 'answer') throw new Error('unreachable');
    attributionTamper.response.result.attribution.syncedAt = '1999-01-01T00:00:00.000Z';
    expect(reconstructionReport(attributionTamper).ok).toBe(false);

    // (d) a chart point value is edited
    const chartTamper = clone(record);
    if (chartTamper.response.kind !== 'answer' || chartTamper.response.chart === null) {
      throw new Error('B4 must carry a chart');
    }
    chartTamper.response.chart.series[0]!.points[0]!.value =
      (chartTamper.response.chart.series[0]!.points[0]!.value ?? 0) + 1;
    expect(reconstructionReport(chartTamper).ok).toBe(false);

    // (e) a result id is dropped from the promoted column
    const idTamper = clone(record);
    idTamper.resultIds = idTamper.resultIds.slice(1);
    expect(reconstructionReport(idTamper).ok).toBe(false);

    // (f) schema-version tags are forged (row-level and envelope-level) —
    // records live forever, a v1 reconstructor must reject foreign tags
    // (adversarial-review finding, 2026-07-03)
    const rowVersionTamper = clone(record);
    (rowVersionTamper as { schemaVersion: number }).schemaVersion = 999;
    expect(reconstructionReport(rowVersionTamper).ok).toBe(false);
    const envelopeVersionTamper = clone(record);
    (envelopeVersionTamper.response as { schemaVersion: number }).schemaVersion = 999;
    expect(reconstructionReport(envelopeVersionTamper).ok).toBe(false);
    const answerVersionTamper = clone(record);
    if (answerVersionTamper.response.kind !== 'answer') throw new Error('unreachable');
    (answerVersionTamper.response.answer as { schemaVersion: number }).schemaVersion = 999;
    expect(reconstructionReport(answerVersionTamper).ok).toBe(false);
  });
});

describe('refusal and clarification flows write records too (docs/05: one row per answer AND per refusal)', () => {
  const flows = new Map<string, { audited: AuditedResponse; record: AuditRecord }>();

  beforeAll(async () => {
    for (const taskId of ['B15', 'B17', 'B18', 'B20']) {
      const audited = await answerQuestionAudited(db, REFUSAL_TASK_QUESTIONS[taskId]!, respondOptions());
      flows.set(taskId, { audited, record: await mustLoad(audited.auditId) });
    }
  }, 300_000);

  it('B17/B18/B20: refusal rows carry the reason, no result ids, no tables, and reconstruct', () => {
    for (const taskId of ['B17', 'B18', 'B20']) {
      const { audited, record } = flows.get(taskId)!;
      expect(audited.response.kind, taskId).toBe('refusal');
      if (audited.response.kind !== 'refusal') throw new Error('unreachable');
      expect(record.kind, taskId).toBe('refusal');
      expect(record.refusalReason, taskId).toBe(audited.response.reason);
      expect(record.resultIds, taskId).toEqual([]);
      expect(record.tables, taskId).toEqual([]);
      expect(record.answerSource, taskId).toBeNull();
      expect(record.chartEmitted, taskId).toBe(false);
      expect(reconstructionReport(record).problems, taskId).toEqual([]);
    }
  });

  it('B20: the freshness payload is inside the stored envelope, and the intent that hit the freshness wall is recorded with its hash', () => {
    const { record } = flows.get('B20')!;
    if (record.response.kind !== 'refusal') throw new Error('unreachable');
    expect(record.response.freshness).not.toBeNull();
    // B20 reached the query layer, so the resolved intent exists and is
    // promoted for the docs/06 repeat-question measurement.
    expect(record.intent).not.toBeNull();
    expect(record.intentHash).toBe(intentHash(record.intent as StructuredIntent));
  });

  it('B15: the clarification row stores the pending state inside the envelope; first-turn rows have no reply context', () => {
    const { audited, record } = flows.get('B15')!;
    expect(audited.response.kind).toBe('clarification');
    if (audited.response.kind !== 'clarification') throw new Error('unreachable');
    expect(record.kind).toBe('clarification');
    expect(record.replyText).toBeNull();
    expect(record.pendingClarification).toBeNull();
    if (record.response.kind !== 'clarification') throw new Error('unreachable');
    expect(record.response.pending).toEqual(audited.response.pending);
    expect(record.intent).toBeNull();
    expect(record.intentHash).toBeNull();
    expect(reconstructionReport(record).problems).toEqual([]);
  });

  it('a parse failure is audited as an internal refusal (fail-closed, never unrecorded)', async () => {
    const failingIntent = {
      complete: () => Promise.reject(new Error('injected intent-client failure')),
    };
    const audited = await answerQuestionAudited(db, 'Hoeveel inwoners had Nederland op 1 januari 2025?', {
      ...respondOptions(),
      intentClient: failingIntent,
    });
    expect(audited.response.kind).toBe('refusal');
    if (audited.response.kind !== 'refusal') throw new Error('unreachable');
    expect(audited.response.reason).toBe('internal');
    const record = await mustLoad(audited.auditId);
    expect(record.refusalReason).toBe('internal');
    if (record.response.kind !== 'refusal') throw new Error('unreachable');
    expect(record.response.internalNote).toContain('injected intent-client failure');
    expect(record.llmCalls).toEqual([]);
    expect(reconstructionReport(record).problems).toEqual([]);
  });
});

describe('the clarification-reply round records the ADR 015 wrap-site context', () => {
  it('c-b15-full: the reply row carries reply_text + the pending it answered, and the answer matches the frozen key (B5)', async () => {
    const clarifySet = JSON.parse(
      readFileSync(new URL('../../benchmark/clarification-cases.json', import.meta.url), 'utf8'),
    ) as { referenceDate: string; cases: { id: string; originalQuestion: string; reply: string }[] };
    const c = clarifySet.cases.find((x) => x.id === 'c-b15-full')!;

    const first = await answerQuestionAudited(db, c.originalQuestion, respondOptions(clarifySet.referenceDate));
    expect(first.response.kind).toBe('clarification');
    if (first.response.kind !== 'clarification') throw new Error('unreachable');

    const reply = await answerClarificationReplyAudited(
      db,
      first.response.pending,
      c.reply,
      clarifyReplyOptions(clarifySet.referenceDate),
    );
    expect(reply.response.kind).toBe('answer');
    if (reply.response.kind !== 'answer') throw new Error('unreachable');
    const problems = checkComposedAnswer('B5', answerKey.tasks.B5!, reply.response.answer);
    expect(problems, problems.join('\n')).toEqual([]);

    const record = await mustLoad(reply.auditId);
    expect(record.replyText).toBe(c.reply);
    expect(record.pendingClarification).toEqual(first.response.pending);
    expect(record.question).toBe(c.originalQuestion);
    const roles = record.llmCalls.map((x) => x.role);
    expect(roles).toContain('clarify');
    expect(roles).toContain('compose');
    expect(roles).not.toContain('intent');
    expect(record.conversationContext).toBeNull();
    expect(reconstructionReport(record).problems).toEqual([]);
  });
});

describe('WP15: the offered conversation context is a recorded input (ADR 021 decision 3)', () => {
  const context: import('../../src/answer/context/index.ts').ConversationContext = {
    version: 1,
    topicKey: 'population_on_1_january',
    regions: [{ name: 'Amsterdam', kind: 'gemeente' }],
    period: { kind: 'year', year: 2024 },
    derivation: 'none',
  };

  it('happy path, end-to-end over recorded fixtures: a follow-up turn answers with the frozen key (B7), records the offered context, and reconstructs', async () => {
    // f-merge-topic-switch-national (benchmark/followup-cases.json): previous
    // turn was inflation 2024; "En de huizenprijzen?" merges to exactly B7's
    // intent (average home price, 2024) — so the composed answer replays from
    // the same committed compose fixture the clarify-round e2e uses.
    const followupSet = JSON.parse(
      readFileSync(new URL('../../benchmark/followup-cases.json', import.meta.url), 'utf8'),
    ) as { referenceDate: string; cases: { id: string; context: unknown; question: string }[] };
    const c = followupSet.cases.find((x) => x.id === 'f-merge-topic-switch-national')!;
    const audited = await answerQuestionAudited(db, c.question, {
      intentClient: new ReplayLlmClient(fileURLToPath(new URL('../fixtures/llm/followup', import.meta.url))),
      answerClient: new ReplayLlmClient(ANSWER_FIXTURES),
      referenceDate: followupSet.referenceDate,
      conversationContext: c.context as import('../../src/answer/context/index.ts').ConversationContext,
    });
    expect(audited.response.kind).toBe('answer');
    if (audited.response.kind !== 'answer') throw new Error('unreachable');
    const problems = checkComposedAnswer('B7', answerKey.tasks.B7!, audited.response.answer);
    expect(problems, problems.join('\n')).toEqual([]);

    const record = await mustLoad(audited.auditId);
    expect(record.conversationContext).toEqual(c.context);
    expect(record.replyText).toBeNull();
    const roles = record.llmCalls.map((x) => x.role);
    expect(roles).toContain('followup');
    expect(roles).toContain('compose');
    expect(roles).not.toContain('intent');
    expect(reconstructionReport(record).problems).toEqual([]);
  });

  it('a follow-up turn records the offered context verbatim and reconstructs — even on the fail-closed path', async () => {
    // No follow-up fixture exists for this synthetic question: the replay
    // client throws, respondToQuestion fails closed to the internal refusal —
    // and the row must STILL record that a context was offered (input
    // capture, like replyText), with no 'intent'-labelled call recorded (the
    // wrap site labels a context-offered parse 'followup'). The happy-path
    // twin of this pin lands with the recorded fixtures.
    const audited = await answerQuestionAudited(db, 'En in Rotterdam? (audit-pin, geen fixture)', {
      ...respondOptions(),
      conversationContext: context,
    });
    expect(audited.response.kind).toBe('refusal');
    if (audited.response.kind !== 'refusal') throw new Error('unreachable');
    expect(audited.response.reason).toBe('internal');
    const record = await mustLoad(audited.auditId);
    expect(record.conversationContext).toEqual(context);
    expect(record.replyText).toBeNull();
    expect(record.llmCalls.map((c) => c.role)).not.toContain('intent');
    expect(reconstructionReport(record).problems).toEqual([]);
  });

  it('the database CHECK rejects a context on a reply row (one merge candidate per parse)', async () => {
    // Hand-build a reply-shaped row that ALSO claims a conversation context —
    // the wrap site can never produce this; the constraint is the belt.
    const flow = await answerQuestionAudited(db, ANSWERABLE_TASKS.B1!.question, respondOptions());
    const record = await mustLoad(flow.auditId);
    const { buildAuditRow, insertAuditRecord } = await import('../../src/answer/audit/index.ts');
    const row = buildAuditRow(record.response, {
      referenceDate: REFERENCE_DATE,
      userId: null,
      replyText: 'een reply',
      pendingClarification: {
        version: 1,
        question: 'v',
        referenceDate: REFERENCE_DATE,
        axes: ['measure'],
        questionNl: 'v?',
        options: [],
      },
      conversationContext: context,
      llmCalls: [],
      latencyMs: 1,
    });
    await expect(insertAuditRecord(db, row)).rejects.toThrow(/context_never_on_reply_rows/);
  });

  it('reconstruction flags a context on a reply row (the row-level mirror of the CHECK)', async () => {
    const flow = await answerQuestionAudited(db, ANSWERABLE_TASKS.B1!.question, respondOptions());
    const record = await mustLoad(flow.auditId);
    const tampered: AuditRecord = {
      ...record,
      replyText: 'een reply',
      pendingClarification: {
        version: 1,
        question: 'v',
        referenceDate: REFERENCE_DATE,
        axes: ['measure'],
        questionNl: 'v?',
        options: [],
      },
      conversationContext: context,
    };
    expect(reconstructionReport(tampered).problems).toContain(
      'conversation_context must be null on clarification-reply rows',
    );
  });
});

describe('fail-closed policy on audit-write failure (ADR 016)', () => {
  it('an answer whose audit insert fails is WITHHELD: internal refusal, itself audited when possible', async () => {
    const before = (await loadAllAuditRecords(db)).length;
    const failOnce = withFailingAuditInserts(db, 1);
    const audited = await answerQuestionAudited(
      failOnce,
      ANSWERABLE_TASKS.B1!.question,
      respondOptions(),
    );
    expect(audited.response.kind).toBe('refusal');
    if (audited.response.kind !== 'refusal') throw new Error('unreachable');
    expect(audited.response.reason).toBe('internal');
    expect(audited.response.internalNote).toContain('audit write failed');
    // The replacement refusal WAS audited (second insert allowed).
    const record = await mustLoad(audited.auditId);
    expect(record.refusalReason).toBe('internal');
    expect((await loadAllAuditRecords(db)).length).toBe(before + 1);
  });

  it('when the audit store is fully down, no answer or clarification leaks: internal refusal with auditId null', async () => {
    const failAll = withFailingAuditInserts(db);
    for (const question of [ANSWERABLE_TASKS.B1!.question, REFUSAL_TASK_QUESTIONS.B15!]) {
      const audited = await answerQuestionAudited(failAll, question, respondOptions());
      expect(audited.response.kind).toBe('refusal');
      if (audited.response.kind !== 'refusal') throw new Error('unreachable');
      expect(audited.response.reason).toBe('internal');
      expect(audited.auditId).toBeNull();
    }
  });

  it('a refusal whose audit insert fails is returned as-is (annotated), never masked by a second refusal', async () => {
    const failAll = withFailingAuditInserts(db);
    const audited = await answerQuestionAudited(failAll, REFUSAL_TASK_QUESTIONS.B17!, respondOptions());
    expect(audited.response.kind).toBe('refusal');
    if (audited.response.kind !== 'refusal') throw new Error('unreachable');
    expect(audited.response.reason).toBe('scope');
    expect(audited.response.internalNote).toContain('audit write failed');
    expect(audited.auditId).toBeNull();
  });
});
