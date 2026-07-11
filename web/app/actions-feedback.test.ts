// WP128 (#128): the REAL submitAnswerFeedback Server Action, hermetic — the
// auth seam (lib/current-user.ts) and the db seam (lib/db.ts) are stubbed at
// their modules (the login/actions.test.ts precedent), so the action's OWN
// fail-soft guarantee is what runs: the whole-body try/catch, the auth-null
// branch, and the attacker-input validation gates. This is the frozen brief's
// ⟨K:migration-deploy-2⟩ action-level pin — the one carrying the deploy-order
// safety claim (pre-migration-017 the store helper THROWS on the missing
// table; the action's catch is what turns that into { ok: false }).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../backend/db/types.ts';

const { currentUserId, getDb } = vi.hoisted(() => ({
  currentUserId: vi.fn<() => Promise<string | null>>(),
  getDb: vi.fn<() => Db>(),
}));

vi.mock('../lib/current-user.ts', () => ({ currentUserId }));
vi.mock('../lib/db.ts', () => ({ getDb }));

import { submitAnswerFeedback } from './actions.ts';

afterEach(() => {
  currentUserId.mockReset();
  getDb.mockReset();
});

/** A Db whose query rejects — the missing-table window and any other db
 * failure look exactly like this to the action. */
function throwingDb(message: string): Db {
  return {
    query: vi.fn().mockRejectedValue(new Error(message)),
    withTransaction: vi.fn().mockRejectedValue(new Error(message)),
  } as unknown as Db;
}

/** A Db that records calls and returns one row (a successful upsert). */
function okDb(): { db: Db; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn().mockResolvedValue({ rows: [{ id: 1 }] });
  return { db: { query, withTransaction: vi.fn() } as unknown as Db, query };
}

describe('submitAnswerFeedback — the real action, fail-soft everywhere', () => {
  it('a throwing db (the pre-migration-017 window) yields { ok: false } and never throws', async () => {
    currentUserId.mockResolvedValue('user-1');
    getDb.mockReturnValue(throwingDb('relation "answer_feedback" does not exist'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(submitAnswerFeedback(1, 'up')).resolves.toEqual({ ok: false });
    } finally {
      spy.mockRestore();
    }
  });

  it('unauthenticated yields { ok: false } — soft, deliberately unlike deleteMyQuestionHistory', async () => {
    currentUserId.mockResolvedValue(null);
    await expect(submitAnswerFeedback(1, 'up')).resolves.toEqual({ ok: false });
    expect(getDb).not.toHaveBeenCalled();
  });

  it('even a THROWING auth seam is caught (the whole body sits in one try/catch)', async () => {
    currentUserId.mockRejectedValue(new Error('auth exploded'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(submitAnswerFeedback(1, 'up')).resolves.toEqual({ ok: false });
    } finally {
      spy.mockRestore();
    }
  });

  it('attacker-controlled input never reaches the db: bad verdict, bad auditId, oversized text', async () => {
    currentUserId.mockResolvedValue('user-1');
    const { db, query } = okDb();
    getDb.mockReturnValue(db);

    // verdict outside {up,down} — types lie at the Server Action boundary.
    await expect(
      submitAnswerFeedback(1, 'meh' as unknown as 'up'),
    ).resolves.toEqual({ ok: false });
    // auditId not a positive safe integer.
    await expect(submitAnswerFeedback(-4, 'up')).resolves.toEqual({ ok: false });
    await expect(submitAnswerFeedback(1.5, 'up')).resolves.toEqual({ ok: false });
    await expect(
      submitAnswerFeedback('7' as unknown as number, 'up'),
    ).resolves.toEqual({ ok: false });
    // feedback text over the cap — rejected, not silently truncated.
    await expect(submitAnswerFeedback(1, 'down', 'x'.repeat(2001))).resolves.toEqual({ ok: false });

    expect(query).not.toHaveBeenCalled();
  });

  it('the happy path writes through the store and reports { ok: true }', async () => {
    currentUserId.mockResolvedValue('user-1');
    const { db, query } = okDb();
    getDb.mockReturnValue(db);
    await expect(submitAnswerFeedback(7, 'down', 'te vaag')).resolves.toEqual({ ok: true });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('insert into answer_feedback');
    expect(params).toEqual([7, 'user-1', 'down', 'te vaag']);
  });
});
