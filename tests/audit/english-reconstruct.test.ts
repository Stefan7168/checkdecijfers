// ADR 058 (English answers, Task 7): audit wiring for the English rendering
// + R8 reconstruction. Three concerns, hermetic (ADR 009's embedded Postgres,
// fixture-replayed LLM calls, never a real model):
//
//  1. Byte-identity: `AuditedRespondOptions.lang`/`translateClient` are
//     ADDITIVE — absent, `lang: 'nl'`, and `lang: 'en'` with no
//     `translateClient` must all produce the SAME response/record as today
//     (A1), across every benchmark task the hermetic suite already runs.
//  2. A verified English row: a faithful stub translate client ⇒ the stored
//     `response.english.status === 'verified'`, `llm_calls` carries a
//     `'translate'` role entry, and `reconstructionReport` finds nothing
//     wrong — then seven tamper classes, each breaking exactly one field a
//     real corruption or a buggy future change could break, must each
//     surface at least one reconstruction problem.
//  3. A fallback English row: a translate client that fails every attempt
//     falls back to Dutch — the Dutch `final_text` is untouched — and still
//     reconstructs clean (a `fallback` rendering has its own, simpler,
//     guaranteed shape).
//
// B3 (CPI inflation, docs/02) is the fixture used for (2) and (3): a single
// national figure, one glossary entry, one alternate reading — the simplest
// real benchmark task whose masked Dutch this file can transform into a
// faithful English translation with a handful of anchored regexes, the same
// discipline translate.test.ts's own `faithfulEnglish` helpers use (derived
// from the ACTUAL masked request each call, never a hand-counted placeholder
// id — so a future masker/glossary change desyncs loudly instead of silently).
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReplayLlmClient, stableStringify } from '../../src/answer/llm/client.ts';
import type { LlmClient, LlmRequest } from '../../src/answer/llm/client.ts';
import {
  answerQuestionAudited,
  loadAuditRecord,
  reconstructionReport,
} from '../../src/answer/audit/index.ts';
import type { AuditRecord } from '../../src/answer/audit/index.ts';
import { PLACEHOLDER_RE } from '../../src/answer/translate/mask.ts';
import type { TranslationItems } from '../../src/answer/translate/check.ts';
import type { AnswerResponse } from '../../src/answer/respond/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { ANSWERABLE_TASKS } from '../helpers/benchmark-intents.ts';
import { loadLabelledSet } from '../helpers/intent-expectations.ts';
import type { Db } from '../../src/db/types.ts';

const INTENT_FIXTURES = fileURLToPath(new URL('../fixtures/llm/intent', import.meta.url));
const ANSWER_FIXTURES = fileURLToPath(new URL('../fixtures/llm/answer', import.meta.url));
const REFERENCE_DATE = loadLabelledSet().referenceDate;

function fixtureClients() {
  return {
    intentClient: new ReplayLlmClient(INTENT_FIXTURES),
    answerClient: new ReplayLlmClient(ANSWER_FIXTURES),
    referenceDate: REFERENCE_DATE,
  };
}

function clone(record: AuditRecord): AuditRecord {
  return JSON.parse(JSON.stringify(record)) as AuditRecord;
}

/** Narrows to the answer envelope (every record in this file is one) and
 * hands back a reference whose `.english` a tamper test can mutate in place. */
function answerOf(record: AuditRecord): AnswerResponse {
  if (record.response.kind !== 'answer') throw new Error('unreachable: expected an answer row');
  return record.response;
}

// ---------------------------------------------------------------------------
// (1) Byte-identity across the three option shapes
// ---------------------------------------------------------------------------

/** Strips the fields that are legitimately volatile per INSERT (the
 * database-assigned id/createdAt, and the wall-clock latency measurement) —
 * everything else, including `llmCalls` (token counts only, no timing field
 * on LlmCallRecord), must be byte-identical across the three calls. */
function stableRecord(record: AuditRecord): unknown {
  const { id: _id, createdAt: _createdAt, latencyMs: _latencyMs, ...rest } = record;
  return rest;
}

