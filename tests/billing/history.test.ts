// getQuestionHistory (src/billing/history.ts, migration 010): reconstructs a
// past question's net cost by joining audit_answers.request_id back to the
// credit ledger — the debit (by request_id) and any compensation (by
// audit_answer_id), exactly mirroring src/billing/gate.ts's own arithmetic.
//
// The core pin here is CONSISTENCY, not arithmetic: the first test drives the
// REAL chargeAndRun (with real pricing config) and asserts history reports the
// same netCost the gate returned — so a pricing change or a gate-math change
// can never silently desynchronize what a user was charged from what the
// dashboard tells them they were charged (adversarial-review finding: an
// earlier version hardcoded the refund amounts and would have missed exactly
// that drift).
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AuditedResponse } from '../../src/answer/audit/index.ts';
import { chargeAndRun } from '../../src/billing/gate.ts';
import { getQuestionHistory } from '../../src/billing/history.ts';
import { applyPricingDefaults } from '../../src/billing/pricing-apply.ts';
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

/** Minimal audit_answers row -- a real ComposedResponse envelope has many
 * more fields than getQuestionHistory ever reads (it only selects question,
 * final_text, kind, created_at, request_id), so this fixture deliberately
 * stays narrow rather than constructing a full valid envelope (that
 * correctness is src/answer/audit/'s own tests' job, not this join's). */
async function insertAuditRow(
  db: Db,
  userId: string,
  opts: { kind: 'answer' | 'clarification' | 'refusal'; question: string; finalText: string; requestId: string | null },
): Promise<number> {
  const { rows } = await db.query(
    `insert into audit_answers
       (schema_version, user_id, source_tag, kind, question, reference_date, response, final_text, prompt_versions, latency_ms, request_id)
     values (1, $1, 'user', $2, $3, '2026-01-01', '{}'::jsonb, $4, '{}'::jsonb, 100, $5)
     returning id`,
    [userId, opts.kind, opts.question, opts.finalText, opts.requestId],
  );
  return Number(rows[0]!.id);
}

describe('getQuestionHistory — reconstruction matches what the gate actually charged', () => {
  // One test per outcome kind, each running the REAL chargeAndRun against the
  // REAL pricing config: whatever netCost the gate returns, history must
  // reconstruct the identical number from the ledger rows alone. No expected
  // values are hardcoded here on purpose — the pin is gate/history agreement,
  // which survives any future price change.
  for (const kind of ['answer', 'clarification', 'refusal'] as const) {
    it(`creditsCharged equals the gate's own netCost for a ${kind}`, async () => {
      await withDb(async (db) => {
        await applyPricingDefaults(db);
        const userId = randomUUID();
        await db.query('select public.grant_signup_credits($1)', [userId]);
        const requestId = randomUUID();
        // The audit row exists before the gate compensates (mirroring the real
        // wrap order: respond-audited writes the row inside run(), then the
        // gate compensates against its id).
        const auditId = await insertAuditRow(db, userId, {
          kind,
          question: 'Hoeveel inwoners heeft Nederland?',
          finalText: 'testantwoord',
          requestId,
        });
        const gated = await chargeAndRun(db, userId, requestId, async (): Promise<AuditedResponse> => ({
          response: { kind, question: 'test', text: 'testantwoord' } as unknown as AuditedResponse['response'],
          auditId,
        }));
        if (gated.kind !== 'ok') throw new Error(`expected ok, got ${gated.kind}`);

        const history = await getQuestionHistory(db, userId);
        const entry = history.find((h) => h.id === auditId);
        expect(entry).toBeDefined();
        expect(entry!.kind).toBe(kind);
        expect(entry!.creditsCharged).toBe(gated.netCost);
      });
    });
  }

  it('reports null cost when the row has no request_id (nothing to attribute a debit to)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await insertAuditRow(db, userId, {
        kind: 'answer',
        question: 'Oude rij zonder request_id',
        finalText: 'test',
        requestId: null,
      });

      const history = await getQuestionHistory(db, userId);
      expect(history[0]).toMatchObject({ creditsCharged: null });
    });
  });

  it('orders most-recent-first and respects the limit', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      for (const question of ['eerste', 'tweede', 'derde']) {
        await insertAuditRow(db, userId, { kind: 'answer', question, finalText: 'x', requestId: null });
      }

      const history = await getQuestionHistory(db, userId, { limit: 2 });
      expect(history).toHaveLength(2);
      expect(history.map((h) => h.question)).toEqual(['derde', 'tweede']);
    });
  });

  it('never returns another user\'s rows', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const otherUserId = randomUUID();
      await insertAuditRow(db, otherUserId, { kind: 'answer', question: 'niet van mij', finalText: 'x', requestId: null });

      const history = await getQuestionHistory(db, userId);
      expect(history).toHaveLength(0);
    });
  });
});
