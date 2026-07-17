// #14 (GDPR retention purge + self-service deletion, docs/08-build-plan.md
// WP14): hermetic pins for src/answer/audit/retention.ts. No live database,
// no LLM calls -- pure PGlite + real migrations, exactly the tests/billing/
// history.test.ts pattern this module's read side depends on.
//
// THE CRITICAL SECURITY PIN in this file is 'never touches another user's
// rows' -- deleteUserQuestionHistory is scoped by a bound SQL parameter, and
// this test proves a second user's row survives byte-for-byte untouched.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  REDACTED_QUESTION_TEXT,
  deleteUserQuestionHistory,
  purgeExpiredQuestionHistory,
  twoYearsBefore,
} from '../../src/answer/audit/retention.ts';
import { chargeAndRun } from '../../src/billing/gate.ts';
import { applyPricingDefaults } from '../../src/billing/pricing-apply.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import type { AuditedResponse } from '../../src/answer/audit/index.ts';

async function withDb(fn: (db: Db) => Promise<void>): Promise<void> {
  const { db, close } = await createTestDb();
  try {
    await fn(db);
  } finally {
    await close();
  }
}

/** Minimal audit_answers row -- mirrors tests/billing/history.test.ts's own
 * fixture builder (narrow on purpose: this suite's job is the retention
 * module's SQL, not the envelope's own correctness). */
async function insertAuditRow(
  db: Db,
  userId: string,
  opts: {
    kind: 'answer' | 'clarification' | 'refusal';
    question: string;
    finalText?: string;
    sourceTag?: 'user' | 'benchmark' | 'validation';
    createdAt?: string;
    requestId?: string | null;
  },
): Promise<number> {
  const { rows } = await db.query(
    `insert into audit_answers
       (schema_version, user_id, source_tag, kind, question, reference_date, response, final_text, prompt_versions, latency_ms, request_id, created_at)
     values (1, $1, $2, $3, $4, '2026-01-01', $5::jsonb, $6, '{}'::jsonb, 100, $7, coalesce($8::timestamptz, now()))
     returning id`,
    [
      userId,
      opts.sourceTag ?? 'user',
      opts.kind,
      opts.question,
      JSON.stringify({ kind: opts.kind, question: opts.question, text: opts.finalText ?? opts.question }),
      opts.finalText ?? opts.question,
      opts.requestId ?? null,
      opts.createdAt ?? null,
    ],
  );
  return Number(rows[0]!.id);
}

async function loadRow(db: Db, id: number) {
  const { rows } = await db.query(
    `select id, user_id, source_tag, kind, question, final_text, response, reply_text, pending_clarification
     from audit_answers where id = $1`,
    [id],
  );
  return rows[0] as
    | {
        id: number;
        user_id: string;
        source_tag: string;
        kind: string;
        question: string;
        final_text: string;
        response: unknown;
        reply_text: string | null;
        pending_clarification: unknown;
      }
    | undefined;
}

async function ledgerRows(db: Db, userId: string) {
  const { rows } = await db.query(
    `select id, delta, reason, related_transaction_id, audit_answer_id from credit_transactions where user_id = $1 order by id`,
    [userId],
  );
  return rows;
}