describe('byte-identity: lang absent, lang "nl", and lang "en" with no translateClient are all no-ops (A1)', () => {
  it('every answerable benchmark task produces the same response and the same stored record across all three option shapes', async () => {
    const { db, close } = await createIngestedDb();
    try {
      for (const taskId of Object.keys(ANSWERABLE_TASKS)) {
        const question = ANSWERABLE_TASKS[taskId]!.question;
        const optionShapes: { lang?: 'nl' | 'en' }[] = [{}, { lang: 'nl' }, { lang: 'en' }];
        const baseline = await answerQuestionAudited(db, question, { ...fixtureClients(), ...optionShapes[0] });
        const baselineRecord = (await loadAuditRecord(db, baseline.auditId!)) as AuditRecord;

        for (const shape of optionShapes.slice(1)) {
          const audited = await answerQuestionAudited(db, question, { ...fixtureClients(), ...shape });
          expect(stableStringify(audited.response), `${taskId} ${JSON.stringify(shape)}`).toBe(
            stableStringify(baseline.response),
          );
          const record = (await loadAuditRecord(db, audited.auditId!)) as AuditRecord;
          expect(stableStringify(stableRecord(record)), `${taskId} ${JSON.stringify(shape)}`).toBe(
            stableStringify(stableRecord(baselineRecord)),
          );
        }
      }
    } finally {
      await close();
    }
  }, 300_000);
});

// ---------------------------------------------------------------------------
// (2) A verified English row + seven tamper classes
// ---------------------------------------------------------------------------

/** Every anchored regex below is matched against the ACTUAL masked Dutch the
 * request carries (`buildTranslateRequest`'s `question` is
 * `JSON.stringify({ items, glossary })`) — never a hand-counted placeholder
 * id. A non-matching regex leaves the text untouched, which the sanity
 * assertions in the "verifies" test below would catch as a silent no-op. */
function faithfulB3TranslateClient(): LlmClient & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    requests,
    async complete(req: LlmRequest) {
      requests.push(req);
      const { items } = JSON.parse(req.question) as { items: TranslationItems };
      const body = items.body.replace(
        /^De inflatie bedroeg in (⟦P[a-z]+⟧) gemiddeld (⟦N[a-z]+⟧) %\.$/,
        'Inflation averaged $2% in $1.',
      );
      const definition =
        items.definition === null
          ? null
          : items.definition.replace(
              /^inflatie \(jaarmutatie CPI, alle bestedingen\)$/,
              'inflation (annual rate of change CPI, all spending categories)',
            );
      const chips = items.chips.map((chip) =>
        chip
          .replace(
            /^Wat was inflatie \(jaarmutatie CPI, alle bestedingen\) in (⟦N[a-z]+⟧)\?$/,
            'What was the annual rate of change CPI, all spending categories, in $1?',
          )
          .replace(
            /^Hoe ontwikkelde inflatie \(jaarmutatie CPI, alle bestedingen\) zich van (⟦N[a-z]+⟧) tot en met (⟦P[a-z]+⟧)\?$/,
            'How did the annual rate of change CPI, all spending categories, develop from $1 to $2?',
          ),
      );
      const alternates = items.alternates.map((alt) =>
        alt.replace(
          /^CPI indexniveau \((⟦N[a-z]+⟧)=(⟦N[a-z]+⟧)\), geen mutatiepercentage$/,
          'CPI index level ($1=$2), not a percentage change',
        ),
      );
      const outputText = JSON.stringify({ body, chips, definition, alternates });
      return { outputText, model: req.model, stopReason: 'end_turn', usage: { inputTokens: 3, outputTokens: 5 } };
    },
  };
}

