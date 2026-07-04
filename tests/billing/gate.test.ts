// The billing gate (src/billing/gate.ts, ADR 020): debit-before-answer with
// automatic compensation. `run` is stubbed here — gate.ts's real contract
// with the answer pipeline is narrow (it only ever reads `response.kind` and
// `auditId`), so these fakes are deliberately shallow rather than full,
// R1/R3-valid ComposedResponse objects (those invariants are the answer
// pipeline's own tests' job, not this gate's).
//
// Values below match docs/09-pricing.md (the current-values reference):
// signup grant 100, simple 20, clarification 10 — so a clarification outcome
// genuinely triggers a partial refund at TODAY's prices, not just in a
// simulated future-price scenario.
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { AuditedResponse } from '../../src/answer/audit/index.ts';
import { chargeAndRun } from '../../src/billing/gate.ts';
import { getBalance } from '../../src/billing/ledger.ts';
import { applyPricingDefaults } from '../../src/billing/pricing-apply.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

function fakeAudited(kind: 'answer' | 'clarification' | 'refusal', auditId: number | null): AuditedResponse {
  return {
    response: { kind, question: 'test', text: 'test' } as unknown as AuditedResponse['response'],
    auditId,
  };
}

async function withPricedDb(fn: (db: Db) => Promise<void>): Promise<void> {
  const { db, close } = await createTestDb();
  try {
    await applyPricingDefaults(db);
    await fn(db);
  } finally {
    await close();
  }
}

describe('chargeAndRun — insufficient balance', () => {
  it('never invokes run() when the balance is too low, and debits nothing', async () => {
    await withPricedDb(async (db) => {
      const userId = randomUUID();
      const run = vi.fn(async () => fakeAudited('answer', 1));
      const result = await chargeAndRun(db, userId, randomUUID(), run);
      expect(result).toEqual({ kind: 'insufficient_credits', balance: 0, required: 20 });
      expect(run).not.toHaveBeenCalled();
      expect(await getBalance(db, userId)).toBe(0);
    });
  });
});

describe('chargeAndRun — a real answer', () => {
  it('debits before running, keeps the debit, and returns kind "ok"', async () => {
    await withPricedDb(async (db) => {
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      const run = vi.fn(async () => fakeAudited('answer', 42));
      const result = await chargeAndRun(db, userId, randomUUID(), run);
      expect(result).toMatchObject({ kind: 'ok', netCost: 20 });
      expect(run).toHaveBeenCalledTimes(1);
      expect(await getBalance(db, userId)).toBe(80); // 100 signup - 20 debit, no compensation
    });
  });
});

describe('chargeAndRun — clarifications cost the flat clarification price (open-questions #58)', () => {
  // auditId is null in these fakes: credit_transactions.audit_answer_id has a
  // real FK to audit_answers(id) (migration 005), and gate.ts's own contract
  // with the pipeline is only ever "what response.kind came back, and — if
  // known — its real audit row id"; null is the legitimate value for the
  // (rare) case where the audit write itself also failed, and exercises the
  // same code path as a real id would without needing a fabricated
  // audit_answers row this suite doesn't otherwise need.
  it('refunds the difference (20 debited - 10 owed = 10 refunded), net cost the flat clarification price', async () => {
    await withPricedDb(async (db) => {
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      const run = vi.fn(async () => fakeAudited('clarification', null));
      const result = await chargeAndRun(db, userId, randomUUID(), run);
      expect(result).toMatchObject({ kind: 'ok', netCost: 10 });
      expect(await getBalance(db, userId)).toBe(90); // 100 - 20 debit + 10 compensation = net 10 cost
      const { rows } = await db.query(
        "select delta from credit_transactions where user_id = $1 and reason = 'compensation'",
        [userId],
      );
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.delta)).toBe(10);
    });
  });

  it('skips the compensation row entirely once the price gap is closed (no non-positive delta ever attempted)', async () => {
    await withPricedDb(async (db) => {
      // Simulates a price change where simple == clarification — proves the
      // "refund > 0" guard, not just today's real 10-credit gap.
      await db.query("update action_class_prices set credits = 10 where action_class = 'simple'");
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      const run = vi.fn(async () => fakeAudited('clarification', null));
      const result = await chargeAndRun(db, userId, randomUUID(), run);
      expect(result).toMatchObject({ kind: 'ok', netCost: 10 });
      expect(await getBalance(db, userId)).toBe(90); // 100 - 10, no compensation needed
      const { rows } = await db.query(
        "select count(*) c from credit_transactions where user_id = $1 and reason = 'compensation'",
        [userId],
      );
      expect(Number(rows[0]!.c)).toBe(0);
    });
  });

  it('refunds in full when the pipeline returns a refusal', async () => {
    await withPricedDb(async (db) => {
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      const run = vi.fn(async () => fakeAudited('refusal', null));
      const result = await chargeAndRun(db, userId, randomUUID(), run);
      expect(result).toMatchObject({ kind: 'ok', netCost: 0 });
      expect(await getBalance(db, userId)).toBe(100);
    });
  });

  it('refunds in full when run() throws, then rethrows the original error', async () => {
    await withPricedDb(async (db) => {
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      const run = vi.fn(async () => {
        throw new Error('pipeline exploded');
      });
      await expect(chargeAndRun(db, userId, randomUUID(), run)).rejects.toThrow('pipeline exploded');
      expect(await getBalance(db, userId)).toBe(100);
    });
  });
});

describe('chargeAndRun — duplicate request', () => {
  it('a repeated requestId short-circuits to duplicate_request without re-invoking run()', async () => {
    await withPricedDb(async (db) => {
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      const requestId = randomUUID();
      const run = vi.fn(async () => fakeAudited('answer', 45));

      const first = await chargeAndRun(db, userId, requestId, run);
      expect(first.kind).toBe('ok');
      expect(run).toHaveBeenCalledTimes(1);

      const second = await chargeAndRun(db, userId, requestId, run);
      expect(second).toEqual({ kind: 'duplicate_request' });
      expect(run).toHaveBeenCalledTimes(1); // NOT called again
      expect(await getBalance(db, userId)).toBe(80); // charged exactly once
    });
  });
});
