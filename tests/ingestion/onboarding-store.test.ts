// pending_table_requests store (WP16 sub-part 2, design §1/§3): the
// create/claim/reclaim/finalize primitives CORE-1 and CORE-2 build on.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compensate, reserveOnboardingDebit } from '../../src/billing/ledger.ts';
import type { Db } from '../../src/db/types.ts';
import {
  claimOnePending,
  createPendingRequest,
  finalizeDelivered,
  finalizeFailed,
  finalizeUnanswerable,
  findActiveRequest,
  listRequestsForHistory,
  reclaimStaleRunning,
  recordSliceNote,
} from '../../src/ingestion/onboarding-store.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

async function withDb(fn: (db: Db) => Promise<void>): Promise<void> {
  const { db, close } = await createTestDb();
  try {
    await fn(db);
  } finally {
    await close();
  }
}

/** Grants a fresh user enough credits then debits the onboarding amount,
 * returning the debit id createPendingRequest needs — the realistic setup
 * every test here shares (mirrors triggerOnboarding's real sequence). */
async function setupDebitedUser(db: Db, credits = 150): Promise<{ userId: string; requestId: string; debitId: number }> {
  const userId = randomUUID();
  const requestId = randomUUID();
  await db.query('update signup_grant_config set credits = $1', [credits]);
  await db.query('select public.grant_signup_credits($1)', [userId]);
  const result = await reserveOnboardingDebit(db, userId, requestId, 100);
  if (result.kind !== 'debited') throw new Error(`test setup failed: ${result.kind}`);
  return { userId, requestId, debitId: result.entry.id };
}

describe('createPendingRequest', () => {
  it('inserts a row with status pending and the given fields', async () => {
    await withDb(async (db) => {
      const { userId, requestId, debitId } = await setupDebitedUser(db);
      const row = await createPendingRequest(db, {
        userId,
        requestId,
        questionText: 'hoeveel zonnestroom werd er opgewekt in 2024',
        topicTerm: 'zonnestroom',
        tableId: '82610NED',
        finderConfidence: 0.91,
        candidateIds: ['82610NED', '70072NED', '37789ksz'],
        debitTransactionId: debitId,
      });
      expect(row.status).toBe('pending');
      expect(row.tableId).toBe('82610NED');
      expect(row.attemptCount).toBe(0);
      expect(row.debitTransactionId).toBe(debitId);
      expect(row.ackAuditAnswerId).toBeNull();
      expect(row.finishedAt).toBeNull();
      // WP27 stage B: the candidate chain persists verbatim (pick first, order
      // preserved) and the fit-gate columns start unset (stage C fills them).
      expect(row.candidateIds).toEqual(['82610NED', '70072NED', '37789ksz']);
      expect(row.resolvedTableId).toBeNull();
    });
  });

  it('WP27 stage B: the chain round-trips through a fresh read (fromRow, not just returning *)', async () => {
    await withDb(async (db) => {
      const { userId, requestId, debitId } = await setupDebitedUser(db);
      await createPendingRequest(db, {
        userId,
        requestId,
        questionText: 'q',
        topicTerm: 't',
        tableId: '82610NED',
        finderConfidence: 0.9,
        candidateIds: ['82610NED', '70072NED'],
        debitTransactionId: debitId,
      });
      const read = await findActiveRequest(db, userId, '82610NED');
      expect(read!.candidateIds).toEqual(['82610NED', '70072NED']);
      expect(read!.resolvedTableId).toBeNull();
    });
  });

  it('WP27 stage B deploy-order safety: inserts + reads on a PRE-migration-015 schema (chain → [])', async () => {
    // Migration 015 is file-only until stage D: production runs this code
    // against the old schema for a while. The probe must route to the legacy
    // INSERT (a missing-column statement error would abort the caller's money
    // tx), and fromRow must default the absent columns.
    await withDb(async (db) => {
      await db.query(
        `alter table pending_table_requests
           drop column candidate_ids, drop column resolved_table_id, drop column fit_note`,
      );
      const { userId, requestId, debitId } = await setupDebitedUser(db);
      const row = await createPendingRequest(db, {
        userId,
        requestId,
        questionText: 'q',
        topicTerm: 't',
        tableId: '82610NED',
        finderConfidence: 0.9,
        candidateIds: ['82610NED', '70072NED'],
        debitTransactionId: debitId,
      });
      expect(row.status).toBe('pending');
      expect(row.candidateIds).toEqual([]);
      expect(row.resolvedTableId).toBeNull();
      const read = await findActiveRequest(db, userId, '82610NED');
      expect(read!.candidateIds).toEqual([]);
      expect(read!.resolvedTableId).toBeNull();
    });
  });

  it('rejects a second active row for the same (user, table) — the unique index, not app logic', async () => {
    await withDb(async (db) => {
      const { userId, requestId, debitId } = await setupDebitedUser(db, 250);
      await createPendingRequest(db, {
        userId,
        requestId,
        questionText: 'q1',
        topicTerm: 't1',
        tableId: '82610NED',
        finderConfidence: 0.9,
        candidateIds: [],
        debitTransactionId: debitId,
      });

      const second = await reserveOnboardingDebit(db, userId, randomUUID(), 100);
      if (second.kind !== 'debited') throw new Error('expected second debit to succeed (enough balance)');
      await expect(
        createPendingRequest(db, {
          userId,
          requestId: randomUUID(),
          questionText: 'q2',
          topicTerm: 't1',
          tableId: '82610NED',
          finderConfidence: 0.9,
          candidateIds: [],
          debitTransactionId: second.entry.id,
        }),
      ).rejects.toThrow();
    });
  });
});

