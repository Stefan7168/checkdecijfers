// The #53 trial pot's deterministic core (ADR 036): check-BEFORE-serve,
// idempotent takes, both abuse limits, refund compensation and the dormant
// default — all hermetic on PGlite with migration 020 applied (ADR 009).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import {
  attachTrialAudit,
  countPurgeableTrialBookkeeping,
  getTrialPotStatus,
  purgeExpiredTrialBookkeeping,
  refundTrialQuestion,
  setTrialPot,
  takeTrialQuestion,
  TRIAL_QUESTIONS_PER_IP_PER_DAY,
  TRIAL_QUESTIONS_PER_VISITOR,
  trialRetentionCutoff,
} from '../../src/billing/index.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

const V1 = '11111111-1111-4111-8111-111111111111';
const V2 = '22222222-2222-4222-8222-222222222222';
const V3 = '33333333-3333-4333-8333-333333333333';
const IP_A = 'hash-a';

let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});

afterEach(async () => {
  await close();
});

async function remaining(): Promise<number> {
  return (await getTrialPotStatus(db))!.remaining;
}

describe('trial pot (migration 020 + src/billing/trial-pot.ts)', () => {
  it('seeds DORMANT: pot exists at 0/0 and a take reports pot_empty', async () => {
    expect(await getTrialPotStatus(db)).toEqual({ remaining: 0, cap: 0 });
    expect(await takeTrialQuestion(db, V1, IP_A, 'r1')).toEqual({ kind: 'pot_empty' });
  });

  it('setTrialPot seeds; a take decrements, reports the visitor budget and records bookkeeping', async () => {
    await setTrialPot(db, 25);
    const take = await takeTrialQuestion(db, V1, IP_A, 'r1');
    expect(take.kind).toBe('taken');
    // questionsLeft is computed IN the take transaction (adversarial-review
    // fix: no post-serve count read whose failure could discard an answer).
    expect((take as { questionsLeft: number }).questionsLeft).toBe(TRIAL_QUESTIONS_PER_VISITOR - 1);
    const second = await takeTrialQuestion(db, V1, IP_A, 'r2');
    expect((second as { questionsLeft: number }).questionsLeft).toBe(0);
    expect(await getTrialPotStatus(db)).toEqual({ remaining: 23, cap: 25 });
    const { rows } = await db.query(
      'select visitor_id, ip_hash, request_id, refunded from trial_questions order by id',
      [],
    );
    expect(rows).toEqual([
      { visitor_id: V1, ip_hash: IP_A, request_id: 'r1', refunded: false },
      { visitor_id: V1, ip_hash: IP_A, request_id: 'r2', refunded: false },
    ]);
  });

  it('a repeated (visitor, requestId) is duplicate_request and never a second take', async () => {
    await setTrialPot(db, 25);
    await takeTrialQuestion(db, V1, IP_A, 'r1');
    expect(await takeTrialQuestion(db, V1, IP_A, 'r1')).toEqual({ kind: 'duplicate_request' });
    expect(await remaining()).toBe(24);
  });

  it(`enforces the per-visitor budget of ${TRIAL_QUESTIONS_PER_VISITOR}`, async () => {
    await setTrialPot(db, 25);
    expect((await takeTrialQuestion(db, V1, IP_A, 'r1')).kind).toBe('taken');
    expect((await takeTrialQuestion(db, V1, IP_A, 'r2')).kind).toBe('taken');
    expect(await takeTrialQuestion(db, V1, IP_A, 'r3')).toEqual({ kind: 'visitor_limit' });
    // The rejected take never drained the pot.
    expect(await remaining()).toBe(23);
  });

  it(`enforces the per-ip backstop of ${TRIAL_QUESTIONS_PER_IP_PER_DAY}/day across visitors`, async () => {
    await setTrialPot(db, 25);
    let r = 0;
    for (const v of [V1, V1, V2, V2, V3]) {
      expect((await takeTrialQuestion(db, v, IP_A, `r${++r}`)).kind).toBe('taken');
    }
    expect(await takeTrialQuestion(db, V3, IP_A, 'r6')).toEqual({ kind: 'ip_limit' });
    // A different ip hash is unaffected.
    expect((await takeTrialQuestion(db, V3, 'hash-b', 'r7')).kind).toBe('taken');
  });

  it('drains to exactly zero: check-before-serve floors at pot_empty', async () => {
    await setTrialPot(db, 1);
    expect((await takeTrialQuestion(db, V1, IP_A, 'r1')).kind).toBe('taken');
    expect(await takeTrialQuestion(db, V2, IP_A, 'r2')).toEqual({ kind: 'pot_empty' });
    expect(await remaining()).toBe(0);
  });

  it('serializes two concurrent takes racing for the LAST question — exactly one wins', async () => {
    // The ledger.test.ts reserveDebit convention: PGlite is one connection
    // behind a JS mutex (tests/helpers/pglite-db.ts), so this proves the
    // OBSERVABLE contract (one taken, one pot_empty, pot at exactly 0 —
    // never -1, never two winners), not true multi-connection interleaving;
    // the pg_advisory_xact_lock in takeTrialQuestion is what carries that
    // guarantee on real Postgres.
    await setTrialPot(db, 1);
    const [a, b] = await Promise.all([
      takeTrialQuestion(db, V1, IP_A, 'r1'),
      takeTrialQuestion(db, V2, IP_A, 'r2'),
    ]);
    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toEqual(['pot_empty', 'taken']);
    expect(await remaining()).toBe(0);
  });

  it('90-day bookkeeping sweep (ADR 036 D4): deletes only expired rows, count matches, idempotent', async () => {
    await setTrialPot(db, 25);
    await takeTrialQuestion(db, V1, IP_A, 'r1');
    await takeTrialQuestion(db, V2, IP_A, 'r2');
    // Age one row past the window (bookkeeping timestamp, not the pot).
    await db.query(
      `update trial_questions set created_at = now() - interval '91 days' where request_id = 'r1'`,
      [],
    );
    const cutoff = trialRetentionCutoff(new Date());
    expect(await countPurgeableTrialBookkeeping(db, cutoff)).toBe(1);
    expect(await purgeExpiredTrialBookkeeping(db, cutoff)).toBe(1);
    // The young row survives; a second run deletes nothing (idempotent).
    expect(await countPurgeableTrialBookkeeping(db, cutoff)).toBe(0);
    expect(await purgeExpiredTrialBookkeeping(db, cutoff)).toBe(0);
    const { rows } = await db.query('select request_id from trial_questions', []);
    expect(rows).toEqual([{ request_id: 'r2' }]);
    // The sweep never touches the pot itself.
    expect(await remaining()).toBe(23);
  });

  it('refund returns the question to the pot AND to the visitor budget, idempotently', async () => {
    await setTrialPot(db, 25);
    const t1 = await takeTrialQuestion(db, V1, IP_A, 'r1');
    const t2 = await takeTrialQuestion(db, V1, IP_A, 'r2');
    expect(t1.kind).toBe('taken');
    expect(t2.kind).toBe('taken');
    expect(await remaining()).toBe(23);

    await refundTrialQuestion(db, (t2 as { trialQuestionId: number }).trialQuestionId);
    expect(await remaining()).toBe(24);
    // Double refund is a no-op — an error-path retry can never inflate the pot.
    await refundTrialQuestion(db, (t2 as { trialQuestionId: number }).trialQuestionId);
    expect(await remaining()).toBe(24);
    // The refunded question no longer counts against the visitor's budget.
    expect((await takeTrialQuestion(db, V1, IP_A, 'r3')).kind).toBe('taken');
  });

  // A refund that lands AFTER a supervised refill must not push the pot above
  // its own cap: migration 020 has check (remaining >= 0) and check (cap >= 0)
  // but no `remaining <= cap`, so nothing else stops it, and monitoring would
  // read "26 of 25 left". The owner's `trialpot:set` is authoritative.
  it('a refund landing after a refill is clamped to cap — but still frees the visitor budget', async () => {
    await setTrialPot(db, 25);
    const t1 = await takeTrialQuestion(db, V1, IP_A, 'r1');
    expect(t1.kind).toBe('taken');
    expect(await remaining()).toBe(24);

    // The supervised refill happens while that take is in flight.
    await setTrialPot(db, 25);
    expect(await remaining()).toBe(25);

    await refundTrialQuestion(db, (t1 as { trialQuestionId: number }).trialQuestionId);
    expect(await remaining()).toBe(25); // clamped, not 26
    const { rows } = await db.query('select cap from trial_pot_config', []);
    expect(await remaining()).toBeLessThanOrEqual(Number(rows[0]!.cap));
    // The clamp must not swallow the OTHER half of the compensation: the row
    // stopped counting against the visitor either way.
    expect((await takeTrialQuestion(db, V1, IP_A, 'r2')).kind).toBe('taken');
  });

  it('below the cap a refund is still exactly +1 — the clamp only bites at the boundary', async () => {
    await setTrialPot(db, 25);
    const t1 = await takeTrialQuestion(db, V1, IP_A, 'r1');
    await takeTrialQuestion(db, V2, IP_A, 'r2');
    expect(await remaining()).toBe(23);
    await refundTrialQuestion(db, (t1 as { trialQuestionId: number }).trialQuestionId);
    expect(await remaining()).toBe(24);
  });

  // #180: the alert needs the pot level, and it must come from the UPDATE that
  // decremented it — a second read could see a value that already moved.
  it('a take reports the pot level AFTER its own decrement', async () => {
    await setTrialPot(db, 3);
    const t1 = await takeTrialQuestion(db, V1, IP_A, 'aaaaaaaa-0000-4000-8000-000000000001');
    expect(t1).toMatchObject({ kind: 'taken', potRemaining: 2 });
    const t2 = await takeTrialQuestion(db, V2, IP_A, 'aaaaaaaa-0000-4000-8000-000000000002');
    expect(t2).toMatchObject({ kind: 'taken', potRemaining: 1 });
    const t3 = await takeTrialQuestion(db, V3, IP_A, 'aaaaaaaa-0000-4000-8000-000000000003');
    expect(t3).toMatchObject({ kind: 'taken', potRemaining: 0 });
    expect(await remaining()).toBe(0);
  });

  it('attachTrialAudit refuses a nonexistent audit row (FK teeth)', async () => {
    await setTrialPot(db, 25);
    const take = await takeTrialQuestion(db, V1, IP_A, 'r1');
    await expect(
      attachTrialAudit(db, (take as { trialQuestionId: number }).trialQuestionId, 999_999),
    ).rejects.toThrow();
  });

  it('setTrialPot rejects garbage sizes', async () => {
    await expect(setTrialPot(db, -1)).rejects.toThrow('non-negative');
    await expect(setTrialPot(db, 1.5)).rejects.toThrow('non-negative');
  });

  it('the audit source_tag CHECK admits anonymous_trial (migration 020 widening)', async () => {
    // Structural: the widened CHECK is what lets R8 rows for anonymous
    // answers exist at all. A full audit row is exercised in the answer
    // suite; here we pin the constraint itself.
    const { rows } = await db.query(
      `select pg_get_constraintdef(oid) as def from pg_constraint
       where conname = 'audit_answers_source_tag_check'`,
      [],
    );
    expect(rows[0]!.def).toContain('anonymous_trial');
  });
});
