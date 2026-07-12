// WP135 chat workspace (ADR 033): hermetic pins for src/threads/index.ts — the
// thread entity's read/write SQL. Pure PGlite + real migrations, the
// tests/audit/retention.test.ts + tests/billing/history.test.ts pattern this
// module's read side descends from. No live database, no LLM calls.
//
// THE CRITICAL SECURITY PINS here (the #14 cross-user pins, extended to the two
// new read paths + the attach write path): listThreads / getThreadRows return
// nothing for another user's thread, a forged thread id validates to null and
// never inserts, and attachOrCreateThread can only move the CALLING user's own
// audit rows.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  attachOrCreateThread,
  getThreadRows,
  listThreads,
  validateThreadOwnership,
} from '../../src/threads/index.ts';
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

async function createThread(db: Db, userId: string, lastActivityAt?: string): Promise<number> {
  const { rows } = await db.query(
    `insert into chat_threads (user_id, last_activity_at)
       values ($1::uuid, coalesce($2::timestamptz, now())) returning id`,
    [userId, lastActivityAt ?? null],
  );
  return Number(rows[0]!.id);
}

async function insertRow(
  db: Db,
  userId: string,
  opts: {
    kind: 'answer' | 'clarification' | 'refusal';
    question: string;
    finalText?: string;
    threadId?: number | null;
    requestId?: string | null;
    createdAt?: string;
    response?: Record<string, unknown>;
  },
): Promise<number> {
  const response = opts.response ?? {
    schemaVersion: 1,
    kind: opts.kind,
    question: opts.question,
    text: opts.finalText ?? opts.question,
  };
  const { rows } = await db.query(
    `insert into audit_answers
       (schema_version, user_id, source_tag, kind, question, reference_date, response, final_text,
        prompt_versions, latency_ms, request_id, thread_id, created_at)
     values (1, $1, 'user', $2, $3, '2026-01-01', $4::jsonb, $5, '{}'::jsonb, 100, $6, $7,
        coalesce($8::timestamptz, now()))
     returning id`,
    [
      userId,
      opts.kind,
      opts.question,
      JSON.stringify(response),
      opts.finalText ?? opts.question,
      opts.requestId ?? null,
      opts.threadId ?? null,
      opts.createdAt ?? null,
    ],
  );
  return Number(rows[0]!.id);
}

async function redactRow(db: Db, id: number): Promise<void> {
  // Mirror what src/answer/audit/retention.ts writes: the question sentinel is
  // what both listThreads and the replay layer detect a redacted row by.
  await db.query(
    `update audit_answers set question = $2, final_text = $2,
       response = '{"schemaVersion":1,"kind":"answer","question":"Deze vraag is verwijderd.","text":"Deze vraag is verwijderd.","redacted":true}'::jsonb
     where id = $1`,
    [id, 'Deze vraag is verwijderd.'],
  );
}

async function countThreads(db: Db): Promise<number> {
  const { rows } = await db.query('select count(*)::int as n from chat_threads');
  return Number(rows[0]!.n);
}

async function threadIdOf(db: Db, auditId: number): Promise<number | null> {
  const { rows } = await db.query('select thread_id from audit_answers where id = $1', [auditId]);
  const v = rows[0]!.thread_id;
  return v === null ? null : Number(v);
}

describe('migration 019 (pin 10): the schema is green in the hermetic harness', () => {
  it('chat_threads exists and audit_answers gained thread_id', async () => {
    await withDb(async (db) => {
      // A create + select round-trips only if migration 019 applied cleanly.
      const userId = randomUUID();
      const threadId = await createThread(db, userId);
      expect(threadId).toBeGreaterThan(0);
      const auditId = await insertRow(db, userId, { kind: 'answer', question: 'q', threadId });
      expect(await threadIdOf(db, auditId)).toBe(threadId);
    });
  });
});

describe('validateThreadOwnership — READ-ONLY ownership check (pin 1 + pin 5)', () => {
  it('never inserts: a validation call leaves the chat_threads row count unchanged', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const threadId = await createThread(db, userId);
      const before = await countThreads(db);
      await validateThreadOwnership(db, userId, threadId);
      await validateThreadOwnership(db, userId, 999999); // non-existent
      await validateThreadOwnership(db, userId, 'not-a-number');
      await validateThreadOwnership(db, userId, null);
      expect(await countThreads(db)).toBe(before);
    });
  });

  it('returns the id for an owned thread; null for another user\'s thread, a forged/malformed id', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const otherId = randomUUID();
      const mine = await createThread(db, userId);
      const theirs = await createThread(db, otherId);

      expect(await validateThreadOwnership(db, userId, mine)).toBe(mine);
      // Another user's thread: null, and never leaks that it exists.
      expect(await validateThreadOwnership(db, userId, theirs)).toBeNull();
      // Malformed / out-of-range / negative all coerce to null (fail-safe).
      expect(await validateThreadOwnership(db, userId, -1)).toBeNull();
      expect(await validateThreadOwnership(db, userId, 12.5)).toBeNull();
      expect(await validateThreadOwnership(db, userId, Number.MAX_VALUE)).toBeNull();
      expect(await validateThreadOwnership(db, userId, {})).toBeNull();
      expect(await validateThreadOwnership(db, userId, undefined)).toBeNull();
    });
  });
});

