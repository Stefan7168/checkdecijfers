// Table-lane request store (breadth step 5, migration 038): reserve the question
// price + insert the pending row in ONE transaction, claim/reclaim with
// FOR UPDATE SKIP LOCKED, and finish-and-settle (status + refund in one
// transaction). Hermetic PGlite; no LLM, no network.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deriveAddonRequestId, getBalance } from '../../src/billing/ledger.ts';
import { getBucketBalance, grantBucket } from '../../src/billing/pro-bucket.ts';
import { applyPricingDefaults } from '../../src/billing/pricing-apply.ts';
import type { Db } from '../../src/db/types.ts';
import {
  claimExhaustedTableLaneRequest,
  claimTableLaneRequest,
  createTableLaneRequest,
  finishTableLaneRequest,
  findExhaustedTableLaneRequests,
  readTableLaneRequest,
  releaseForRetry,
  setTableLaneThread,
  TABLE_LANE_MAX_ATTEMPTS,
  TABLE_LANE_STALE_MS,
  type TableLaneRow,
} from '../../src/ingestion/table-lane-store.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import { resetTestDb } from '../helpers/reset-db.ts';

let db: Db;
let closeDb: () => Promise<void>;

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await resetTestDb(db);
  await applyPricingDefaults(db); // simple = 20, clarification = 10
});

async function seedSignup(userId: string, credits: number): Promise<void> {
  await db.query(
    `insert into credit_transactions (user_id, delta, reason, note) values ($1, $2, 'signup_grant', 'test seed')`,
    [userId, credits],
  );
}

async function seedSubscription(userId: string, grantId: string): Promise<void> {
  await db.query(
    `insert into pro_subscriptions
       (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, current_period_grant_id)
     values ($1, $2, $3, 'active', now() + interval '20 days', $4)`,
    [userId, `cus_${randomUUID()}`, `sub_${randomUUID()}`, grantId],
  );
}

async function insertAuditRow(userId: string): Promise<number> {
  const { rows } = await db.query(
    `insert into audit_answers
       (schema_version, user_id, source_tag, kind, question, reference_date, response, final_text, prompt_versions, latency_ms, chart_emitted)
     values (1, $1, 'user', 'answer', 'q', '2026-01-01', '{}'::jsonb, 'a', '{}'::jsonb, 100, false)
     returning id`,
    [userId],
  );
  return Number(rows[0]!.id);
}

function input(userId: string, overrides: Partial<Parameters<typeof createTableLaneRequest>[1]> = {}) {
  return {
    userId,
    requestId: randomUUID(),
    threadId: null,
    lang: 'nl' as const,
    question: 'Hoeveel woningen zijn er in Utrecht?',
    tableId: '85000NED',
    finderConfidence: 0.9,
    ...overrides,
  };
}

async function created(userId: string, overrides: Partial<Parameters<typeof createTableLaneRequest>[1]> = {}) {
  const result = await createTableLaneRequest(db, input(userId, overrides));
  if (result.kind !== 'created') throw new Error(`expected created, got ${result.kind}`);
  return result.row;
}

async function countRows(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await db.query(sql, params);
  return Number(rows[0]!.n);
}

describe('migration 038', () => {
  it('is applied by the migration scan', async () => {
    const { rows } = await db.query("select name from schema_migrations where name like '038_%'");
    expect(rows.map((r) => r.name)).toEqual(['038_table_lane_requests.sql']);
  });
});

