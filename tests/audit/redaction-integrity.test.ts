// #133(b) — redaction-integrity check for GDPR-redacted audit rows
// (docs/session-briefs/2026-07-12-smalls-133-brief.md §1, ADR 016's as-built
// addendum). Hermetic pins for src/answer/audit/retention.ts's
// redactionIntegrityReport: no live database beyond PGlite, no LLM calls —
// the same harness idioms tests/audit/retention.test.ts (insert-row
// fixtures) and tests/audit/audit-records.test.ts (the clone-and-tamper
// idiom) already use.
//
// Three halves:
//  (a) end-to-end: a real row, redacted through the real
//      deleteUserQuestionHistory path, must report ok with zero problems —
//      for all three response kinds, including a clarification-with-reply
//      row (the non-null replyText/pendingClarification branch).
//  (b) tamper tests (audit-records.test.ts's "reconstruction has teeth"
//      idiom, applied here): clone a genuinely redacted record, break exactly
//      ONE thing the check is supposed to catch, and assert it fails —
//      proving every clause in redactionIntegrityReport actually does
//      something, not merely that it returns {ok:true} on happy-path input.
//  (c) a DB-free unit-test pass for classifyKnownDivergence (#133(a)) — pure
//      function, no fixtures needed.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  REDACTED_QUESTION_TEXT,
  deleteUserQuestionHistory,
  redactionIntegrityReport,
  loadAuditRecord,
  classifyKnownDivergence,
} from '../../src/answer/audit/index.ts';
import type { AuditRecord, KnownDivergence } from '../../src/answer/audit/index.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

async function withDb(fn: (db: Db) => Promise<void>): Promise<void> {
  const { db, close } = await createTestDb();
  try {
    await fn(db);
  } finally {
    await close();
  }
}

/** Minimal audit_answers row -- mirrors tests/audit/retention.test.ts's own
 * fixture builder (narrow on purpose: this suite's job is the redaction
 * CHECK, not the envelope's own correctness), extended with
 * replyText/pendingClarification so a "clarification-with-reply" row (a
 * completed reply round) can be built too. */
async function insertAuditRow(
  db: Db,
  userId: string,
  opts: {
    kind: 'answer' | 'clarification' | 'refusal';
    question: string;
    finalText?: string;
    replyText?: string | null;
    pendingClarification?: Record<string, unknown> | null;
  },
): Promise<number> {
  const { rows } = await db.query(
    `insert into audit_answers
       (schema_version, user_id, source_tag, kind, question, reference_date, response, final_text, prompt_versions, latency_ms, reply_text, pending_clarification)
     values (1, $1, 'user', $2, $3, '2026-01-01', $4::jsonb, $5, '{}'::jsonb, 100, $6, $7::jsonb)
     returning id`,
    [
      userId,
      opts.kind,
      opts.question,
      JSON.stringify({ kind: opts.kind, question: opts.question, text: opts.finalText ?? opts.question }),
      opts.finalText ?? opts.question,
      opts.replyText ?? null,
      opts.pendingClarification ? JSON.stringify(opts.pendingClarification) : null,
    ],
  );
  return Number(rows[0]!.id);
}

const CLARIFICATION_FIXTURE = {
  version: 1,
  question: 'Which municipality?',
  questionNl: 'Welke gemeente?',
  options: [],
  axes: [],
};

/** Deep-clone via JSON round-trip, the exact idiom
 * tests/audit/audit-records.test.ts's tamper suite uses -- tampering the
 * clone must never affect a row still sitting in the database. */
const clone = (record: AuditRecord): AuditRecord => JSON.parse(JSON.stringify(record)) as AuditRecord;

describe('redactionIntegrityReport — end-to-end via deleteUserQuestionHistory', () => {
  it('a redacted answer row reports ok with zero problems', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const id = await insertAuditRow(db, userId, {
        kind: 'answer',
        question: 'Wat is het BBP van Nederland?',
        finalText: 'Het BBP van Nederland was 1.000 miljard euro in 2024.',
      });

      await deleteUserQuestionHistory(db, userId);
      const record = await loadAuditRecord(db, id);

      expect(redactionIntegrityReport(record!)).toEqual({ ok: true, problems: [] });
    });
  });

  it('a redacted refusal row reports ok with zero problems', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const id = await insertAuditRow(db, userId, { kind: 'refusal', question: 'Wordt het morgen druk?' });

      await deleteUserQuestionHistory(db, userId);
      const record = await loadAuditRecord(db, id);

      expect(redactionIntegrityReport(record!)).toEqual({ ok: true, problems: [] });
    });
  });

  it('a redacted clarification-with-reply row (a completed reply round) reports ok with zero problems', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const id = await insertAuditRow(db, userId, {
        kind: 'clarification',
        question: 'Hoeveel inwoners heeft de gemeente?',
        replyText: 'Amsterdam',
        pendingClarification: CLARIFICATION_FIXTURE,
      });

      await deleteUserQuestionHistory(db, userId);
      const record = await loadAuditRecord(db, id);

      // The pairing survives redaction (both stay non-null, per retention.ts's
      // reply_round_complete discipline) — this exercises the non-null
      // pending_clarification branch of the shape check, not just the
      // both-null branch the answer/refusal cases above cover.
      expect(record!.replyText).not.toBeNull();
      expect(record!.pendingClarification).not.toBeNull();
      expect(redactionIntegrityReport(record!)).toEqual({ ok: true, problems: [] });
    });
  });
});