describe('deleteUserQuestionHistory — THE CRITICAL SECURITY PIN: scoped to the calling user only', () => {
  it('deletion-scoped-to-user: redacts only the calling user\'s rows, another user\'s rows survive untouched', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const otherUserId = randomUUID();
      const mineId = await insertAuditRow(db, userId, {
        kind: 'answer',
        question: 'Hoeveel inwoners heeft Nederland?',
      });
      const theirsId = await insertAuditRow(db, otherUserId, {
        kind: 'answer',
        question: 'Hoeveel inwoners heeft Rotterdam?',
      });

      const redacted = await deleteUserQuestionHistory(db, userId);

      expect(redacted).toEqual([{ id: mineId, kind: 'answer' }]);

      const mine = await loadRow(db, mineId);
      expect(mine!.question).toBe(REDACTED_QUESTION_TEXT);

      // The other user's row is untouched -- byte-for-byte, not just "still
      // exists": the original question text is exactly what was inserted.
      const theirs = await loadRow(db, theirsId);
      expect(theirs!.question).toBe('Hoeveel inwoners heeft Rotterdam?');
      expect(theirs!.user_id).toBe(otherUserId);
    });
  });

  it('a user with no rows redacts nothing (no crash, empty result)', async () => {
    await withDb(async (db) => {
      const redacted = await deleteUserQuestionHistory(db, randomUUID());
      expect(redacted).toEqual([]);
    });
  });

  it('redacts question, final_text, response.question and response.text -- no original content survives', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const id = await insertAuditRow(db, userId, {
        kind: 'answer',
        question: 'Wat is het BBP van Nederland?',
        finalText: 'Het BBP van Nederland was 1.000 miljard euro in 2024.',
      });

      await deleteUserQuestionHistory(db, userId);

      const row = await loadRow(db, id);
      expect(row!.question).toBe(REDACTED_QUESTION_TEXT);
      expect(row!.final_text).toBe(REDACTED_QUESTION_TEXT);
      const response = row!.response as { question: string; text: string };
      expect(response.question).toBe(REDACTED_QUESTION_TEXT);
      expect(response.text).toBe(REDACTED_QUESTION_TEXT);
      // No original numbers or free text anywhere in the stored envelope.
      expect(JSON.stringify(row!.response)).not.toContain('BBP');
      expect(JSON.stringify(row!.response)).not.toContain('1.000');
    });
  });

  it('wis-de-inhoud-volledig (owner, session 23): clears the promoted topic columns — subject/region/period do not survive', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const { rows } = await db.query(
        `insert into audit_answers
           (schema_version, user_id, source_tag, kind, question, reference_date, response, final_text, prompt_versions, latency_ms,
            intent, intent_hash, result_ids, table_ids, tables, conversation_context)
         values (1, $1, 'user', 'answer', 'Hoeveel werklozen in Groningen?', '2026-01-01', '{}'::jsonb, 'antwoord', '{}'::jsonb, 100,
            $2::jsonb, 'deadbeef', array['85224NED#c1'], array['85224NED'], $3::jsonb, $4::jsonb)
         returning id`,
        [
          userId,
          JSON.stringify({ target: { kind: 'canonical', key: 'unemployment_rate_seasonally_adjusted' }, regions: ['GM0014'], period: { kind: 'codes', codes: ['2024JJ00'] } }),
          JSON.stringify([{ tableId: '85224NED', tableVersion: 'v1', syncedAt: '2026-07-02' }]),
          JSON.stringify({ version: 1, topicKey: 'unemployment_rate_seasonally_adjusted', regions: [{ name: 'Groningen', kind: 'provincie' }], period: { kind: 'year', year: 2024 } }),
        ],
      );
      const id = Number(rows[0]!.id);

      await deleteUserQuestionHistory(db, userId);

      const { rows: after } = await db.query(
        `select intent, intent_hash, result_ids, table_ids, tables, conversation_context from audit_answers where id = $1`,
        [id],
      );
      const row = after[0] as Record<string, unknown>;
      expect(row.intent).toBeNull();
      expect(row.intent_hash).toBeNull();
      expect(row.result_ids).toEqual([]);
      expect(row.table_ids).toEqual([]);
      expect(row.tables).toEqual([]);
      expect(row.conversation_context).toBeNull();
      // The subject/region must not survive in ANY of the promoted columns.
      const dump = JSON.stringify(row);
      expect(dump).not.toContain('85224NED');
      expect(dump).not.toContain('unemployment');
      expect(dump).not.toContain('Groningen');
      expect(dump).not.toContain('GM0014');
    });
  });

  it('redacts a paired reply_text/pending_clarification together (never violates the reply_round_complete constraint)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const { rows } = await db.query(
        `insert into audit_answers
           (schema_version, user_id, source_tag, kind, question, reference_date, response, final_text, prompt_versions, latency_ms, reply_text, pending_clarification)
         values (1, $1, 'user', 'answer', 'Hoeveel inwoners heeft de gemeente?', '2026-01-01', '{}'::jsonb, 'Amsterdam telt 931.298 inwoners.', '{}'::jsonb, 100, 'Amsterdam', $2::jsonb)
         returning id`,
        [userId, JSON.stringify({ question: 'Hoeveel inwoners heeft de gemeente?', questionNl: 'Welke gemeente?' })],
      );
      const id = Number(rows[0]!.id);

      // Would throw a CHECK-constraint violation if reply_text and
      // pending_clarification were redacted asymmetrically (the
      // reply_round_complete constraint requires their nullability to match).
      await deleteUserQuestionHistory(db, userId);

      const row = await loadRow(db, id);
      expect(row!.reply_text).toBe(REDACTED_QUESTION_TEXT);
      // Stays non-null (paired with reply_text) but its free-text content is
      // gone -- neither the original reply's question nor questionNl survive.
      expect(row!.pending_clarification).not.toBeNull();
      expect(JSON.stringify(row!.pending_clarification)).not.toContain('gemeente');
      expect(JSON.stringify(row!.pending_clarification)).not.toContain('Welke gemeente');
    });
  });

  it('idempotent: redacting an already-redacted row a second time changes nothing further', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const id = await insertAuditRow(db, userId, { kind: 'answer', question: 'Test vraag' });

      const first = await deleteUserQuestionHistory(db, userId);
      const rowAfterFirst = await loadRow(db, id);
      const second = await deleteUserQuestionHistory(db, userId);
      const rowAfterSecond = await loadRow(db, id);

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1); // still matches the where clause -- redaction is a no-op re-write
      expect(rowAfterSecond).toEqual(rowAfterFirst);
    });
  });

  it('purge-scoped-to-user semantics apply here too: a benchmark/validation row for the SAME user id is never touched', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const realId = await insertAuditRow(db, userId, { kind: 'answer', question: 'echte vraag', sourceTag: 'user' });
      const benchmarkId = await insertAuditRow(db, userId, {
        kind: 'answer',
        question: 'benchmark fixture vraag',
        sourceTag: 'benchmark',
      });
      const validationId = await insertAuditRow(db, userId, {
        kind: 'answer',
        question: 'validation fixture vraag',
        sourceTag: 'validation',
      });

      const redacted = await deleteUserQuestionHistory(db, userId);

      expect(redacted.map((r) => r.id)).toEqual([realId]);
      expect((await loadRow(db, benchmarkId))!.question).toBe('benchmark fixture vraag');
      expect((await loadRow(db, validationId))!.question).toBe('validation fixture vraag');
    });
  });
});