describe('findActiveRequest', () => {
  it('finds a pending row for (user, table)', async () => {
    await withDb(async (db) => {
      const { userId, requestId, debitId } = await setupDebitedUser(db);
      await createPendingRequest(db, {
        userId,
        requestId,
        questionText: 'q',
        topicTerm: 't',
        tableId: '82610NED',
        finderConfidence: 0.9,
        candidateIds: [],
        debitTransactionId: debitId,
      });
      const found = await findActiveRequest(db, userId, '82610NED');
      expect(found).not.toBeNull();
      expect(found?.status).toBe('pending');
    });
  });

  it('returns null once the row reaches a terminal status', async () => {
    await withDb(async (db) => {
      const { userId, requestId, debitId } = await setupDebitedUser(db);
      const row = await createPendingRequest(db, {
        userId,
        requestId,
        questionText: 'q',
        topicTerm: 't',
        tableId: '82610NED',
        finderConfidence: 0.9,
        candidateIds: [],
        debitTransactionId: debitId,
      });
      await finalizeFailed(db, row.id, 'fetch failed: timeout');
      expect(await findActiveRequest(db, userId, '82610NED')).toBeNull();
    });
  });

  it('returns null for a table the user has no request for', async () => {
    await withDb(async (db) => {
      expect(await findActiveRequest(db, randomUUID(), '82610NED')).toBeNull();
    });
  });
});

