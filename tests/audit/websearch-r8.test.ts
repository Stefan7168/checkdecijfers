// WP129+130 (ADR 032): R8 across the web-augmentation boundary, hermetic. The
// unverified-web section and the #129 selection state ride the audit envelope
// as ADDITIVE structural fields, stored VERBATIM and REPLAYED on reconstruction
// (never re-derived — the web is non-deterministic). Proves:
//  - the A1 absent-key regression (pre-WP rows serialize NEITHER key — the same
//    fail-safe class as onboarding-envelope-r8 / source-r8; #133);
//  - a stored ok section round-trips clean;
//  - the four reconstruct checks (a)–(d) each fail loudly on a tampered row;
//  - ⟨W1⟩ a refusal carrying an ok section whose audit insert FAILS is shipped
//    with webSection stripped to null and auditId null (nothing paid, unverified
//    and unrecorded is ever shown/kept).
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ReplayLlmClient } from '../../src/answer/llm/client.ts';
import {
  answerQuestionAudited,
  loadAuditRecord,
  reconstructionReport,
} from '../../src/answer/audit/index.ts';
import type { AuditRecord } from '../../src/answer/audit/index.ts';
import type { WebSearchClient } from '../../src/websearch/client.ts';
import type { WebBilling } from '../../src/websearch/attach.ts';
import type { SourceSelection, WebSection } from '../../src/websearch/types.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { ANSWERABLE_TASKS, REFUSAL_TASK_QUESTIONS } from '../helpers/benchmark-intents.ts';
import { loadLabelledSet } from '../helpers/intent-expectations.ts';

const INTENT_FIXTURES = fileURLToPath(new URL('../fixtures/llm/intent', import.meta.url));
const ANSWER_FIXTURES = fileURLToPath(new URL('../fixtures/llm/answer', import.meta.url));
const REFERENCE_DATE = loadLabelledSet().referenceDate;

const WEB_ON: SourceSelection = { sources: ['cbs'], web: true };
const OK_SECTION: WebSection = {
  status: 'ok',
  findings: [{ text: 'webresultaat', citations: [{ url: 'https://cpb.nl', title: 'CPB' }] }],
  model: 'claude-sonnet-5',
  searches: 1,
  usage: { inputTokens: 10, outputTokens: 5 },
  promptVersion: 1,
};

class FakeWebSearchClient implements WebSearchClient {
  private readonly result: WebSection;
  constructor(result: WebSection) {
    this.result = result;
  }
  async search(): Promise<WebSection> {
    return this.result;
  }
}

const okBilling: WebBilling = { reserve: async () => true };

function baseOptions() {
  return {
    intentClient: new ReplayLlmClient(INTENT_FIXTURES),
    answerClient: new ReplayLlmClient(ANSWER_FIXTURES),
    referenceDate: REFERENCE_DATE,
  };
}

function webOptions() {
  return {
    ...baseOptions(),
    sourceSelection: WEB_ON,
    webClient: new FakeWebSearchClient(OK_SECTION),
    webBilling: okBilling,
  };
}

/** A Db that rejects every audit_answers insert but passes everything else
 * through — the ADR 016 fail-closed probe (mirrors audit-records.test.ts). */
function withFailingAuditInserts(inner: Db): Db {
  return {
    query(text: string, params?: unknown[]) {
      if (/insert into audit_answers/i.test(text)) {
        return Promise.reject(new Error('injected audit-insert failure'));
      }
      return inner.query(text, params);
    },
    withTransaction: (fn) => inner.withTransaction(fn),
  };
}

function clone(record: AuditRecord): AuditRecord {
  return JSON.parse(JSON.stringify(record)) as AuditRecord;
}