describe('deleteUserQuestionHistory / purgeExpiredQuestionHistory — ledger-untouched invariant', () => {
  it('ledger-untouched: credit_transactions rows (debit + compensation) are byte-identical after a self-service deletion', async () => {
    await withDb(async (db) => {
      await applyPricingDefaults(db);
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);

      // Drive a REAL clarification through the REAL gate, so a real
      // compensation row (with audit_answer_id set) exists -- the exact FK
      // shape that would break a hard DELETE.
      const requestId = randomUUID();
      const auditId = await insertAuditRow(db, userId, {
        kind: 'clarification',
        question: 'Hoeveel inwoners heeft de gemeente?',
        requestId,
      });
      const gated = await chargeAndRun(db, userId, requestId, async (): Promise<AuditedResponse> => ({
        response: { kind: 'clarification', question: 'x', text: 'y' } as unknown as AuditedResponse['response'],
        auditId,
      }));
      if (gated.kind !== 'ok') throw new Error(`expected ok, got ${gated.kind}`);

      const before = await ledgerRows(db, userId);
      expect(before.length).toBeGreaterThan(0); // signup grant + debit + compensation

      await deleteUserQuestionHistory(db, userId);

      const after = await ledgerRows(db, userId);
      expect(after).toEqual(before);
    });
  });

  it('ledger-untouched: the retention purge never writes to credit_transactions either', async () => {
    await withDb(async (db) => {
      await applyPricingDefaults(db);
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      const requestId = randomUUID();
      const auditId = await insertAuditRow(db, userId, {
        kind: 'refusal',
        question: 'Wordt het morgen druk?',
        requestId,
        createdAt: '2020-01-01T00:00:00Z',
      });
      const gated = await chargeAndRun(db, userId, requestId, async (): Promise<AuditedResponse> => ({
        response: { kind: 'refusal', question: 'x', text: 'y' } as unknown as AuditedResponse['response'],
        auditId,
      }));
      if (gated.kind !== 'ok') throw new Error(`expected ok, got ${gated.kind}`);

      const before = await ledgerRows(db, userId);
      await purgeExpiredQuestionHistory(db, twoYearsBefore(new Date('2026-01-01T00:00:00Z')));
      const after = await ledgerRows(db, userId);
      expect(after).toEqual(before);
    });
  });

  it('a hard DELETE (not redaction) on a row a compensation references would fail with an FK violation -- proves WHY this module redacts instead', async () => {
    await withDb(async (db) => {
      await applyPricingDefaults(db);
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      const requestId = randomUUID();
      const auditId = await insertAuditRow(db, userId, { kind: 'refusal', question: 'x' });
      const gated = await chargeAndRun(db, userId, requestId, async (): Promise<AuditedResponse> => ({
        response: { kind: 'refusal', question: 'x', text: 'y' } as unknown as AuditedResponse['response'],
        auditId,
      }));
      if (gated.kind !== 'ok') throw new Error(`expected ok, got ${gated.kind}`);

      await expect(db.query('delete from audit_answers where id = $1', [auditId])).rejects.toThrow(
        /foreign key constraint/i,
      );
    });
  });
});