// NOTE ON NAMING: this block covers claimOnePending's SINGLE-THREADED
// functional behavior (oldest-first, skips terminal/running, flips to
// running, empty-queue null) — NOT the concurrent double-claim guarantee.
// The `for update skip locked` clause that prevents two concurrent cron
// invocations from claiming the same row is a REAL production guarantee, but
// it cannot be exercised here: PGlite serializes every query onto one
// connection, so a Promise.all([claimOnePending, claimOnePending]) probe
// passes identically with AND without the clause (the second call always
// sees the row already flipped to 'running'). Deleting the clause therefore
// SURVIVES this suite unchanged — a mutation-honesty gap. The clause's
// presence is instead pinned mutation-provably by the source-pin describe
// block below ('claimOnePending — SKIP LOCKED source pin'). See that block's
// comment for the recorded judgment; do NOT rename this block back to imply
// the race itself is under functional test here.
describe('claimOnePending — single-threaded claim behavior', () => {
  it('claims the oldest pending row and flips it to running', async () => {
    await withDb(async (db) => {
      const a = await setupDebitedUser(db);
      const rowA = await createPendingRequest(db, {
        userId: a.userId,
        requestId: a.requestId,
        questionText: 'qa',
        topicTerm: 'ta',
        tableId: 'AAAA',
        finderConfidence: 0.9,
        candidateIds: [],
        debitTransactionId: a.debitId,
      });

      const claimed = await claimOnePending(db);
      expect(claimed?.id).toBe(rowA.id);
      expect(claimed?.status).toBe('running');
      expect(claimed?.claimedAt).not.toBeNull();
    });
  });

  it('returns null when the queue is empty', async () => {
    await withDb(async (db) => {
      expect(await claimOnePending(db)).toBeNull();
    });
  });

  it('never claims an already-running or terminal row', async () => {
    await withDb(async (db) => {
      const a = await setupDebitedUser(db);
      const rowA = await createPendingRequest(db, {
        userId: a.userId,
        requestId: a.requestId,
        questionText: 'qa',
        topicTerm: 'ta',
        tableId: 'AAAA',
        finderConfidence: 0.9,
        candidateIds: [],
        debitTransactionId: a.debitId,
      });
      await finalizeFailed(db, rowA.id, 'nope');
      expect(await claimOnePending(db)).toBeNull();
    });
  });

  it('claims oldest-first (created_at order)', async () => {
    await withDb(async (db) => {
      const a = await setupDebitedUser(db, 300);
      const rowOld = await createPendingRequest(db, {
        userId: a.userId,
        requestId: a.requestId,
        questionText: 'old',
        topicTerm: 't',
        tableId: 'OLD1',
        finderConfidence: 0.9,
        candidateIds: [],
        debitTransactionId: a.debitId,
      });
      const second = await reserveOnboardingDebit(db, a.userId, randomUUID(), 100);
      if (second.kind !== 'debited') throw new Error('expected second debit');
      await createPendingRequest(db, {
        userId: a.userId,
        requestId: randomUUID(),
        questionText: 'new',
        topicTerm: 't',
        tableId: 'NEW1',
        finderConfidence: 0.9,
        candidateIds: [],
        debitTransactionId: second.entry.id,
      });

      const claimed = await claimOnePending(db);
      expect(claimed?.id).toBe(rowOld.id);
    });
  });
});

// The double-claim guard (design §3 step 2 / §8 risk 2) is `for update skip
// locked` in claimOnePending's claim subquery. It is the ONLY thing that stops
// two concurrent cron invocations from claiming the same pending row in real
// Postgres. That race CANNOT be reproduced hermetically: PGlite runs every
// query on a single serialized connection, so removing the clause leaves the
// entire store + job suites green (verified: a deletion mutation survives 32
// store + 9 job tests). A behavioral test is therefore impossible here.
//
// So we pin the clause the honest way — a SOURCE pin, mutation-provable:
// deleting `for update skip locked` from onboarding-store.ts fails this test,
// which nothing else in the hermetic suite does. Same recorded judgment as
// web/app/onboarding-wiring.test.ts: for a load-bearing guarantee the harness
// physically cannot exercise, a brittle-but-honest source scan is judged
// better than silently shipping an untested (and, once mutated, unguarded)
// money-flow concurrency guarantee. Verify the clause end-to-end against real
// Postgres in the supervised live step (it is not on the hermetic gate).
describe('claimOnePending — SKIP LOCKED source pin (untestable behaviorally under PGlite)', () => {
  const source = readFileSync(join(__dirname, '../../src/ingestion/onboarding-store.ts'), 'utf-8');

  it('claimOnePending still claims via FOR UPDATE SKIP LOCKED', () => {
    // Isolate claimOnePending's body so the clause is pinned to THIS function,
    // not merely present somewhere in the file.
    const start = source.indexOf('export async function claimOnePending');
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf('export ', start + 1);
    const body = source.slice(start, end === -1 ? undefined : end);
    expect(body.toLowerCase()).toContain('for update skip locked');
  });
});

