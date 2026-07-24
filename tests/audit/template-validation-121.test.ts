// #121 option A (owner decision 2026-07-24, in-chat): a template answer that
// fails its own validator is SERVED + the owner is ALERTED + the audit row's
// re-validation labels the failure as known-at-serve-time. Two halves here:
// the alert hook (unit, stubbed fetch) and the R8 marker (real record from
// the ingested hermetic DB, mutated to the target shape — the same
// mutate-a-loaded-record pattern the other R8 suites use).
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReplayLlmClient } from '../../src/answer/llm/client.ts';
import {
  answerQuestionAudited,
  loadAuditRecord,
  reconstructionReport,
} from '../../src/answer/audit/index.ts';
import type { AuditRecord } from '../../src/answer/audit/index.ts';
import {
  alertTemplateValidationFailure,
  maybeAlertTemplateValidationFailure,
} from '../../src/answer/audit/alerts.ts';
import type { AuditedResponse } from '../../src/answer/audit/respond-audited.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { ANSWERABLE_TASKS } from '../helpers/benchmark-intents.ts';
import { loadLabelledSet } from '../helpers/intent-expectations.ts';

const INTENT_FIXTURES = fileURLToPath(new URL('../fixtures/llm/intent', import.meta.url));
const ANSWER_FIXTURES = fileURLToPath(new URL('../fixtures/llm/answer', import.meta.url));
const REFERENCE_DATE = loadLabelledSet().referenceDate;

afterEach(() => vi.restoreAllMocks());

function auditedAnswer(source: string, ok: boolean): AuditedResponse {
  return {
    auditId: 400,
    response: {
      kind: 'answer',
      question: 'Wat was de inflatie in 2024?',
      answer: { source, validation: { ok, problems: ok ? [] : ['unit mismatch near "-39"'] } },
    } as unknown as AuditedResponse['response'],
  } as AuditedResponse;
}

describe('maybeAlertTemplateValidationFailure (#121 option A hook)', () => {
  it('fires ONLY for template-source answers with a failing verdict', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await maybeAlertTemplateValidationFailure(auditedAnswer('llm', false), 'u1');
    await maybeAlertTemplateValidationFailure(auditedAnswer('template', true), 'u1');
    await maybeAlertTemplateValidationFailure(
      { auditId: 1, response: { kind: 'refusal' } as unknown as AuditedResponse['response'] } as AuditedResponse,
      'u1',
    );
    expect(consoleError).not.toHaveBeenCalled();
    await maybeAlertTemplateValidationFailure(auditedAnswer('template', false), 'u1');
    expect(consoleError).toHaveBeenCalledOnce();
    expect(String(consoleError.mock.calls[0])).toContain('TEMPLATE answer served with a FAILING validator verdict');
    expect(String(consoleError.mock.calls[0])).toContain('unit mismatch');
  });

  it('with config: the email names the audit row, question and the failure reasons; a send failure is swallowed', async () => {
    process.env.RESEND_API_KEY = 'key-x';
    process.env.ADMIN_ALERT_EMAIL = 'owner@example.com';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const fetchStub = vi.fn().mockResolvedValue({ ok: true });
      await alertTemplateValidationFailure(
        { auditId: 400, userId: 'u1', question: 'Wat was het consumentenvertrouwen?', problems: ['unit mismatch near "-39"'] },
        fetchStub as unknown as typeof fetch,
      );
      const body = JSON.parse((fetchStub.mock.calls[0]![1] as { body: string }).body) as {
        subject: string;
        text: string;
      };
      expect(body.subject).toContain('sjabloon-antwoord');
      expect(body.text).toContain('Audit-rij: 400');
      expect(body.text).toContain('unit mismatch near "-39"');

      const failing = vi.fn().mockRejectedValue(new Error('resend down'));
      await expect(
        alertTemplateValidationFailure(
          { auditId: 400, userId: 'u1', question: 'x', problems: [] },
          failing as unknown as typeof fetch,
        ),
      ).resolves.toBeUndefined();
    } finally {
      delete process.env.RESEND_API_KEY;
      delete process.env.ADMIN_ALERT_EMAIL;
    }
  });
});

describe('R8 marker: known-at-serve-time template failure is labeled apart from corruption', () => {
  it('a template row stored ok:false gets the #121 label; the same corruption on an llm row gets the bare label', async () => {
    const { db, close } = await createIngestedDb();
    try {
      const audited = await answerQuestionAudited(db, ANSWERABLE_TASKS['B6']!.question, {
        intentClient: new ReplayLlmClient(INTENT_FIXTURES),
        answerClient: new ReplayLlmClient(ANSWER_FIXTURES),
        referenceDate: REFERENCE_DATE,
      });
      if (audited.response.kind !== 'answer') throw new Error('expected an answer');
      const record = (await loadAuditRecord(db, audited.auditId!)) as AuditRecord;

      // Corrupt ONE digit in body + text consistently (the assembled-text
      // check must stay green; only re-validation may fail) — the mutation
      // class every R8 tamper test uses.
      const mutate = (record_: AuditRecord, source: string, ok: boolean): AuditRecord => {
        const clone = structuredClone(record_) as AuditRecord;
        const resp = clone.response as unknown as {
          answer: { body: string; text?: string; source: string; validation: { ok: boolean; problems: string[] } };
          text: string;
        };
        const swap = (s: string) => s.replace(/(\d)/, (d) => (d === '9' ? '8' : '9'));
        const oldBody = resp.answer.body;
        resp.answer.body = swap(oldBody);
        resp.text = resp.text.replace(oldBody, resp.answer.body);
        if (typeof resp.answer.text === 'string') {
          resp.answer.text = resp.answer.text.replace(oldBody, resp.answer.body);
        }
        resp.answer.source = source;
        resp.answer.validation = { ok, problems: ok ? [] : ['seeded serve-time failure'] };
        return clone;
      };

      const templateKnown = reconstructionReport(mutate(record, 'template', false));
      expect(
        templateKnown.problems.some((p) => p.includes('KNOWN-failing at serve time (#121 serve+alert)')),
      ).toBe(true);

      const llmCorrupted = reconstructionReport(mutate(record, 'llm', true));
      expect(
        llmCorrupted.problems.some((p) => p.includes('stored body fails re-validation against stored result')),
      ).toBe(true);
      expect(llmCorrupted.problems.some((p) => p.includes('KNOWN-failing'))).toBe(false);
    } finally {
      await close();
    }
  });
});