describe('purgeExpiredQuestionHistory — retention window + idempotency', () => {
  const NOW = new Date('2026-07-05T00:00:00Z');

  it('twoYearsBefore computes exactly a 2-year-earlier UTC instant', () => {
    expect(twoYearsBefore(NOW).toISOString()).toBe('2024-07-05T00:00:00.000Z');
  });

  it('redacts only rows older than the cutoff; a row exactly at the cutoff is NOT purged (strict <)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const cutoff = twoYearsBefore(NOW);
      const oldId = await insertAuditRow(db, userId, {
        kind: 'answer',
        question: 'oude vraag',
        createdAt: new Date(cutoff.getTime() - 1000).toISOString(),
      });
      const atCutoffId = await insertAuditRow(db, userId, {
        kind: 'answer',
        question: 'exact op de grens',
        createdAt: cutoff.toISOString(),
      });
      const recentId = await insertAuditRow(db, userId, {
        kind: 'answer',
        question: 'recente vraag',
        createdAt: new Date(cutoff.getTime() + 1000 * 60 * 60 * 24 * 30).toISOString(),
      });

      const redacted = await purgeExpiredQuestionHistory(db, cutoff);

      expect(redacted.map((r) => r.id)).toEqual([oldId]);
      expect((await loadRow(db, atCutoffId))!.question).toBe('exact op de grens');
      expect((await loadRow(db, recentId))!.question).toBe('recente vraag');
    });
  });

  it('purge-scoped-to-user: a benchmark-tagged row older than 2 years SURVIVES a purge', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const cutoff = twoYearsBefore(NOW);
      const old = new Date(cutoff.getTime() - 1000).toISOString();
      const benchmarkId = await insertAuditRow(db, userId, {
        kind: 'answer',
        question: 'benchmark frozen-key vraag',
        sourceTag: 'benchmark',
        createdAt: old,
      });
      const validationId = await insertAuditRow(db, userId, {
        kind: 'answer',
        question: 'validation pass vraag',
        sourceTag: 'validation',
        createdAt: old,
      });
      const userRowId = await insertAuditRow(db, userId, {
        kind: 'answer',
        question: 'echte oude gebruikersvraag',
        sourceTag: 'user',
        createdAt: old,
      });

      const redacted = await purgeExpiredQuestionHistory(db, cutoff);

      expect(redacted.map((r) => r.id)).toEqual([userRowId]);
      expect((await loadRow(db, benchmarkId))!.question).toBe('benchmark frozen-key vraag');
      expect((await loadRow(db, validationId))!.question).toBe('validation pass vraag');
    });
  });

  it('purge-idempotent: a second run against the same cutoff redacts nothing new', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const cutoff = twoYearsBefore(NOW);
      await insertAuditRow(db, userId, {
        kind: 'answer',
        question: 'oude vraag',
        createdAt: new Date(cutoff.getTime() - 1000).toISOString(),
      });

      const first = await purgeExpiredQuestionHistory(db, cutoff);
      const second = await purgeExpiredQuestionHistory(db, cutoff);

      expect(first).toHaveLength(1);
      // The row still matches source_tag='user' AND created_at < cutoff (its
      // created_at is untouched by redaction), so the SELECT still finds it —
      // idempotency here means "redacts nothing NEW", i.e. re-writing the
      // identical sentinel values, never a second distinct change and never
      // an error.
      expect(second).toHaveLength(1);
      const rowsAfterFirst = await loadRow(db, first[0]!.id);
      const rowsAfterSecond = await loadRow(db, second[0]!.id);
      expect(rowsAfterSecond).toEqual(rowsAfterFirst);
    });
  });

  it('purging with no matching rows returns an empty array (no crash)', async () => {
    await withDb(async (db) => {
      const redacted = await purgeExpiredQuestionHistory(db, twoYearsBefore(NOW));
      expect(redacted).toEqual([]);
    });
  });
});

