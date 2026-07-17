// The #53 anonymous trial pot (ADR 036): the deterministic QUESTIONS counter
// behind the homepage trial — the INNER belt (the outer belt is the separate
// capped Anthropic API key, wired in the web layer). Owner decisions
// (session 51): pot measured in questions, checked BEFORE serving; empty pot
// degrades the UI, never breaks it; abuse can never touch the main product's
// budget — hence this module never touches credit_transactions (whose
// user_id is NOT NULL + FK auth.users; anonymous spend is structurally
// impossible there, and mixing it in would poison the ledger's conservation
// invariants).
//
// Concurrency: every take/refund serializes on ONE global advisory lock
// (pg_advisory_xact_lock over a constant key) — the reserveDebit pattern
// widened from per-user to global, because the pot IS global. That makes the
// select-then-insert idempotency check race-free by construction. The lock
// is held only for these fast statements, never across an LLM call (the
// ledger's own rule).
import type { Db } from '../db/types.ts';

/** Per-visitor budget (owner decision: 2 proefvragen). */
export const TRIAL_QUESTIONS_PER_VISITOR = 2;
/** Per-IP-hash backstop against cookie-clearing (ADR 036 D2), per 24h. */
export const TRIAL_QUESTIONS_PER_IP_PER_DAY = 5;

const POT_LOCK_KEY = 'trial_pot_global';

export interface TrialPotStatus {
  remaining: number;
  cap: number;
}

/** Null when migration 020 has not been applied — callers treat that exactly
 * like an empty pot (dormant, the fail-safe posture). */
export async function getTrialPotStatus(db: Db): Promise<TrialPotStatus | null> {
  try {
    const { rows } = await db.query('select remaining_questions, cap from trial_pot_config', []);
    const row = rows[0];
    if (row === undefined) return null;
    return { remaining: Number(row.remaining_questions), cap: Number(row.cap) };
  } catch {
    // Table absent (pre-migration database): dormant, never an error page.
    return null;
  }
}

/** Supervised refill/resize (RUNBOOK procedure): sets both the fill level and
 * the cap. Also the seam the go-live uses to seed the first real pot. */
export async function setTrialPot(db: Db, questions: number): Promise<void> {
  if (!Number.isInteger(questions) || questions < 0) {
    throw new Error(`trial pot size must be a non-negative integer, got ${String(questions)}`);
  }
  await db.query('update trial_pot_config set remaining_questions = $1, cap = $1', [questions]);
}

export type TrialTakeResult =
  /** questionsLeft: the visitor's remaining budget AFTER this take, computed
   * inside the same transaction — so the caller never needs a post-serve
   * count query whose failure could discard an already-served answer
   * (adversarial-review finding, session 52). */
  | { kind: 'taken'; trialQuestionId: number; questionsLeft: number }
  | { kind: 'pot_empty' }
  | { kind: 'visitor_limit' }
  | { kind: 'ip_limit' }
  | { kind: 'duplicate_request' };

/** Atomic check-BEFORE-serve (owner decision): duplicate detection, both
 * abuse limits and the pot decrement in one serialized transaction. Order
 * matters — the duplicate check precedes the decrement so a client retry
 * never takes a second question, and the limit checks precede the decrement
 * so a rejected visitor never drains the pot. */
