// The on-demand CBS onboarding TRIGGER (WP16 sub-part 2, ADR 026, design §2):
// after the answer pipeline has produced an 'onboarding_pending' acknowledgment
// (finder found a confident table for an unloaded topic), the web action calls
// this to actually charge the 100-credit onboarding cost AND queue the fetch —
// ATOMICALLY, in ONE transaction (design §0.3). It lives in the ingestion
// module (not src/answer, not src/billing): billing must not leak into the
// answer module (gate.ts's "wraps from the OUTSIDE" boundary), and the queue
// row it creates is ingestion's own concern.
//
// Why it composes the ledger primitives inline instead of calling
// reserveOnboardingDebit: this project's withTransaction cannot nest (both
// src/db/client.ts and the PGlite test harness throw on a nested BEGIN), and
// reserveOnboardingDebit opens its own transaction. To keep the debit and the
// pending-row insert in the SAME transaction — so a failed queue insert rolls
// the debit back, never orphaning credits — the trigger opens one tx and does
// the advisory-lock + balance-check + debit + queue-insert itself, exactly the
// reserveOnboardingDebit pattern but with the extra insert inside the same
// commit. reserveOnboardingDebit stays for standalone/tested single use.
import { debitOnboarding, getActionClassPrice, getBalance } from '../billing/ledger.ts';
import type { Db } from '../db/types.ts';
import { createPendingRequest } from './onboarding-store.ts';

export interface TriggerOnboardingInput {
  userId: string;
  /** The chat turn's requestId — the ledger idempotency key AND the
   * pending-row's request_id (one onboarding debit per (user, request)). */
  requestId: string;
  /** The original question, re-run verbatim at delivery (design §0.4). */
  questionText: string;
  /** The finder's confident pick. */
  tableId: string;
  /** The unmatched topic term the finder matched on. */
  topicTerm: string;
  /** The finder's 0..1 confidence in the pick. */
  finderConfidence: number;
  /** WP27 stage B (ADR 027 D2a): the finder's candidate chain (pick first,
   * then sanitized alternativeIds, cap 3) — persisted on the pending row for
   * stage C's fit gate. REQUIRED, not optional: an optional carrier is exactly
   * how a chain link gets silently skipped (PR-#17 review). The trigger only
   * CARRIES it; debit amount, idempotency keys and refund semantics are
   * untouched (the money invariant). */
  candidateIds: string[];
  /** The acknowledgment's audit_answers row id, when it was recorded. Stored
   * on the pending row for the dashboard join; null when the audit write
   * failed (the acknowledgment still shows, per respond-audited's fail-closed
   * policy — the queue entry just can't back-reference it). */
  ackAuditAnswerId: number | null;
}

export type TriggerOnboardingResult =
  /** Debited 100 + queued the fetch. Show the acknowledgment; the turn's net
   * cost is 100 (the 20-credit question debit was refunded by the gate). */
  | { kind: 'started'; debitTransactionId: number; pendingId: number }
  /** Not enough credits for the 100-credit fetch — nothing was debited and no
   * row was queued. The web action shows the existing insufficient-credits UI
   * with required: 100; the audited acknowledgment exists but is not rendered
   * (documented decision, design §2). */
  | { kind: 'insufficient'; balance: number; required: number }
  /** A concurrent/retried trigger already debited this (user, request), OR an
   * active job already exists for this (user, table) — either way no second
   * debit and no second queue entry. Show the acknowledgment again. */
  | { kind: 'duplicate' };

/** The onboarding-cost price ('heavy' class = 100 credits, ADR 026 — reuses
 * the existing heavy price rather than a new pricing row). Read from the DB,
 * never inlined (ADR 006), like every other price. */
export async function onboardingPrice(db: Db): Promise<number> {
  return getActionClassPrice(db, 'heavy');
}

/**
 * Charge + queue, atomically. Money boundary lives here (ingestion), not in
 * the answer module. The unique indexes from migration 012 are the structural
 * backstops:
 *  - credit_transactions_one_onboarding_per_request → a second onboarding
 *    debit for the same (user, request) is a no-op (debitOnboarding returns
 *    null) → 'duplicate'.
 *  - pending_one_active_per_user_table → a second active queue row for the
 *    same (user, table) throws a unique-violation, which aborts the tx (the
 *    debit rolls back too) → we translate it to 'duplicate' (no charge).
 * The per-user advisory lock serializes concurrent triggers for one user so
 * the balance check and debit can't race (the reserveDebit pattern).
 */
export async function triggerOnboarding(
  db: Db,
  input: TriggerOnboardingInput,
): Promise<TriggerOnboardingResult> {
  const required = await onboardingPrice(db);
  try {
    return await db.withTransaction(async (tx) => {
      await tx.query('select pg_advisory_xact_lock(hashtext($1))', [input.userId]);
      const balance = await getBalance(tx, input.userId);
      if (balance < required) {
        return { kind: 'insufficient', balance, required } as const;
      }
      const debit = await debitOnboarding(tx, input.userId, input.requestId, required);
      if (debit === null) {
        // Same (user, request) already has an onboarding debit — a retried
        // trigger. Roll back (nothing to add) and report duplicate.
        return { kind: 'duplicate' } as const;
      }
      const pending = await createPendingRequest(tx, {
        userId: input.userId,
        requestId: input.requestId,
        questionText: input.questionText,
        topicTerm: input.topicTerm,
        tableId: input.tableId,
        finderConfidence: input.finderConfidence,
        candidateIds: input.candidateIds,
        debitTransactionId: debit.id,
        ackAuditAnswerId: input.ackAuditAnswerId,
      });
      return { kind: 'started', debitTransactionId: debit.id, pendingId: pending.id } as const;
    });
  } catch (error) {
    // The only expected throw is the pending_one_active_per_user_table
    // unique-violation (an active job already exists for this user+table but
    // under a DIFFERENT request_id, so the debit dedup above didn't catch it).
    // The whole tx — including the debit — rolled back, so nothing was
    // charged: report duplicate, show the acknowledgment again. Any OTHER
    // error is a real failure and must propagate (fail loud, never swallow a
    // charge that half-happened — but it can't have, the tx is atomic).
    if (isUniqueViolation(error)) {
      return { kind: 'duplicate' };
    }
    throw error;
  }
}

/** Postgres unique_violation is SQLSTATE 23505; pg surfaces it as err.code,
 * PGlite as a message containing the constraint name / 'unique'. Match both so
 * the same trigger works hermetically (PGlite CI) and in production (pg). */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (code === '23505') return true;
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && /unique|23505|duplicate key/i.test(message)) {
      return true;
    }
  }
  return false;
}