describe('anonymous_trial rows (#53, ADR 036 D4 — session 52 scope widening)', () => {
  const NOW = new Date('2026-07-05T00:00:00Z');

  /** user_id NULL + the migration-020 tag: the shape every trial answer writes. */
  async function insertAnonymousTrialRow(db: Db, question: string, createdAt: string): Promise<number> {
    const { rows } = await db.query(
      `insert into audit_answers
         (schema_version, user_id, source_tag, kind, question, reference_date, response, final_text, prompt_versions, latency_ms, created_at)
       values (1, null, 'anonymous_trial', 'answer', $1, '2026-01-01', $2::jsonb, $1, '{}'::jsonb, 100, $3::timestamptz)
       returning id`,
      [question, JSON.stringify({ kind: 'answer', question, text: question }), createdAt],
    );
    return Number(rows[0]!.id);
  }

  it('the 2-year purge SWEEPS an expired anonymous row (user_id null is no shield)', async () => {
    await withDb(async (db) => {
      const oldId = await insertAnonymousTrialRow(db, 'Wat is de inflatie?', '2023-01-01T00:00:00Z');
      const youngId = await insertAnonymousTrialRow(db, 'Wat doet het bbp?', '2026-07-01T00:00:00Z');
      const redacted = await purgeExpiredQuestionHistory(db, twoYearsBefore(NOW));
      expect(redacted.map((r) => r.id)).toEqual([oldId]);
      const oldRow = await loadRow(db, oldId);
      expect(oldRow!.question).not.toContain('inflatie');
      const youngRow = await loadRow(db, youngId);
      expect(youngRow!.question).toBe('Wat doet het bbp?');
    });
  });

  it('self-service deletion NEVER touches anonymous rows (its WHERE binds user_id)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const anonId = await insertAnonymousTrialRow(db, 'Wat is de inflatie?', '2026-07-01T00:00:00Z');
      await insertAuditRow(db, userId, { kind: 'answer', question: 'mijn eigen vraag' });
      const redacted = await deleteUserQuestionHistory(db, userId);
      expect(redacted).toHaveLength(1);
      const anonRow = await loadRow(db, anonId);
      expect(anonRow!.question).toBe('Wat is de inflatie?');
    });
  });
});