describe('attachOrCreateThread — atomic lazy creation (pin 1 + pin 5 + pin 8)', () => {
  it('creates exactly one thread and attaches the audit row atomically when the id is null', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const auditId = await insertRow(db, userId, { kind: 'answer', question: 'q' });
      expect(await threadIdOf(db, auditId)).toBeNull(); // pin 8: written without a threadId

      const before = await countThreads(db);
      const threadId = await attachOrCreateThread(db, userId, null, auditId);
      expect(await countThreads(db)).toBe(before + 1); // exactly one new thread
      expect(await threadIdOf(db, auditId)).toBe(threadId); // attached atomically
    });
  });

  it('attaches to an existing thread and touches last_activity_at (pin 5)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      // A thread whose last activity is clearly in the past.
      const threadId = await createThread(db, userId, '2020-01-01T00:00:00Z');
      const auditId = await insertRow(db, userId, { kind: 'answer', question: 'volgende vraag' });

      const before = await countThreads(db);
      const attached = await attachOrCreateThread(db, userId, threadId, auditId);
      expect(attached).toBe(threadId);
      expect(await countThreads(db)).toBe(before); // no new thread for a resume

      const { rows } = await db.query(
        'select last_activity_at from chat_threads where id = $1',
        [threadId],
      );
      const touched = new Date(rows[0]!.last_activity_at as string);
      expect(touched.getTime()).toBeGreaterThan(new Date('2020-01-01T00:00:00Z').getTime());
    });
  });

  it('CROSS-USER: cannot move another user\'s audit row — the UPDATE binds user_id (pin 1)', async () => {
    await withDb(async (db) => {
      const attacker = randomUUID();
      const victim = randomUUID();
      const victimRow = await insertRow(db, victim, { kind: 'answer', question: 'van het slachtoffer' });

      // The attacker tries to sweep the victim's audit row into a thread.
      await expect(attachOrCreateThread(db, attacker, null, victimRow)).rejects.toThrow();
      // The victim's row is untouched, and no orphan thread was left behind.
      expect(await threadIdOf(db, victimRow)).toBeNull();
      expect(await countThreads(db)).toBe(0);
    });
  });

  it('forged rawThreadId ⇒ validate-to-null ⇒ a FRESH thread, never another user\'s (pin 1)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const otherId = randomUUID();
      const othersThread = await createThread(db, otherId);
      const otherRow = await insertRow(db, otherId, { kind: 'answer', question: 'ander', threadId: othersThread });

      // The real flow: the client forges otherThread's id; validateThreadOwnership
      // nulls it, and attachOrCreateThread(null) makes a fresh thread instead.
      const myRow = await insertRow(db, userId, { kind: 'answer', question: 'van mij' });
      const validated = await validateThreadOwnership(db, userId, othersThread);
      expect(validated).toBeNull();
      const freshThread = await attachOrCreateThread(db, userId, validated, myRow);

      expect(freshThread).not.toBe(othersThread); // a NEW thread, not the victim's
      expect(await threadIdOf(db, myRow)).toBe(freshThread);
      // The other user's thread still holds exactly its own row, unchanged.
      expect(await threadIdOf(db, otherRow)).toBe(othersThread);
    });
  });
});