describe('R8 across the web-augmentation boundary (WP129+130, ADR 032)', () => {
  it('a stored ok webSection round-trips clean; the selection state rides the row', async () => {
    const { db, close } = await createIngestedDb();
    try {
      const audited = await answerQuestionAudited(db, ANSWERABLE_TASKS.B1!.question, webOptions());
      expect(audited.response.kind).toBe('answer');
      const record = await loadAuditRecord(db, audited.auditId!);
      expect(reconstructionReport(record as AuditRecord).problems).toEqual([]);
      const stored = (record as AuditRecord).response;
      expect(stored.sourceSelection).toEqual(WEB_ON);
      expect(stored.webSection?.status).toBe('ok');
    } finally {
      await close();
    }
  }, 180_000);

  it('A1 absent-key regression: a pre-WP row (NEITHER key serialized) reconstructs without a false mismatch', async () => {
    const { db, close } = await createIngestedDb();
    try {
      // No web options ⇒ attach stores both keys as null (present). Simulate a
      // genuinely pre-WP row by physically deleting both keys.
      const audited = await answerQuestionAudited(db, ANSWERABLE_TASKS.B1!.question, baseOptions());
      const record = (await loadAuditRecord(db, audited.auditId!)) as AuditRecord;
      expect(reconstructionReport(record).problems).toEqual([]);

      const old = clone(record);
      delete (old.response as { sourceSelection?: unknown }).sourceSelection;
      delete (old.response as { webSection?: unknown }).webSection;
      expect('webSection' in old.response).toBe(false);
      expect(() => reconstructionReport(old)).not.toThrow();
      expect(reconstructionReport(old).problems).toEqual([]);
    } finally {
      await close();
    }
  }, 180_000);

  it('tamper (a): webSection present but sourceSelection.web false ⇒ fails loudly', async () => {
    const { db, close } = await createIngestedDb();
    try {
      const audited = await answerQuestionAudited(db, ANSWERABLE_TASKS.B1!.question, webOptions());
      const record = (await loadAuditRecord(db, audited.auditId!)) as AuditRecord;
      const tampered = clone(record);
      (tampered.response.sourceSelection as SourceSelection).web = false;
      expect(reconstructionReport(tampered).problems).toContain(
        'webSection is present but sourceSelection.web is not true',
      );
    } finally {
      await close();
    }
  }, 180_000);

  it('tamper (c): an ok section with 0 findings ⇒ fails loudly', async () => {
    const { db, close } = await createIngestedDb();
    try {
      const audited = await answerQuestionAudited(db, ANSWERABLE_TASKS.B1!.question, webOptions());
      const record = (await loadAuditRecord(db, audited.auditId!)) as AuditRecord;
      const tampered = clone(record);
      (tampered.response.webSection as { findings: unknown[] }).findings = [];
      expect(reconstructionReport(tampered).problems).toContain(
        'webSection ok must carry 1..4 findings, found 0',
      );
    } finally {
      await close();
    }
  }, 180_000);

  it('tamper (d): a web-owed answer with webSection nulled ⇒ fails loudly (owed-but-unrecorded)', async () => {
    const { db, close } = await createIngestedDb();
    try {
      const audited = await answerQuestionAudited(db, ANSWERABLE_TASKS.B1!.question, webOptions());
      const record = (await loadAuditRecord(db, audited.auditId!)) as AuditRecord;
      const tampered = clone(record);
      (tampered.response as { webSection: unknown }).webSection = null;
      expect(reconstructionReport(tampered).problems).toContain(
        'a web attempt was owed (sourceSelection.web) but no webSection is recorded',
      );
    } finally {
      await close();
    }
  }, 180_000);

  it('tamper (b): a clarification row carrying a webSection ⇒ fails loudly', async () => {
    const { db, close } = await createIngestedDb();
    try {
      // B15 clarifies; the web call is SKIPPED on clarification (webSection
      // null), but the selection still rides the row — a tampered non-null
      // section must be caught.
      const audited = await answerQuestionAudited(db, REFUSAL_TASK_QUESTIONS.B15!, webOptions());
      expect(audited.response.kind).toBe('clarification');
      const record = (await loadAuditRecord(db, audited.auditId!)) as AuditRecord;
      expect(reconstructionReport(record).problems).toEqual([]);
      const tampered = clone(record);
      (tampered.response as { webSection: unknown }).webSection = { status: 'failed', code: 'not_configured' };
      expect(reconstructionReport(tampered).problems).toContain(
        'webSection must be null on clarification rows',
      );
    } finally {
      await close();
    }
  }, 180_000);
});

describe('⟨W1⟩ refusal + ok web section whose audit insert FAILS is stripped (WP129+130)', () => {
  it('B18 forecast refusal + web ok + audit down ⇒ webSection null, auditId null, refusal text intact', async () => {
    const { db, close } = await createIngestedDb();
    try {
      const audited = await answerQuestionAudited(
        withFailingAuditInserts(db),
        REFUSAL_TASK_QUESTIONS.B18!,
        webOptions(),
      );
      expect(audited.response.kind).toBe('refusal');
      if (audited.response.kind !== 'refusal') throw new Error('unreachable');
      expect(audited.response.reason).toBe('forecast');
      // ⟨W1⟩: paid, unverified, unrecorded web content is never shown/kept.
      expect(audited.response.webSection ?? null).toBeNull();
      expect(audited.auditId).toBeNull();
      expect(audited.response.internalNote).toContain('audit write failed');
    } finally {
      await close();
    }
  }, 180_000);
});