describe('reclaimStaleRunning', () => {
  it('reclaims a running row past the staleness window back to pending, bumping attempt_count', async () => {
    await withDb(async (db) => {
      const a = await setupDebitedUser(db);
      const row = await createPendingRequest(db, {
        userId: a.userId,
        requestId: a.requestId,
        questionText: 'q',
        topicTerm: 't',
        tableId: 'AAAA',
        finderConfidence: 0.9,
        candidateIds: [],
        debitTransactionId: a.debitId,
      });
      await db.query(
        `update pending_table_requests set status = 'running', claimed_at = now() - interval '30 minutes' where id = $1`,
        [row.id],
      );

      const result = await reclaimStaleRunning(db, 20 * 60 * 1000, 3);
      expect(result.reclaimedIds).toEqual([row.id]);
      expect(result.exhaustedIds).toEqual([]);

      const after = await findActiveRequest(db, a.userId, 'AAAA');
      expect(after?.status).toBe('pending');
      expect(after?.attemptCount).toBe(1);
    });
  });

  it('leaves a recently-claimed running row untouched', async () => {
    await withDb(async (db) => {
      const a = await setupDebitedUser(db);
      const row = await createPendingRequest(db, {
        userId: a.userId,
        requestId: a.requestId,
        questionText: 'q',
        topicTerm: 't',
        tableId: 'AAAA',
        finderConfidence: 0.9,
        candidateIds: [],
        debitTransactionId: a.debitId,
      });
      await db.query(`update pending_table_requests set status = 'running', claimed_at = now() where id = $1`, [row.id]);

      const result = await reclaimStaleRunning(db, 20 * 60 * 1000, 3);
      expect(result.reclaimedIds).toEqual([]);
      expect(result.exhaustedIds).toEqual([]);
    });
  });

  it('reports (not reclaims) a stale row that already hit the attempt cap — the job must terminally fail it', async () => {
    await withDb(async (db) => {
      const a = await setupDebitedUser(db);
      const row = await createPendingRequest(db, {
        userId: a.userId,
        requestId: a.requestId,
        questionText: 'q',
        topicTerm: 't',
        tableId: 'AAAA',
        finderConfidence: 0.9,
        candidateIds: [],
        debitTransactionId: a.debitId,
      });
      await db.query(
        `update pending_table_requests
         set status = 'running', claimed_at = now() - interval '30 minutes', attempt_count = 3
         where id = $1`,
        [row.id],
      );

      const result = await reclaimStaleRunning(db, 20 * 60 * 1000, 3);
      expect(result.reclaimedIds).toEqual([]);
      expect(result.exhaustedIds).toEqual([row.id]);

      // Still running — the job (not this store) is responsible for the
      // terminal fail + refund transition.
      const stillRunning = await db.query('select status from pending_table_requests where id = $1', [row.id]);
      expect(stillRunning.rows[0]?.status).toBe('running');
    });
  });
});

