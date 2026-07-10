// WP16 sub-part 2 (ADR 026, design §2/§7): the money orchestration —
// triggerOnboarding charges 100 credits AND queues the fetch in ONE
// transaction. Pins the three result kinds (started / insufficient / duplicate)
// and the exact ledger nets, plus the atomicity guard (a queue-insert failure
// must roll the debit back — never orphan credits). Hermetic PGlite.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { applyPricingDefaults } from '../../src/billing/pricing-apply.ts';
import { getBalance } from '../../src/billing/ledger.ts';
import type { Db } from '../../src/db/types.ts';
import { triggerOnboarding, onboardingPrice } from '../../src/ingestion/onboarding-trigger.ts';
import { findActiveRequest } from '../../src/ingestion/onboarding-store.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

async function withDb(fn: (db: Db) => Promise<void>): Promise<void> {
  const { db, close } = await createTestDb();
  try {
    await fn(db);
  } finally {
    await close();
  }
}

/** A funded user + applied pricing (heavy = 100). Grants `credits` up front. */
async function fundedUser(db: Db, credits: number): Promise<string> {
  await applyPricingDefaults(db);
  const userId = randomUUID();
  await db.query('update signup_grant_config set credits = $1', [credits]);
  await db.query('select public.grant_signup_credits($1)', [userId]);
  return userId;
}

function input(userId: string, overrides: Partial<Parameters<typeof triggerOnboarding>[1]> = {}) {
  return {
    userId,
    requestId: randomUUID(),
    questionText: 'hoeveel zonnestroom werd er opgewekt in 2024',
    tableId: '82610NED',
    topicTerm: 'zonnestroom',
    finderConfidence: 0.91,
    // WP27 stage B: pick first, then a sanitized alternative — the shape the
    // finder constructs; the 'started' test asserts the round-trip.
    candidateIds: ['82610NED', '70072NED'],
    ackAuditAnswerId: null,
    ...overrides,
  };
}