describe('a verified English row (ADR 058 Task 7)', () => {
  let db: Db;
  let close: () => Promise<void>;
  let record: AuditRecord;
  let client: LlmClient & { requests: LlmRequest[] };

  beforeAll(async () => {
    ({ db, close } = await createIngestedDb());
    client = faithfulB3TranslateClient();
    const audited = await answerQuestionAudited(db, ANSWERABLE_TASKS.B3!.question, {
      ...fixtureClients(),
      lang: 'en',
      translateClient: client,
    });
    record = (await loadAuditRecord(db, audited.auditId!)) as AuditRecord;
  }, 120_000);

  afterAll(async () => {
    await close();
  });

  it('verifies, records a translate llm_calls entry, and reconstructs with no problems', () => {
    const response = answerOf(record);
    expect(response.english).toBeDefined();
    const english = response.english!;
    // Sanity: every regex above actually matched real masked text — if a
    // future masker/glossary change desyncs one, this fails loudly instead
    // of quietly leaving Dutch text (with its digits already replaced by
    // placeholders) unfilled.
    expect(english.body).not.toContain('⟦');
    expect(english.body).toContain('Inflation averaged');
    expect(english.status).toBe('verified');
    expect(client.requests).toHaveLength(1);

    expect(record.llmCalls.some((c) => c.role === 'translate')).toBe(true);
    expect(reconstructionReport(record).problems).toEqual([]);
  });

  it('tamper: a changed digit in english.body fails reconstruction', () => {
    const tampered = clone(record);
    const english = answerOf(tampered).english!;
    const bumped = english.body!.replace(/\d/, (d) => String((Number(d) + 1) % 10));
    expect(bumped).not.toBe(english.body); // sanity: a digit was actually found and changed
    english.body = bumped;
    const report = reconstructionReport(tampered);
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.startsWith('english:'))).toBe(true);
  });

  it('tamper: swapping two placeholders in rawTranslation.body fails reconstruction', () => {
    const tampered = clone(record);
    const english = answerOf(tampered).english!;
    const raw = english.rawTranslation!;
    const originalBody = raw.body;
    const found = [...new Set(originalBody.match(PLACEHOLDER_RE) ?? [])];
    expect(found.length).toBeGreaterThanOrEqual(2); // sanity: B3's body carries >= 2 distinct placeholders
    const [a, b] = found as [string, string];
    // Swap every occurrence of `a` and `b` via a placeholder-safe temp marker.
    raw.body = originalBody.split(a).join('\u0000').split(b).join(a).split('\u0000').join(b);
    expect(raw.body).not.toBe(originalBody); // sanity: the swap actually changed the text
    const report = reconstructionReport(tampered);
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.startsWith('english:'))).toBe(true);
  });

  it('tamper: a changed english.lines.attributionLine fails reconstruction', () => {
    const tampered = clone(record);
    const english = answerOf(tampered).english!;
    english.lines!.attributionLine += ' TAMPERED';
    const report = reconstructionReport(tampered);
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.startsWith('english:'))).toBe(true);
  });

  it('tamper: a changed maskTable[i].english fails reconstruction', () => {
    const tampered = clone(record);
    const english = answerOf(tampered).english!;
    expect(english.maskTable.length).toBeGreaterThan(0); // sanity
    english.maskTable[0]!.english += ' TAMPERED';
    const report = reconstructionReport(tampered);
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.startsWith('english:'))).toBe(true);
  });

  it("tamper: status 'verified' riding a rawTranslation that now fails C3 fails reconstruction", () => {
    const tampered = clone(record);
    const english = answerOf(tampered).english!;
    const raw = english.rawTranslation!;
    const withSpuriousDirection = raw.body.replace('averaged', 'rose to');
    expect(withSpuriousDirection).not.toBe(raw.body); // sanity
    raw.body = withSpuriousDirection;
    expect(english.status).toBe('verified'); // unchanged — the contradiction IS the point
    const report = reconstructionReport(tampered);
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.startsWith('english:') && p.includes('C3'))).toBe(true);
  });

  it('tamper: a changed english.text fails reconstruction', () => {
    const tampered = clone(record);
    const english = answerOf(tampered).english!;
    english.text += ' TAMPERED';
    const report = reconstructionReport(tampered);
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.startsWith('english:'))).toBe(true);
  });

  it("tamper: a changed chip's submit fails reconstruction", () => {
    const tampered = clone(record);
    const english = answerOf(tampered).english!;
    expect(english.chips.length).toBeGreaterThan(0); // sanity
    english.chips[0]!.submit = 'some other question entirely';
    const report = reconstructionReport(tampered);
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.startsWith('english:'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (3) A fallback English row
// ---------------------------------------------------------------------------

describe('a fallback English row (the translate client fails every attempt)', () => {
  it('falls back to Dutch, leaves final_text untouched, and still reconstructs clean', async () => {
    const { db, close } = await createIngestedDb();
    try {
      const question = ANSWERABLE_TASKS.B3!.question;
      const baseline = await answerQuestionAudited(db, question, fixtureClients());
      if (baseline.response.kind !== 'answer') throw new Error('unreachable');

      const failingClient: LlmClient = {
        async complete() {
          throw new Error('boom: simulated translate outage');
        },
      };
      const audited = await answerQuestionAudited(db, question, {
        ...fixtureClients(),
        lang: 'en',
        translateClient: failingClient,
      });
      if (audited.response.kind !== 'answer') throw new Error('unreachable');

      const english = audited.response.english!;
      expect(english.status).toBe('fallback');
      expect(english.body).toBeNull();
      expect(english.lines).toBeNull();
      expect(english.text).toBeNull();
      expect(english.chips).toEqual([]);
      expect(english.attempts.length).toBeGreaterThan(0);
      expect(english.attempts.every((a) => !a.ok)).toBe(true);

      // The Dutch answer is exactly what a plain (no-lang) run produces —
      // the failed translate attempt never touches it.
      expect(audited.response.text).toBe(baseline.response.text);
      expect(audited.response.answer.body).toBe(baseline.response.answer.body);

      const record = (await loadAuditRecord(db, audited.auditId!)) as AuditRecord;
      expect(record.finalText).toBe(baseline.response.text);
      expect(reconstructionReport(record).problems).toEqual([]);
    } finally {
      await close();
    }
  }, 120_000);
});