describe('finalize* transitions', () => {
  it('finalizeDelivered sets status=delivered, delivery_audit_answer_id, finished_at', async () => {
    await withDb(async (db) => {
      const a = await setupDebitedUser(db);
      const row = await createPendingRequest(db, {
        userId: a.userId,
        requestId: a.requestId,
        questionText: 'q',
        topicTerm: 't',
        tableId: 'AAAA',
        finderConfidence: 0.9,
        candidateIds: [],
        debitTransactionId: a.debitId,
      });
      await finalizeDelivered(db, row.id, { deliveryAuditAnswerId: 42 });
      const { rows } = await db.query('select * from pending_table_requests where id = $1', [row.id]);
      expect(rows[0]?.status).toBe('delivered');
      expect(Number(rows[0]?.delivery_audit_answer_id)).toBe(42);
      expect(rows[0]?.finished_at).not.toBeNull();
    });
  });

  it('finalizeUnanswerable sets status=unanswerable + failure_summary', async () => {
    await withDb(async (db) => {
      const a = await setupDebitedUser(db);
      const row = await createPendingRequest(db, {
        userId: a.userId,
        requestId: a.requestId,
        questionText: 'q',
        topicTerm: 't',
        tableId: 'AAAA',
        finderConfidence: 0.9,
        candidateIds: [],
        debitTransactionId: a.debitId,
      });
      await finalizeUnanswerable(db, row.id, 'the re-run produced a clarification, not an answer');
      const { rows } = await db.query('select * from pending_table_requests where id = $1', [row.id]);
      expect(rows[0]?.status).toBe('unanswerable');
      expect(rows[0]?.failure_summary).toMatch(/clarification/);
    });
  });

  it('finalizeFailed sets status=failed + failure_summary', async () => {
    await withDb(async (db) => {
      const a = await setupDebitedUser(db);
      const row = await createPendingRequest(db, {
        userId: a.userId,
        requestId: a.requestId,
        questionText: 'q',
        topicTerm: 't',
        tableId: 'AAAA',
        finderConfidence: 0.9,
        candidateIds: [],
        debitTransactionId: a.debitId,
      });
      await finalizeFailed(db, row.id, 'CBS fetch threw: ECONNRESET');
      const { rows } = await db.query('select * from pending_table_requests where id = $1', [row.id]);
      expect(rows[0]?.status).toBe('failed');
      expect(rows[0]?.failure_summary).toMatch(/ECONNRESET/);
    });
  });

  it('a finalized row can no longer be claimed', async () => {
    await withDb(async (db) => {
      const a = await setupDebitedUser(db);
      const row = await createPendingRequest(db, {
        userId: a.userId,
        requestId: a.requestId,
        questionText: 'q',
        topicTerm: 't',
        tableId: 'AAAA',
        finderConfidence: 0.9,
        candidateIds: [],
        debitTransactionId: a.debitId,
      });
      await finalizeDelivered(db, row.id, { deliveryAuditAnswerId: 1 });
      expect(await claimOnePending(db)).toBeNull();
    });
  });
});

describe('recordSliceNote', () => {
  it('writes a diagnostic note without changing status', async () => {
    await withDb(async (db) => {
      const a = await setupDebitedUser(db);
      const row = await createPendingRequest(db, {
        userId: a.userId,
        requestId: a.requestId,
        questionText: 'q',
        topicTerm: 't',
        tableId: 'AAAA',
        finderConfidence: 0.9,
        candidateIds: [],
        debitTransactionId: a.debitId,
      });
      await db.query(`update pending_table_requests set status = 'running' where id = $1`, [row.id]);
      await recordSliceNote(db, row.id, 'sliced to national totals, last 10 years (est. 480k -> 12k cells)');
      const { rows } = await db.query('select status, slice_note from pending_table_requests where id = $1', [row.id]);
      expect(rows[0]?.status).toBe('running');
      expect(rows[0]?.slice_note).toMatch(/sliced to national totals/);
    });
  });
});