describe('createTableLaneRequest', () => {
  it('debits the simple price, inserts a pending row that carries the debit, returns created', async () => {
    const userId = randomUUID();
    await seedSignup(userId, 100);
    const requestId = randomUUID();
    const result = await createTableLaneRequest(
      db,
      input(userId, {
        requestId,
        lang: 'en',
        previousQuestion: 'and 2020?',
        choices: [{ dimension: 'Geslacht', code: 'T001038' }],
        parentId: null,
      }),
    );
    expect(result.kind).toBe('created');
    if (result.kind !== 'created') return;
    const row = result.row;
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(0);
    expect(row.userId).toBe(userId);
    expect(row.requestId).toBe(requestId);
    expect(row.lang).toBe('en');
    expect(row.previousQuestion).toBe('and 2020?');
    expect(row.choices).toEqual([{ dimension: 'Geslacht', code: 'T001038' }]);
    expect(row.finderConfidence).toBeCloseTo(0.9);
    expect(row.auditId).toBeNull();
    expect(row.outcomeKind).toBeNull();
    expect(row.startedAt).toBeNull();
    expect(row.finishedAt).toBeNull();
    expect(row.debitTransactionId).not.toBeNull();
    expect(await getBalance(db, userId)).toBe(80);

    // the ledger debit is keyed on the DERIVED request id, not the raw one
    const derived = deriveAddonRequestId(requestId, 'table-lane');
    const { rows } = await db.query(
      `select id, delta, reason from credit_transactions where user_id = $1 and request_id = $2`,
      [userId, derived],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toBe('question_cost');
    expect(Number(rows[0]!.delta)).toBe(-20);
    expect(Number(rows[0]!.id)).toBe(row.debitTransactionId);
    expect(await countRows(`select count(*) as n from credit_transactions where request_id = $1`, [requestId])).toBe(0);
  });

  it('does not collide with the routing turn that already debited AND refunded the same request id', async () => {
    const userId = randomUUID();
    await seedSignup(userId, 100);
    const requestId = randomUUID();
    // what chargeAndRun did for the curated 'onboarding_pending' refusal turn
    const { rows } = await db.query(
      `insert into credit_transactions (user_id, delta, reason, request_id, note)
       values ($1, -20, 'question_cost', $2, 'question debit') returning id`,
      [userId, requestId],
    );
    await db.query(
      `insert into credit_transactions (user_id, delta, reason, related_transaction_id, note)
       values ($1, 20, 'compensation', $2, 'refund: no answer produced')`,
      [userId, Number(rows[0]!.id)],
    );
    expect(await getBalance(db, userId)).toBe(100);
    const result = await createTableLaneRequest(db, input(userId, { requestId }));
    expect(result.kind).toBe('created');
    expect(await getBalance(db, userId)).toBe(80);
  });

  it('spends the Pro bucket first: bucket + ledger split is recorded on the row', async () => {
    const userId = randomUUID();
    const grantId = randomUUID();
    await seedSignup(userId, 100);
    await seedSubscription(userId, grantId);
    await grantBucket(db, userId, grantId, 15, `in_${randomUUID()}`);
    const row = await created(userId);
    expect(await getBucketBalance(db, userId, grantId)).toBe(0);
    expect(await getBalance(db, userId)).toBe(95); // 100 - 5
    expect(row.debitTransactionId).not.toBeNull();
    const stored = await db.query(
      `select debit_from_bucket, debit_from_ledger, debit_bucket_entry_id from table_lane_requests where id = $1`,
      [row.id],
    );
    expect(Number(stored.rows[0]!.debit_from_bucket)).toBe(15);
    expect(Number(stored.rows[0]!.debit_from_ledger)).toBe(5);
    expect(stored.rows[0]!.debit_bucket_entry_id).not.toBeNull();
  });

  it('a fully bucket-funded debit writes no credit_transactions debit and leaves debitTransactionId null', async () => {
    const userId = randomUUID();
    const grantId = randomUUID();
    await seedSignup(userId, 100);
    await seedSubscription(userId, grantId);
    await grantBucket(db, userId, grantId, 1000, `in_${randomUUID()}`);
    const row = await created(userId);
    expect(row.debitTransactionId).toBeNull();
    expect(await getBalance(db, userId)).toBe(100);
    expect(await getBucketBalance(db, userId, grantId)).toBe(980);
  });

  it('same (userId, requestId) twice returns duplicate with the same row and debits once', async () => {
    const userId = randomUUID();
    await seedSignup(userId, 100);
    const args = input(userId);
    const first = await createTableLaneRequest(db, args);
    const second = await createTableLaneRequest(db, args);
    expect(first.kind).toBe('created');
    expect(second.kind).toBe('duplicate');
    if (first.kind !== 'created' || second.kind !== 'duplicate') return;
    expect(second.row.id).toBe(first.row.id);
    expect(await getBalance(db, userId)).toBe(80);
    expect(await countRows(`select count(*) as n from table_lane_requests where user_id = $1`, [userId])).toBe(1);
  });

  it('a duplicate is reported even when the balance is now too low for a fresh request', async () => {
    const userId = randomUUID();
    await seedSignup(userId, 20);
    const args = input(userId);
    expect((await createTableLaneRequest(db, args)).kind).toBe('created');
    expect(await getBalance(db, userId)).toBe(0);
    expect((await createTableLaneRequest(db, args)).kind).toBe('duplicate');
  });

  it('balance below the price returns insufficient: no row, no debit', async () => {
    const userId = randomUUID();
    await seedSignup(userId, 19);
    const result = await createTableLaneRequest(db, input(userId));
    expect(result).toEqual({ kind: 'insufficient', balance: 19, required: 20 });
    expect(await getBalance(db, userId)).toBe(19);
    expect(await countRows(`select count(*) as n from table_lane_requests`)).toBe(0);
    expect(await countRows(`select count(*) as n from credit_transactions where reason = 'question_cost'`)).toBe(0);
  });

  it('a row-insert failure after the debit leaves no charge behind and rethrows', async () => {
    const userId = randomUUID();
    const grantId = randomUUID();
    await seedSignup(userId, 100);
    await seedSubscription(userId, grantId);
    await grantBucket(db, userId, grantId, 15, `in_${randomUUID()}`);
    // thread 999999 does not exist -> FK violation on the row insert
    await expect(createTableLaneRequest(db, input(userId, { threadId: 999999 }))).rejects.toThrow();
    expect(await getBalance(db, userId)).toBe(100);
    expect(await getBucketBalance(db, userId, grantId)).toBe(15);
    expect(await countRows(`select count(*) as n from table_lane_requests`)).toBe(0);
    expect(await countRows(`select count(*) as n from credit_transactions where reason = 'question_cost'`)).toBe(0);
  });
});

describe('claimTableLaneRequest', () => {
  it('returns the oldest pending row and marks it running with started_at and attempts + 1', async () => {
    const userId = randomUUID();
    await seedSignup(userId, 200);
    const first = await created(userId);
    const second = await created(userId);
    const now = new Date('2026-09-29T10:00:00Z');
    const claimed = await claimTableLaneRequest(db, now);
    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(first.id);
    expect(claimed!.status).toBe('running');
    expect(claimed!.attempts).toBe(1);
    expect(claimed!.startedAt?.toISOString()).toBe(now.toISOString());
    const other = await readTableLaneRequest(db, second.id, userId);
    expect(other!.status).toBe('pending');
  });

  it('returns null when nothing is claimable', async () => {
    expect(await claimTableLaneRequest(db)).toBeNull();
  });

  it('two claims issued together on one connection never return the same row', async () => {
    const userId = randomUUID();
    await seedSignup(userId, 200);
    const a = await created(userId);
    const b = await created(userId);
    const [c1, c2] = await Promise.all([claimTableLaneRequest(db), claimTableLaneRequest(db)]);
    expect(c1).not.toBeNull();
    expect(c2).not.toBeNull();
    expect(new Set([c1!.id, c2!.id])).toEqual(new Set([a.id, b.id]));
  });

  it('with a single pending row, only one of two claims issued together on one connection gets it', async () => {
    const userId = randomUUID();
    await seedSignup(userId, 100);
    await created(userId);
    const results = await Promise.all([claimTableLaneRequest(db), claimTableLaneRequest(db)]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it('claims with FOR UPDATE SKIP LOCKED in the statement', async () => {
    // PGlite is single-connection, so real lock contention cannot be staged
    // here; pin the mechanism in the source instead of pretending.
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../../src/ingestion/table-lane-store.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/for update skip locked/i);
  });
});

describe('stale running rows', () => {
  it('a running row older than TABLE_LANE_STALE_MS is reclaimed while attempts < max', async () => {
    const userId = randomUUID();
    await seedSignup(userId, 100);
    const row = await created(userId);
    const t0 = new Date('2026-09-29T10:00:00Z');
    const first = await claimTableLaneRequest(db, t0);
    expect(first!.id).toBe(row.id);
    expect(first!.attempts).toBe(1);

    // not stale yet: not claimable
    const early = new Date(t0.getTime() + TABLE_LANE_STALE_MS - 1000);
    expect(await claimTableLaneRequest(db, early)).toBeNull();

    // stale: reclaimed, attempts 2
    const late = new Date(t0.getTime() + TABLE_LANE_STALE_MS + 1000);
    const second = await claimTableLaneRequest(db, late);
    expect(second!.id).toBe(row.id);
    expect(second!.attempts).toBe(2);
    expect(second!.startedAt?.toISOString()).toBe(late.toISOString());
  });

  it('a stale row at the attempt cap is not reclaimed; findExhausted lists it so the job can fail it', async () => {
    expect(TABLE_LANE_MAX_ATTEMPTS).toBe(2);
    const userId = randomUUID();
    await seedSignup(userId, 100);
    const row = await created(userId);
    const t0 = new Date('2026-09-29T10:00:00Z');
    await claimTableLaneRequest(db, t0);
    const t1 = new Date(t0.getTime() + TABLE_LANE_STALE_MS + 1000);
    await claimTableLaneRequest(db, t1);
    const t2 = new Date(t1.getTime() + TABLE_LANE_STALE_MS + 1000);
    expect(await claimTableLaneRequest(db, t2)).toBeNull();
    // not exhausted while the second attempt is still fresh
    expect(await findExhaustedTableLaneRequests(db, t1)).toEqual([]);
    const exhausted = await findExhaustedTableLaneRequests(db, t2);
    expect(exhausted.map((r) => r.id)).toEqual([row.id]);
    expect(exhausted[0]!.attempts).toBe(2);
  });

  it('claimExhaustedTableLaneRequest takes ownership of an exhausted row exactly once (fix round 1, Important 1)', async () => {
    const userId = randomUUID();
    await seedSignup(userId, 100);
    const row = await created(userId);
    const t0 = new Date('2026-09-29T10:00:00Z');
    await claimTableLaneRequest(db, t0);
    const t1 = new Date(t0.getTime() + TABLE_LANE_STALE_MS + 1000);
    await claimTableLaneRequest(db, t1);
    const t2 = new Date(t1.getTime() + TABLE_LANE_STALE_MS + 1000);
    const [listed] = await findExhaustedTableLaneRequests(db, t2);

    const owned = await claimExhaustedTableLaneRequest(db, listed!.id, listed!.attempts, t2);
    expect(owned!.id).toBe(row.id);
    expect(owned!.status).toBe('running');
    expect(owned!.attempts).toBe(TABLE_LANE_MAX_ATTEMPTS); // never above the cap
    expect(owned!.startedAt?.toISOString()).toBe(t2.toISOString());
    // a second lister of the same (now fresh) row gets nothing
    expect(await claimExhaustedTableLaneRequest(db, listed!.id, listed!.attempts, t2)).toBeNull();
    expect(await findExhaustedTableLaneRequests(db, t2)).toEqual([]);
    // not an exhausted row at all (fresh, or below the cap): nothing
    const other = await created(userId);
    await claimTableLaneRequest(db, t2);
    const t3 = new Date(t2.getTime() + TABLE_LANE_STALE_MS + 1000);
    expect(await claimExhaustedTableLaneRequest(db, other.id, 1, t3)).toBeNull();
  });

  it('releaseForRetry puts a running row back to pending with the summary; a pending row cannot be released', async () => {
    const userId = randomUUID();
    await seedSignup(userId, 100);
    const row = await created(userId);
    await expect(releaseForRetry(db, row.id, 0, 'x')).rejects.toThrow();
    await claimTableLaneRequest(db);
    await releaseForRetry(db, row.id, 1, 'CBS was slow');
    const after = await readTableLaneRequest(db, row.id, userId);
    expect(after!.status).toBe('pending');
    expect(after!.failureSummary).toBe('CBS was slow');
    expect(after!.attempts).toBe(1);
    const again = await claimTableLaneRequest(db);
    expect(again!.id).toBe(row.id);
    expect(again!.attempts).toBe(2);
  });
});

describe('finishTableLaneRequest', () => {
  async function running(userId: string): Promise<TableLaneRow> {
    const row = await created(userId);
    const claimed = await claimTableLaneRequest(db);
    expect(claimed!.id).toBe(row.id);
    return claimed!;
  }

  it('answer: row done, outcome_kind answer, audit id stored, no refund', async () => {
    const userId = randomUUID();
    await seedSignup(userId, 100);
    const row = await running(userId);
    const auditId = await insertAuditRow(userId);
    await finishTableLaneRequest(db, row.id, 1, { kind: 'answer', auditId });
    const after = await readTableLaneRequest(db, row.id, userId);
    expect(after!.status).toBe('done');
    expect(after!.outcomeKind).toBe('answer');
    expect(after!.auditId).toBe(auditId);
    expect(after!.finishedAt).not.toBeNull();
    expect(await getBalance(db, userId)).toBe(80);
    expect(await countRows(`select count(*) as n from credit_transactions where reason = 'compensation'`)).toBe(0);
  });

  it('clarification: refunds down to the clarification price (net 10)', async () => {
    const userId = randomUUID();
    await seedSignup(userId, 100);
    const row = await running(userId);
    const auditId = await insertAuditRow(userId);
    await finishTableLaneRequest(db, row.id, 1, { kind: 'clarification', auditId });
    const after = await readTableLaneRequest(db, row.id, userId);
    expect(after!.status).toBe('done');
    expect(after!.outcomeKind).toBe('clarification');
    expect(await getBalance(db, userId)).toBe(90);
  });

  it('refusal: full refund (net 0)', async () => {
    const userId = randomUUID();
    await seedSignup(userId, 100);
    const row = await running(userId);
    const auditId = await insertAuditRow(userId);
    await finishTableLaneRequest(db, row.id, 1, { kind: 'refusal', auditId });
    const after = await readTableLaneRequest(db, row.id, userId);
    expect(after!.status).toBe('done');
    expect(after!.outcomeKind).toBe('refusal');
    expect(await getBalance(db, userId)).toBe(100);
    const { rows } = await db.query(`select audit_answer_id from credit_transactions where reason = 'compensation'`);
    expect(Number(rows[0]!.audit_answer_id)).toBe(auditId);
  });

  it('failed: status failed, full refund, failure_summary stored, outcome_kind null', async () => {
    const userId = randomUUID();
    await seedSignup(userId, 100);
    const row = await running(userId);
    await finishTableLaneRequest(db, row.id, 1, { kind: 'failed', summary: 'CBS unreachable', auditId: null });
    const after = await readTableLaneRequest(db, row.id, userId);
    expect(after!.status).toBe('failed');
    expect(after!.outcomeKind).toBeNull();
    expect(after!.failureSummary).toBe('CBS unreachable');
    expect(await getBalance(db, userId)).toBe(100);
  });

  it('refunds a Pro split back to the bucket first (refusal), and partially for a clarification', async () => {
    const userId = randomUUID();
    const grantId = randomUUID();
    await seedSignup(userId, 100);
    await seedSubscription(userId, grantId);
    await grantBucket(db, userId, grantId, 15, `in_${randomUUID()}`);
    const r1 = await running(userId); // 15 bucket + 5 ledger
    await finishTableLaneRequest(db, r1.id, 1, { kind: 'refusal', auditId: null });
    expect(await getBucketBalance(db, userId, grantId)).toBe(15);
    expect(await getBalance(db, userId)).toBe(100);

    const r2 = await running(userId);
    await finishTableLaneRequest(db, r2.id, 1, { kind: 'clarification', auditId: null });
    // spent 20 (15 bucket + 5 ledger); clarification price 10 -> refund 10 -> bucket gets 10 back
    expect(await getBucketBalance(db, userId, grantId)).toBe(10);
    expect(await getBalance(db, userId)).toBe(95);
  });

  it('refunds a fully bucket-funded debit into the bucket', async () => {
    const userId = randomUUID();
    const grantId = randomUUID();
    await seedSignup(userId, 100);
    await seedSubscription(userId, grantId);
    await grantBucket(db, userId, grantId, 1000, `in_${randomUUID()}`);
    const row = await running(userId);
    await finishTableLaneRequest(db, row.id, 1, { kind: 'failed', summary: 'boom', auditId: null });
    expect(await getBucketBalance(db, userId, grantId)).toBe(1000);
    expect(await getBalance(db, userId)).toBe(100);
  });

  it('status and settlement are one transaction: a throwing compensation leaves the row running', async () => {
    const userId = randomUUID();
    await seedSignup(userId, 100);
    const row = await running(userId);
    // audit id 999999 violates credit_transactions.audit_answer_id -> the refund throws
    await expect(finishTableLaneRequest(db, row.id, 1, { kind: 'refusal', auditId: 999999 })).rejects.toThrow();
    const after = await readTableLaneRequest(db, row.id, userId);
    expect(after!.status).toBe('running');
    expect(after!.finishedAt).toBeNull();
    expect(await getBalance(db, userId)).toBe(80);
  });

  it('finishing an already-terminal row throws and settles nothing (no double refund)', async () => {
    const userId = randomUUID();
    await seedSignup(userId, 100);
    const row = await running(userId);
    await finishTableLaneRequest(db, row.id, 1, { kind: 'refusal', auditId: null });
    expect(await getBalance(db, userId)).toBe(100);
    await expect(finishTableLaneRequest(db, row.id, 1, { kind: 'refusal', auditId: null })).rejects.toThrow();
    await expect(finishTableLaneRequest(db, row.id, 1, { kind: 'failed', summary: 's', auditId: null })).rejects.toThrow();
    expect(await getBalance(db, userId)).toBe(100);
    expect(await countRows(`select count(*) as n from credit_transactions where reason = 'compensation'`)).toBe(1);
    const after = await readTableLaneRequest(db, row.id, userId);
    expect(after!.outcomeKind).toBe('refusal');
  });

  it('finishing a row that was never claimed (pending) or is unknown throws', async () => {
    const userId = randomUUID();
    await seedSignup(userId, 100);
    const row = await created(userId);
    await expect(finishTableLaneRequest(db, row.id, 1, { kind: 'answer', auditId: null })).rejects.toThrow();
    await expect(finishTableLaneRequest(db, 424242, 1, { kind: 'answer', auditId: null })).rejects.toThrow();
    expect(await getBalance(db, userId)).toBe(80);
  });

  it('an exhausted stale running row can be failed and refunded without another claim', async () => {
    const userId = randomUUID();
    await seedSignup(userId, 100);
    const row = await created(userId);
    const t0 = new Date('2026-09-29T10:00:00Z');
    await claimTableLaneRequest(db, t0);
    await claimTableLaneRequest(db, new Date(t0.getTime() + TABLE_LANE_STALE_MS + 1000));
    await finishTableLaneRequest(db, row.id, 2, { kind: 'failed', summary: 'gave up', auditId: null });
    expect(await getBalance(db, userId)).toBe(100);
  });
});

describe('attempt cap and fencing', () => {
  async function claimedAt(userId: string, times: number): Promise<{ row: TableLaneRow; last: Date }> {
    const row = await created(userId);
    let last = new Date('2026-09-29T10:00:00Z');
    let claimed = await claimTableLaneRequest(db, last);
    for (let i = 1; i < times; i++) {
      last = new Date(last.getTime() + TABLE_LANE_STALE_MS + 1000);
      claimed = await claimTableLaneRequest(db, last);
    }
    expect(claimed!.id).toBe(row.id);
    expect(claimed!.attempts).toBe(times);
    return { row: claimed!, last };
  }

  it('releaseForRetry refuses once the row has used every attempt; the caller must finish it as failed', async () => {
    const userId = randomUUID();
    await seedSignup(userId, 100);
    const { row } = await claimedAt(userId, TABLE_LANE_MAX_ATTEMPTS);
    await expect(releaseForRetry(db, row.id, TABLE_LANE_MAX_ATTEMPTS, 'again')).rejects.toThrow(/finish it as failed/);
    const still = await readTableLaneRequest(db, row.id, userId);
    expect(still!.status).toBe('running');
    // and the way out works: finish it failed with the refund
    await finishTableLaneRequest(db, row.id, TABLE_LANE_MAX_ATTEMPTS, { kind: 'failed', summary: 'gave up', auditId: null });
    expect(await getBalance(db, userId)).toBe(100);
  });

  it('a superseded invocation cannot finish a reclaimed row: throws, settles nothing, the current one still can', async () => {
    const userId = randomUUID();
    await seedSignup(userId, 100);
    const first = await created(userId);
    const t0 = new Date('2026-09-29T10:00:00Z');
    const attempt1 = await claimTableLaneRequest(db, t0);
    expect(attempt1!.attempts).toBe(1);
    // attempt 1 goes stale; a second invocation reclaims the row
    const attempt2 = await claimTableLaneRequest(db, new Date(t0.getTime() + TABLE_LANE_STALE_MS + 1000));
    expect(attempt2!.attempts).toBe(2);

    await expect(
      finishTableLaneRequest(db, first.id, 1, { kind: 'refusal', auditId: null }),
    ).rejects.toThrow(/newer invocation/);
    const mid = await readTableLaneRequest(db, first.id, userId);
    expect(mid!.status).toBe('running');
    expect(await getBalance(db, userId)).toBe(80);
    expect(await countRows(`select count(*) as n from credit_transactions where reason = 'compensation'`)).toBe(0);

    await finishTableLaneRequest(db, first.id, 2, { kind: 'answer', auditId: null });
    expect((await readTableLaneRequest(db, first.id, userId))!.status).toBe('done');
  });

  it('a superseded invocation cannot release a reclaimed row either', async () => {
    const userId = randomUUID();
    await seedSignup(userId, 100);
    const row = await created(userId);
    const t0 = new Date('2026-09-29T10:00:00Z');
    await claimTableLaneRequest(db, t0);
    await claimTableLaneRequest(db, new Date(t0.getTime() + TABLE_LANE_STALE_MS + 1000)); // attempt 2 owns it
    await expect(releaseForRetry(db, row.id, 1, 'late')).rejects.toThrow(/not running at attempt 1/);
    const after = await readTableLaneRequest(db, row.id, userId);
    expect(after!.status).toBe('running');
    expect(after!.attempts).toBe(2);
    expect(after!.failureSummary).toBeNull();
  });
});

describe('readTableLaneRequest', () => {
  it('returns the row for its owner and null for anyone else', async () => {
    const owner = randomUUID();
    await seedSignup(owner, 100);
    const row = await created(owner);
    expect((await readTableLaneRequest(db, row.id, owner))!.id).toBe(row.id);
    expect(await readTableLaneRequest(db, row.id, randomUUID())).toBeNull();
    expect(await readTableLaneRequest(db, 424242, owner)).toBeNull();
  });
});

describe('parent link and thread', () => {
  it('stores parent_id and thread_id when given', async () => {
    const userId = randomUUID();
    await seedSignup(userId, 100);
    const { rows: t } = await db.query('insert into chat_threads (user_id) values ($1::uuid) returning id', [userId]);
    const threadId = Number(t[0]!.id);
    const parent = await created(userId, { threadId });
    const child = await created(userId, { parentId: parent.id, threadId });
    expect(child.parentId).toBe(parent.id);
    expect(child.threadId).toBe(threadId);
  });
});

describe('setTableLaneThread (Ruling R3)', () => {
  it('writes the thread the job attached the answer to back onto the row', async () => {
    const userId = randomUUID();
    await seedSignup(userId, 100);
    const row = await created(userId);
    expect(row.threadId).toBeNull();
    const { rows: t } = await db.query('insert into chat_threads (user_id) values ($1::uuid) returning id', [userId]);
    const threadId = Number(t[0]!.id);
    await setTableLaneThread(db, row.id, threadId);
    expect((await readTableLaneRequest(db, row.id, userId))!.threadId).toBe(threadId);
  });

  it('is a no-op when the row already carries that thread, and never moves a row to another thread', async () => {
    const userId = randomUUID();
    await seedSignup(userId, 100);
    const { rows: t1 } = await db.query('insert into chat_threads (user_id) values ($1::uuid) returning id', [userId]);
    const { rows: t2 } = await db.query('insert into chat_threads (user_id) values ($1::uuid) returning id', [userId]);
    const first = Number(t1[0]!.id);
    const second = Number(t2[0]!.id);
    const row = await created(userId, { threadId: first });
    await setTableLaneThread(db, row.id, first);
    expect((await readTableLaneRequest(db, row.id, userId))!.threadId).toBe(first);
    await expect(setTableLaneThread(db, row.id, second)).rejects.toThrow(/thread/);
    expect((await readTableLaneRequest(db, row.id, userId))!.threadId).toBe(first);
  });
});
