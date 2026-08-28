// #65 / WP25: src/db/error-log.ts — the write + retention primitives.
//
// The pins that matter, per the WP25 brief:
//   1. FAIL-OPEN: logError never throws and never rejects, whatever breaks —
//      a broken logger must never break the product path or mask the original
//      error (the reverse of R8's fail-closed audit store, deliberately).
//   2. The uuid guard: a crafted non-uuid requestId must not fail the insert
//      (uuid column) — it is preserved in context instead.
//   3. Bounds: message/stack/context are truncated or replaced, never allowed
//      to fail the insert or store unbounded blobs.
//   4. Retention (90 days): count and purge share one WHERE (⟨F2⟩ — preview
//      and apply can never disagree), purge DELETES and is idempotent.
import { describe, expect, it, vi } from 'vitest';
import {
  countPurgeableErrorLog,
  ERROR_LOG_RETENTION_DAYS,
  errorLogRetentionCutoff,
  logError,
  purgeExpiredErrorLog,
} from '../../src/db/error-log.ts';
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

const REQ = '00000000-0000-4000-8000-000000000001';
const USER = '11111111-1111-4111-8111-111111111111';

describe('#65 logError — the durable write', () => {
  it('writes source, message, stack and the uuid join columns from a real Error', async () => {
    await withDb(async (db) => {
      await logError(db, {
        source: 'askQuestion',
        error: new Error('pipeline exploded'),
        requestId: REQ,
        userId: USER,
        context: { step: 'chargeAndRun' },
      });
      const { rows } = await db.query(
        `select source, request_id, user_id, message, stack, context->>'step' as step
         from error_log`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.source).toBe('askQuestion');
      expect(rows[0]!.request_id).toBe(REQ);
      expect(rows[0]!.user_id).toBe(USER);
      expect(rows[0]!.message).toBe('pipeline exploded');
      expect(String(rows[0]!.stack)).toContain('pipeline exploded');
      expect(rows[0]!.step).toBe('chargeAndRun');
    });
  });

  it('handles a non-Error thrown value (string / object) without losing the row', async () => {
    await withDb(async (db) => {
      await logError(db, { source: 'stripe-webhook', error: 'plain string failure' });
      await logError(db, { source: 'stripe-webhook', error: { code: 'weird' } });
      const { rows } = await db.query(`select message, stack from error_log order by id`);
      expect(rows).toHaveLength(2);
      expect(rows[0]!.message).toBe('plain string failure');
      expect(rows[0]!.stack).toBeNull();
      expect(rows[1]!.message).toBe('{"code":"weird"}');
    });
  });

  it('FAIL-OPEN: a broken db (throwing query) resolves without throwing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const broken: Db = {
        query: () => Promise.reject(new Error('relation "error_log" does not exist')),
        withTransaction: () => Promise.reject(new Error('no')),
      };
      // The deploy-order case: until migration 024's supervised apply, every
      // production write lands exactly here — and must be silent to callers.
      await expect(
        logError(broken, { source: 'askQuestion', error: new Error('original') }),
      ).resolves.toBeUndefined();
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('error_log write failed'),
        expect.any(Error),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('FAIL-OPEN belt: even a db whose query throws SYNCHRONOUSLY cannot escape', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const hostile = {
        query: () => {
          throw new Error('sync explosion');
        },
      } as unknown as Db;
      await expect(logError(hostile, { source: 'health', error: 'x' })).resolves.toBeUndefined();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('a non-uuid requestId (crafted client) never fails the insert — preserved in context', async () => {
    await withDb(async (db) => {
      await logError(db, {
        source: 'replyToClarification',
        error: new Error('boom'),
        requestId: 'not-a-uuid-at-all',
        userId: 'also-not-a-uuid',
      });
      const { rows } = await db.query(
        `select request_id, user_id, context->>'rawRequestId' as raw from error_log`,
      );
      expect(rows).toHaveLength(1);
      // The uuid columns stay null; the crafted value survives, bounded, in
      // context — the trace exists precisely for requests like this one.
      expect(rows[0]!.request_id).toBeNull();
      expect(rows[0]!.user_id).toBeNull();
      expect(rows[0]!.raw).toBe('not-a-uuid-at-all');
    });
  });

  it('bounds message, stack and context instead of storing unbounded blobs', async () => {
    await withDb(async (db) => {
      const huge = 'x'.repeat(50_000);
      const error = new Error(huge);
      error.stack = huge;
      await logError(db, {
        source: 'askQuestion',
        error,
        context: { blob: 'y'.repeat(20_000) },
      });
      const { rows } = await db.query(`select message, stack, context from error_log`);
      expect(rows).toHaveLength(1);
      expect(String(rows[0]!.message).length).toBeLessThan(2100);
      expect(String(rows[0]!.message)).toContain('[truncated]');
      expect(String(rows[0]!.stack).length).toBeLessThan(8100);
      // Over-bound context is REPLACED by a marker (truncated JSON would be
      // garbage), and the row still writes.
      expect(JSON.stringify(rows[0]!.context)).toContain('context dropped');
    });
  });
});

describe('#65 error_log retention — 90 days, DELETED (the trial_questions precedent)', () => {
  async function seedAged(db: Db, daysAgo: number): Promise<void> {
    await logError(db, { source: 'askQuestion', error: new Error(`aged ${daysAgo}d`) });
    await db.query(
      `update error_log set occurred_at = now() - make_interval(days => $1)
       where message = $2`,
      [daysAgo, `aged ${daysAgo}d`],
    );
  }

  it('cutoff is exactly the retention constant behind everything else', () => {
    const now = new Date('2026-08-27T12:00:00.000Z');
    const cutoff = errorLogRetentionCutoff(now);
    const days = (now.getTime() - cutoff.getTime()) / 86_400_000;
    expect(days).toBe(ERROR_LOG_RETENTION_DAYS);
    expect(ERROR_LOG_RETENTION_DAYS).toBe(90);
  });

  it('count (dry run) and purge (apply) agree — one WHERE, and purge is idempotent', async () => {
    await withDb(async (db) => {
      await seedAged(db, 91); // expired
      await seedAged(db, 89); // inside the window — must survive
      const cutoff = errorLogRetentionCutoff(new Date());

      const counted = await countPurgeableErrorLog(db, cutoff);
      expect(counted).toBe(1);

      const purged = await purgeExpiredErrorLog(db, cutoff);
      expect(purged).toBe(counted); // ⟨F2⟩: apply does what the preview said

      const { rows } = await db.query(`select message from error_log`);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.message).toBe('aged 89d');

      // Idempotent: a second run against the same cutoff finds nothing new.
      expect(await purgeExpiredErrorLog(db, cutoff)).toBe(0);
    });
  });
});