describe('listThreads — read-time title derivation + redaction filter (pin 1 + pin 4)', () => {
  it('titles from the first non-redacted row, most-recent-activity first, scoped to the user', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const older = await createThread(db, userId, '2026-01-01T00:00:00Z');
      const newer = await createThread(db, userId, '2026-02-01T00:00:00Z');
      await insertRow(db, userId, {
        kind: 'answer',
        question: 'Hoeveel inwoners heeft Nederland?',
        threadId: older,
        createdAt: '2026-01-01T00:00:00Z',
      });
      await insertRow(db, userId, {
        kind: 'answer',
        question: 'Wat was de inflatie in 2024?',
        threadId: newer,
        createdAt: '2026-02-01T00:00:00Z',
      });

      const list = await listThreads(db, userId);
      expect(list.map((t) => ({ id: t.id, title: t.title }))).toEqual([
        { id: newer, title: 'Wat was de inflatie in 2024?' },
        { id: older, title: 'Hoeveel inwoners heeft Nederland?' },
      ]);
    });
  });

  it('title comes from the FIRST row (created_at asc), truncated to 60 chars', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const threadId = await createThread(db, userId);
      const long = 'Hoeveel inwoners heeft de gemeente Súdwest-Fryslân volgens de meest recente telling?';
      await insertRow(db, userId, { kind: 'answer', question: long, threadId, createdAt: '2026-01-01T00:00:00Z' });
      await insertRow(db, userId, { kind: 'answer', question: 'tweede vraag', threadId, createdAt: '2026-01-02T00:00:00Z' });

      const [entry] = await listThreads(db, userId);
      expect(entry!.title).toBe(long.slice(0, 60));
      expect(entry!.title.length).toBe(60);
    });
  });

  it('REDACTION (pin 4): a fully-redacted thread vanishes; a partial thread titles from its first LIVE row', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      // Thread A: every row redacted ⇒ filtered out of the sidebar.
      const fully = await createThread(db, userId, '2026-03-01T00:00:00Z');
      const a1 = await insertRow(db, userId, { kind: 'answer', question: 'weg 1', threadId: fully, createdAt: '2026-03-01T00:00:00Z' });
      const a2 = await insertRow(db, userId, { kind: 'answer', question: 'weg 2', threadId: fully, createdAt: '2026-03-01T00:01:00Z' });
      await redactRow(db, a1);
      await redactRow(db, a2);

      // Thread B: the first (oldest) row redacted, a later row survives ⇒ its
      // title comes from that first NON-redacted row, never the sentinel.
      const partial = await createThread(db, userId, '2026-03-02T00:00:00Z');
      const b1 = await insertRow(db, userId, { kind: 'answer', question: 'verwijderde eerste', threadId: partial, createdAt: '2026-03-02T00:00:00Z' });
      await insertRow(db, userId, { kind: 'answer', question: 'levende tweede vraag', threadId: partial, createdAt: '2026-03-02T00:01:00Z' });
      await redactRow(db, b1);

      const list = await listThreads(db, userId);
      expect(list.map((t) => t.id)).toEqual([partial]); // fully-redacted gone
      expect(list[0]!.title).toBe('levende tweede vraag');
    });
  });

  it('CROSS-USER: never returns another user\'s threads (pin 1)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const otherId = randomUUID();
      const theirs = await createThread(db, otherId);
      await insertRow(db, otherId, { kind: 'answer', question: 'niet van mij', threadId: theirs });

      expect(await listThreads(db, userId)).toEqual([]);
    });
  });
});

describe('getThreadRows — thread turns + ledger cost (pin 1)', () => {
  it('returns the thread\'s rows in created_at/id order, redacted rows included', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const threadId = await createThread(db, userId);
      const r1 = await insertRow(db, userId, { kind: 'answer', question: 'eerste', threadId, createdAt: '2026-01-01T00:00:00Z' });
      const r2 = await insertRow(db, userId, { kind: 'answer', question: 'tweede', threadId, createdAt: '2026-01-02T00:00:00Z' });
      await redactRow(db, r1);

      const rows = await getThreadRows(db, userId, threadId);
      expect(rows.map((r) => r.id)).toEqual([r1, r2]);
      // Redacted rows are INCLUDED (the replay layer turns them into placeholders).
      expect(rows[0]!.question).toBe('Deze vraag is verwijderd.');
      expect(rows[1]!.question).toBe('tweede');
    });
  });

  it('creditsCharged reconstructs the gate\'s own netCost via the ledger join', async () => {
    await withDb(async (db) => {
      await applyPricingDefaults(db);
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      const threadId = await createThread(db, userId);
      const requestId = randomUUID();
      // The audit row exists (with request_id + thread_id) before the gate
      // compensates against its id — the real wrap order.
      const auditId = await insertRow(db, userId, {
        kind: 'answer',
        question: 'Hoeveel inwoners heeft Nederland?',
        finalText: 'testantwoord',
        threadId,
        requestId,
      });
      const gated = await chargeAndRun(db, userId, requestId, async (): Promise<AuditedResponse> => ({
        response: { kind: 'answer', question: 'x', text: 'testantwoord' } as unknown as AuditedResponse['response'],
        auditId,
      }));
      if (gated.kind !== 'ok') throw new Error(`expected ok, got ${gated.kind}`);

      const rows = await getThreadRows(db, userId, threadId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.creditsCharged).toBe(gated.netCost);
    });
  });

  it('null cost when a row has no request_id (nothing to attribute a debit to)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const threadId = await createThread(db, userId);
      await insertRow(db, userId, { kind: 'answer', question: 'geen request id', threadId, requestId: null });
      const rows = await getThreadRows(db, userId, threadId);
      expect(rows[0]!.creditsCharged).toBeNull();
    });
  });

  it('CROSS-USER: returns nothing for another user\'s thread (pin 1)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const otherId = randomUUID();
      const theirs = await createThread(db, otherId);
      await insertRow(db, otherId, { kind: 'answer', question: 'niet van mij', threadId: theirs });

      // Even with the correct thread id, the user_id scope returns nothing.
      expect(await getThreadRows(db, userId, theirs)).toEqual([]);
    });
  });
});