export async function takeTrialQuestion(
  db: Db,
  visitorId: string,
  ipHash: string,
  requestId: string,
): Promise<TrialTakeResult> {
  return db.withTransaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [POT_LOCK_KEY]);

    const dup = await tx.query(
      'select 1 from trial_questions where visitor_id = $1 and request_id = $2',
      [visitorId, requestId],
    );
    if (dup.rows.length > 0) return { kind: 'duplicate_request' };

    const visitor = await tx.query(
      'select count(*)::int as n from trial_questions where visitor_id = $1 and not refunded',
      [visitorId],
    );
    const usedBefore = Number(visitor.rows[0]!.n);
    if (usedBefore >= TRIAL_QUESTIONS_PER_VISITOR) return { kind: 'visitor_limit' };

    const ip = await tx.query(
      `select count(*)::int as n from trial_questions
       where ip_hash = $1 and not refunded and created_at > now() - interval '24 hours'`,
      [ipHash],
    );
    if (Number(ip.rows[0]!.n) >= TRIAL_QUESTIONS_PER_IP_PER_DAY) return { kind: 'ip_limit' };

    const pot = await tx.query(
      `update trial_pot_config set remaining_questions = remaining_questions - 1
       where singleton and remaining_questions > 0
       returning remaining_questions`,
      [],
    );
    if (pot.rows.length === 0) return { kind: 'pot_empty' };

    const inserted = await tx.query(
      `insert into trial_questions (visitor_id, ip_hash, request_id)
       values ($1, $2, $3)
       returning id`,
      [visitorId, ipHash, requestId],
    );
    return {
      kind: 'taken',
      trialQuestionId: Number(inserted.rows[0]!.id),
      questionsLeft: Math.max(0, TRIAL_QUESTIONS_PER_VISITOR - (usedBefore + 1)),
    };
  });
}

/** Compensation (the gate.ts mirror): the pipeline threw before an answer was
 * delivered — the pot gets its question back and the row stops counting
 * against the visitor's limit. Idempotent: a second refund of the same row is
 * a no-op (the `and not refunded` guard), so a retried error path can never
 * inflate the pot. The row itself stays — append-only history, like the
 * ledger's debit+compensation pairs. */
export async function refundTrialQuestion(db: Db, trialQuestionId: number): Promise<void> {
  await db.withTransaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [POT_LOCK_KEY]);
    const marked = await tx.query(
      'update trial_questions set refunded = true where id = $1 and not refunded returning id',
      [trialQuestionId],
    );
    if (marked.rows.length === 0) return;
    await tx.query(
      'update trial_pot_config set remaining_questions = remaining_questions + 1 where singleton',
      [],
    );
  });
}

/** Post-hoc audit-row link (the attachThread precedent): never blocks or
 * rolls back the served answer; the R8 row itself was already written inside
 * the pipeline call. */
export async function attachTrialAudit(
  db: Db,
  trialQuestionId: number,
  auditAnswerId: number,
): Promise<void> {
  await db.query('update trial_questions set audit_answer_id = $1 where id = $2', [
    auditAnswerId,
    trialQuestionId,
  ]);
}

/** ADR 036 D4: trial_questions bookkeeping (visitor UUID + HMAC'd ip) exists
 * only to enforce the abuse limits — its purpose expires, so the rows are
 * DELETED after this window (unlike audit_answers, which is redacted: no
 * ledger FK references these rows, and the R8 record lives on audit_answers
 * independently). Documented consequence: a returning visitor's 2-question
 * budget refreshes after the window — deliberate; keeping visitor ids
 * forever to enforce a lifetime cap would be retention without purpose. */
export const TRIAL_BOOKKEEPING_RETENTION_DAYS = 90;

export function trialRetentionCutoff(now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - TRIAL_BOOKKEEPING_RETENTION_DAYS);
  return cutoff;
}

/** Dry-run count for the purge script (⟨F2⟩ discipline: preview and apply
 * share one WHERE shape, so they can never disagree). */
export async function countPurgeableTrialBookkeeping(db: Db, cutoff: Date): Promise<number> {
  const { rows } = await db.query(
    'select count(*)::int as n from trial_questions where created_at < $1',
    [cutoff.toISOString()],
  );
  return Number(rows[0]!.n);
}

/** The sweep itself: returns how many rows were deleted. Idempotent for a
 * fixed cutoff — a second run finds nothing left. */
export async function purgeExpiredTrialBookkeeping(db: Db, cutoff: Date): Promise<number> {
  const { rows } = await db.query(
    'delete from trial_questions where created_at < $1 returning id',
    [cutoff.toISOString()],
  );
  return rows.length;
}