// PERIPHERY (design §5-dashboard): the dashboard read path -- the ledger join
// history.ts folds into the user's question timeline.
describe('listRequestsForHistory', () => {
  it('reports a pending row net 100 (the onboarding debit, not yet reversed)', async () => {
    await withDb(async (db) => {
      const a = await setupDebitedUser(db);
      const row = await createPendingRequest(db, {
        userId: a.userId,
        requestId: a.requestId,
        questionText: 'hoeveel zonnestroom werd er opgewekt in 2024',
        topicTerm: 'zonnestroom',
        tableId: '82610NED',
        finderConfidence: 0.91,
        candidateIds: [],
        debitTransactionId: a.debitId,
      });
      const history = await listRequestsForHistory(db, a.userId);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        id: row.id,
        status: 'pending',
        questionText: 'hoeveel zonnestroom werd er opgewekt in 2024',
        topicTerm: 'zonnestroom',
        tableId: '82610NED',
        netCredits: 100,
        deliveryAuditAnswerId: null,
        failureSummary: null,
      });
      expect(history[0]?.finishedAt).toBeNull();
    });
  });

  it('reports a delivered row STILL net 100 -- the debit stands, the fetch was worth it', async () => {
    await withDb(async (db) => {
      const a = await setupDebitedUser(db);
      const row = await createPendingRequest(db, {
        userId: a.userId,
        requestId: a.requestId,
        questionText: 'q',
        topicTerm: 't',
        tableId: 'AAAA',
        finderConfidence: 0.9,
        candidateIds: [],
        debitTransactionId: a.debitId,
      });
      await finalizeDelivered(db, row.id, { deliveryAuditAnswerId: 42 });

      const history = await listRequestsForHistory(db, a.userId);
      expect(history[0]).toMatchObject({
        status: 'delivered',
        netCredits: 100,
        deliveryAuditAnswerId: 42,
      });
      expect(history[0]?.finishedAt).not.toBeNull();
    });
  });

  it('reports a refunded (failed) row net 0 -- migration 013 compensate() applied', async () => {
    await withDb(async (db) => {
      const a = await setupDebitedUser(db);
      const row = await createPendingRequest(db, {
        userId: a.userId,
        requestId: a.requestId,
        questionText: 'q',
        topicTerm: 't',
        tableId: 'AAAA',
        finderConfidence: 0.9,
        candidateIds: [],
        debitTransactionId: a.debitId,
      });
      await compensate(db, a.userId, a.debitId, 100, null);
      await finalizeFailed(db, row.id, 'Onverwachte fout bij het ophalen: ECONNRESET');

      const history = await listRequestsForHistory(db, a.userId);
      expect(history[0]).toMatchObject({
        status: 'failed',
        netCredits: 0,
        failureSummary: 'Onverwachte fout bij het ophalen: ECONNRESET',
      });
    });
  });

  it('reports a refunded (unanswerable) row net 0', async () => {
    await withDb(async (db) => {
      const a = await setupDebitedUser(db);
      const row = await createPendingRequest(db, {
        userId: a.userId,
        requestId: a.requestId,
        questionText: 'q',
        topicTerm: 't',
        tableId: 'AAAA',
        finderConfidence: 0.9,
        candidateIds: [],
        debitTransactionId: a.debitId,
      });
      await compensate(db, a.userId, a.debitId, 100, null);
      await finalizeUnanswerable(db, row.id, 'De vraag kon niet betrouwbaar worden beantwoord met de opgehaalde cijfers.');

      const history = await listRequestsForHistory(db, a.userId);
      expect(history[0]).toMatchObject({ status: 'unanswerable', netCredits: 0 });
    });
  });

  it('orders most-recent-first and never returns another user\'s rows', async () => {
    await withDb(async (db) => {
      const a = await setupDebitedUser(db, 350);
      const other = await setupDebitedUser(db, 150);
      await createPendingRequest(db, {
        userId: a.userId,
        requestId: a.requestId,
        questionText: 'eerste',
        topicTerm: 't1',
        tableId: 'AAAA',
        finderConfidence: 0.9,
        candidateIds: [],
        debitTransactionId: a.debitId,
      });
      const second = await reserveOnboardingDebit(db, a.userId, randomUUID(), 100);
      if (second.kind !== 'debited') throw new Error('expected second debit to succeed');
      await createPendingRequest(db, {
        userId: a.userId,
        requestId: randomUUID(),
        questionText: 'tweede',
        topicTerm: 't2',
        tableId: 'BBBB',
        finderConfidence: 0.9,
        candidateIds: [],
        debitTransactionId: second.entry.id,
      });
      await createPendingRequest(db, {
        userId: other.userId,
        requestId: other.requestId,
        questionText: 'niet van mij',
        topicTerm: 't3',
        tableId: 'CCCC',
        finderConfidence: 0.9,
        candidateIds: [],
        debitTransactionId: other.debitId,
      });

      const history = await listRequestsForHistory(db, a.userId);
      expect(history.map((h) => h.questionText)).toEqual(['tweede', 'eerste']);
    });
  });

  it('returns an empty list when the user has no onboarding requests', async () => {
    await withDb(async (db) => {
      const history = await listRequestsForHistory(db, randomUUID());
      expect(history).toEqual([]);
    });
  });
});