describe('redactionIntegrityReport — tamper tests: every check can fail', () => {
  async function redactedAnswerRecord(db: Db): Promise<AuditRecord> {
    const userId = randomUUID();
    const id = await insertAuditRow(db, userId, { kind: 'answer', question: 'Wat is het BBP van Nederland?' });
    await deleteUserQuestionHistory(db, userId);
    const record = await loadAuditRecord(db, id);
    if (record === null) throw new Error('unreachable: row was just inserted and redacted');
    return record;
  }

  async function redactedClarificationWithReplyRecord(db: Db): Promise<AuditRecord> {
    const userId = randomUUID();
    const id = await insertAuditRow(db, userId, {
      kind: 'clarification',
      question: 'Hoeveel inwoners heeft de gemeente?',
      replyText: 'Amsterdam',
      pendingClarification: CLARIFICATION_FIXTURE,
    });
    await deleteUserQuestionHistory(db, userId);
    const record = await loadAuditRecord(db, id);
    if (record === null) throw new Error('unreachable: row was just inserted and redacted');
    return record;
  }

  it('fails when a leftover `answer` key survives inside response — the failed-redaction signature #133 names by name', async () => {
    await withDb(async (db) => {
      const record = clone(await redactedAnswerRecord(db));
      (record.response as unknown as Record<string, unknown>).answer = { body: 'leaked original content' };

      const report = redactionIntegrityReport(record);

      expect(report.ok).toBe(false);
      expect(report.problems.some((p) => p.includes('response') && p.includes('answer'))).toBe(true);
    });
  });

  it('fails when question is not the redaction sentinel', async () => {
    await withDb(async (db) => {
      const record = clone(await redactedAnswerRecord(db));
      record.question = 'Wat is het BBP van Nederland?';

      const report = redactionIntegrityReport(record);

      expect(report.ok).toBe(false);
      expect(report.problems.some((p) => p.includes('question is not the redaction sentinel'))).toBe(true);
    });
  });

  it('fails when result_ids is not empty', async () => {
    await withDb(async (db) => {
      const record = clone(await redactedAnswerRecord(db));
      record.resultIds = ['85224NED#c1'];

      const report = redactionIntegrityReport(record);

      expect(report.ok).toBe(false);
      expect(report.problems.some((p) => p.includes('result_ids is not an empty array'))).toBe(true);
    });
  });

  it('fails when reply_text and pending_clarification are unpaired (violates reply_round_complete)', async () => {
    await withDb(async (db) => {
      const record = clone(await redactedClarificationWithReplyRecord(db));
      // replyText stays the sentinel (non-null); nulling only pending_clarification
      // breaks the pairing the reply_round_complete CHECK constraint enforces
      // on the write side — this proves the read-side re-check catches it too.
      record.pendingClarification = null;

      const report = redactionIntegrityReport(record);

      expect(report.ok).toBe(false);
      expect(report.problems.some((p) => p.includes('not paired'))).toBe(true);
    });
  });

  it('fails when an extra key survives inside pending_clarification', async () => {
    await withDb(async (db) => {
      const record = clone(await redactedClarificationWithReplyRecord(db));
      (record.pendingClarification as unknown as Record<string, unknown>).leakedTopic = 'Groningen';

      const report = redactionIntegrityReport(record);

      expect(report.ok).toBe(false);
      expect(
        report.problems.some((p) => p.includes('pending_clarification') && p.includes('leakedTopic')),
      ).toBe(true);
    });
  });

  it('fails when kind inside response does not match the redacted shape for the row', async () => {
    await withDb(async (db) => {
      const record = clone(await redactedAnswerRecord(db));
      (record.response as unknown as Record<string, unknown>).kind = 'refusal';

      const report = redactionIntegrityReport(record);

      expect(report.ok).toBe(false);
      expect(report.problems.some((p) => p.includes('response.kind'))).toBe(true);
    });
  });

  it('never throws on a malformed record — reports a problem instead', () => {
    const malformed = { kind: 'answer', response: null } as unknown as AuditRecord;

    expect(() => redactionIntegrityReport(malformed)).not.toThrow();
    const report = redactionIntegrityReport(malformed);
    expect(report.ok).toBe(false);
    expect(report.problems.length).toBeGreaterThan(0);
  });
});

describe('classifyKnownDivergence — pure, no DB', () => {
  const entry: KnownDivergence = {
    id: 76,
    kind: 'answer',
    expectProblemsContaining: ['chart spec does not re-derive from the stored result'],
    cause: 'test fixture cause',
    recordedDate: '2026-07-12',
  };

  it("'matches' when every problem contains one of the entry's expected substrings", () => {
    expect(classifyKnownDivergence(['chart spec does not re-derive from the stored result'], entry)).toBe('matches');
  });

  it("'matches' still holds with multiple problems, as long as each one matches", () => {
    const multiSubstringEntry: KnownDivergence = {
      ...entry,
      expectProblemsContaining: [
        'chart spec does not re-derive from the stored result',
        'stored chart spec fails schema validation',
      ],
    };
    expect(
      classifyKnownDivergence(
        ['chart spec does not re-derive from the stored result', 'stored chart spec fails schema validation: x'],
        multiSubstringEntry,
      ),
    ).toBe('matches');
  });

  it("'unexpected' when at least one problem matches none of the expected substrings", () => {
    expect(
      classifyKnownDivergence(
        ['chart spec does not re-derive from the stored result', 'result_ids differ from the stored result cells'],
        entry,
      ),
    ).toBe('unexpected');
  });

  it("'stale' when problems is empty — the row reconstructs clean now", () => {
    expect(classifyKnownDivergence([], entry)).toBe('stale');
  });
});
