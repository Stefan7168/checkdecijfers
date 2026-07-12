// Migration 013 (WP16 sub-part 2, ADR 026): the compensation-guard widening
// (compensate may now reverse an onboarding_cost debit) and the audit_answers
// source_tag widening ('onboarding_delivery'). Verifies the DB behavior, not
// just "the file applies" — per CLAUDE.md's structural-not-pattern-based bar.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compensate, debitOnboarding, debitQuestion, getBalance } from '../../src/billing/ledger.ts';
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

describe('migration 013 — compensation may reverse an onboarding_cost debit', () => {
  it('accepts a compensation reversing an onboarding_cost row (the CORE-2 refund path)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await db.query('update signup_grant_config set credits = 200');
      await db.query('select public.grant_signup_credits($1)', [userId]);
      const debit = await debitOnboarding(db, userId, randomUUID(), 100);
      expect(debit).not.toBeNull();
      const refund = await compensate(db, userId, debit!.id, 100, null);
      expect(refund).not.toBeNull();
      // 200 grant − 100 onboarding + 100 refund = 200 net.
      expect(await getBalance(db, userId)).toBe(200);
    });
  });

  it('still accepts a compensation reversing a question_cost row (regression)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const debit = await debitQuestion(db, userId, randomUUID(), 20);
      const refund = await compensate(db, userId, debit!.id, 20, null);
      expect(refund).not.toBeNull();
    });
  });

  it('still rejects a compensation reversing a signup_grant row (the guard is not disabled)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      const { rows } = await db.query(
        "select id from credit_transactions where user_id = $1 and reason = 'signup_grant'",
        [userId],
      );
      await expect(
        db.query(
          `insert into credit_transactions (user_id, delta, reason, related_transaction_id, note)
           values ($1, 5, 'compensation', $2, 'bad target')`,
          [userId, Number(rows[0]!.id)],
        ),
        // The guard function is later replaced by migration 018 (WP129+130),
        // which widens the allowlist to add 'websearch_cost' — all migrations
        // run in these hermetic tests, so the message names all three permitted
        // reasons. A signup_grant is still correctly rejected either way.
      ).rejects.toThrow(/must reverse a question_cost, onboarding_cost or websearch_cost row/);
    });
  });
});

describe('migration 013 — audit_answers source_tag accepts onboarding_delivery', () => {
  it('accepts the new tag and still rejects a bogus one', async () => {
    await withDb(async (db) => {
      // A minimal audit_answers insert with the new source_tag succeeds.
      await db.query(
        `insert into audit_answers
           (schema_version, source_tag, kind, question, reference_date, final_text, response, prompt_versions, latency_ms)
         values (1, 'onboarding_delivery', 'answer', 'q', '2026-07-06', 'x', '{}'::jsonb, '{}'::jsonb, 0)`,
      );
      await expect(
        db.query(
          `insert into audit_answers
             (schema_version, source_tag, kind, question, reference_date, final_text, response, prompt_versions, latency_ms)
           values (1, 'nonsense_tag', 'answer', 'q', '2026-07-06', 'x', '{}'::jsonb, '{}'::jsonb, 0)`,
        ),
      ).rejects.toThrow();
    });
  });
});