describe('triggerOnboarding — charge + queue, atomically (WP16 sub-part 2)', () => {
  it('onboardingPrice reads the heavy class (=100), never inlined', async () => {
    await withDb(async (db) => {
      await applyPricingDefaults(db);
      expect(await onboardingPrice(db)).toBe(100);
    });
  });

  it('started: debits 100 AND creates a pending row, referencing the debit', async () => {
    await withDb(async (db) => {
      const userId = await fundedUser(db, 150);
      const result = await triggerOnboarding(db, input(userId));
      expect(result.kind).toBe('started');
      if (result.kind !== 'started') throw new Error('unreachable');
      // Ledger: 150 grant − 100 onboarding = 50.
      expect(await getBalance(db, userId)).toBe(50);
      // Queue row exists, active, referencing the debit.
      const active = await findActiveRequest(db, userId, '82610NED');
      expect(active).not.toBeNull();
      expect(active!.debitTransactionId).toBe(result.debitTransactionId);
      expect(active!.status).toBe('pending');
      // WP27 stage B: the candidate chain is persisted and reads back verbatim
      // (pick first); the fit-gate columns start unset.
      expect(active!.candidateIds).toEqual(['82610NED', '70072NED']);
      expect(active!.resolvedTableId).toBeNull();
    });
  });

  it('WP27 stage B deploy-order safety: a PRE-migration-015 schema still triggers (chain dropped, not the tx)', async () => {
    // Between the stage-B code deploy and stage D's supervised migration
    // apply, production runs this code against a schema WITHOUT the candidate
    // columns. The store probes before naming the column, so the money tx
    // must succeed — the chain is dropped for that row and it reads back as
    // [] = the legacy no-fit-gate path (ADR 027 D2c).
    await withDb(async (db) => {
      await db.query(
        `alter table pending_table_requests
           drop column candidate_ids, drop column resolved_table_id, drop column fit_note`,
      );
      const userId = await fundedUser(db, 150);
      const result = await triggerOnboarding(db, input(userId));
      expect(result.kind).toBe('started');
      expect(await getBalance(db, userId)).toBe(50);
      const active = await findActiveRequest(db, userId, '82610NED');
      expect(active).not.toBeNull();
      expect(active!.candidateIds).toEqual([]);
      expect(active!.resolvedTableId).toBeNull();
    });
  });

  it('insufficient: too few credits → NO debit, NO queue row, balance unchanged', async () => {
    await withDb(async (db) => {
      const userId = await fundedUser(db, 40); // < 100
      const result = await triggerOnboarding(db, input(userId));
      expect(result.kind).toBe('insufficient');
      if (result.kind !== 'insufficient') throw new Error('unreachable');
      expect(result.required).toBe(100);
      expect(result.balance).toBe(40);
      expect(await getBalance(db, userId)).toBe(40);
      expect(await findActiveRequest(db, userId, '82610NED')).toBeNull();
    });
  });

  it('duplicate (same request retried): no second debit, no second queue row', async () => {
    await withDb(async (db) => {
      const userId = await fundedUser(db, 300);
      const requestId = randomUUID();
      const first = await triggerOnboarding(db, input(userId, { requestId }));
      expect(first.kind).toBe('started');
      const second = await triggerOnboarding(db, input(userId, { requestId }));
      expect(second.kind).toBe('duplicate');
      // Only ONE 100-credit debit happened: 300 − 100 = 200.
      expect(await getBalance(db, userId)).toBe(200);
    });
  });

  it('duplicate (active job for same user+table under a NEW request): rolls the debit back', async () => {
    await withDb(async (db) => {
      const userId = await fundedUser(db, 300);
      const first = await triggerOnboarding(db, input(userId, { requestId: randomUUID() }));
      expect(first.kind).toBe('started');
      const balanceAfterFirst = await getBalance(db, userId); // 200
      expect(balanceAfterFirst).toBe(200);
      // Second ask, DIFFERENT request but SAME (user, table) still active: the
      // pending_one_active_per_user_table unique index throws inside the tx →
      // the whole tx (including the second debit) rolls back → duplicate.
      const second = await triggerOnboarding(db, input(userId, { requestId: randomUUID() }));
      expect(second.kind).toBe('duplicate');
      // Balance UNCHANGED — the second debit never committed (atomicity).
      expect(await getBalance(db, userId)).toBe(200);
    });
  });

  it('a different table for the same user is NOT a duplicate — a distinct fetch', async () => {
    await withDb(async (db) => {
      const userId = await fundedUser(db, 300);
      const a = await triggerOnboarding(db, input(userId, { requestId: randomUUID(), tableId: '82610NED' }));
      const b = await triggerOnboarding(db, input(userId, { requestId: randomUUID(), tableId: '70072NED' }));
      expect(a.kind).toBe('started');
      expect(b.kind).toBe('started');
      expect(await getBalance(db, userId)).toBe(100); // 300 − 100 − 100
    });
  });

  it('pinned ledger nets (design §2): started nets −100 for the onboarding debit', async () => {
    await withDb(async (db) => {
      // Simulate the full turn: gate debits 20 (question) then refunds 20
      // (refusal), then triggerOnboarding debits 100. Net over the turn: −100.
      const userId = await fundedUser(db, 500);
      const turnRequestId = randomUUID();
      // question debit −20
      await db.query(
        `insert into credit_transactions (user_id, delta, reason, request_id, note)
         values ($1, -20, 'question_cost', $2, 'q')`,
        [userId, turnRequestId],
      );
      const debitRow = await db.query(
        `select id from credit_transactions where user_id = $1 and reason = 'question_cost'`,
        [userId],
      );
      const debitId = Number(debitRow.rows[0]!.id);
      // gate compensation +20
      await db.query(
        `insert into credit_transactions (user_id, delta, reason, related_transaction_id, note)
         values ($1, 20, 'compensation', $2, 'refund')`,
        [userId, debitId],
      );
      // onboarding −100 (same turn's requestId — the onboarding partial index
      // is scoped to onboarding_cost, so it coexists with the question debit).
      const result = await triggerOnboarding(db, input(userId, { requestId: turnRequestId }));
      expect(result.kind).toBe('started');
      // 500 − 20 + 20 − 100 = 400. The onboarding cost is the only net change
      // over the turn (question debit and its compensation cancel).
      expect(await getBalance(db, userId)).toBe(400);
    });
  });
});
