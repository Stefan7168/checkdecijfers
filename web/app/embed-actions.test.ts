import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../backend/db/types.ts';
import type { AuditRecord } from '../backend/answer/audit/types.ts';

const { currentUserId, currentUserEmail } = vi.hoisted(() => ({
  currentUserId: vi.fn<() => Promise<string | null>>(),
  currentUserEmail: vi.fn<() => Promise<string | null>>(),
}));
vi.mock('../lib/current-user.ts', () => ({ currentUserId, currentUserEmail }));

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn<() => Db>() }));
vi.mock('../lib/db.ts', () => ({ getDb }));

const { loadAuditRecord } = vi.hoisted(() => ({ loadAuditRecord: vi.fn() }));
vi.mock('../backend/answer/audit/index.ts', () => ({ loadAuditRecord }));

const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock('../lib/error-report.ts', () => ({ reportError }));

import { createEmbedCode } from './embed-actions.ts';

// `response` is typed loosely here (not `ComposedResponse`, whose
// discriminated-union members each require a dozen+ fields) because every
// fixture below deliberately supplies only the handful of keys
// createEmbedCode's guard actually reads (kind, chart, redacted) — the
// whole record is cast `as unknown as AuditRecord` below regardless, so
// tightening this to ComposedResponse would only fight the fixtures, not
// catch a real bug.
function baseRecord(overrides: Partial<Omit<AuditRecord, 'response'>> & { response?: Record<string, unknown> } = {}): AuditRecord {
  return {
    id: 42,
    userId: 'user-1',
    kind: 'answer',
    response: { kind: 'answer', chart: { attribution: { tableId: '83693NED' } } },
    ...overrides,
  } as unknown as AuditRecord;
}

beforeEach(() => {
  process.env.EMBED_TOKEN_SECRET = 'a-test-secret-value-that-is-long-enough';
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.EMBED_TOKEN_SECRET;
  delete process.env.PRO_ACCOUNT_EMAILS;
});

describe('createEmbedCode', () => {
  it('refuses an unauthenticated caller', async () => {
    currentUserId.mockResolvedValue(null);
    expect(await createEmbedCode(42)).toEqual({ ok: false, reason: 'unauthenticated' });
    expect(loadAuditRecord).not.toHaveBeenCalled();
  });

  it('is unavailable when EMBED_TOKEN_SECRET is unset', async () => {
    delete process.env.EMBED_TOKEN_SECRET;
    currentUserId.mockResolvedValue('user-1');
    expect(await createEmbedCode(42)).toEqual({ ok: false, reason: 'unavailable' });
    expect(loadAuditRecord).not.toHaveBeenCalled();
  });

  it('returns not_found when the audit row does not exist', async () => {
    currentUserId.mockResolvedValue('user-1');
    loadAuditRecord.mockResolvedValue(null);
    expect(await createEmbedCode(999)).toEqual({ ok: false, reason: 'not_found' });
  });

  it("refuses another user's audit row (ownership check)", async () => {
    currentUserId.mockResolvedValue('user-1');
    loadAuditRecord.mockResolvedValue(baseRecord({ userId: 'someone-else' }));
    expect(await createEmbedCode(42)).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('refuses a refusal/clarification row (no chart)', async () => {
    currentUserId.mockResolvedValue('user-1');
    loadAuditRecord.mockResolvedValue(baseRecord({ kind: 'refusal', response: { kind: 'refusal' } }));
    expect(await createEmbedCode(42)).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('refuses an answer row with no chart', async () => {
    currentUserId.mockResolvedValue('user-1');
    loadAuditRecord.mockResolvedValue(baseRecord({ response: { kind: 'answer', chart: null } }));
    expect(await createEmbedCode(42)).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('refuses a redacted row (retention sentinel on the response envelope)', async () => {
    currentUserId.mockResolvedValue('user-1');
    loadAuditRecord.mockResolvedValue(
      baseRecord({ response: { kind: 'answer', chart: { ok: true }, redacted: true } }),
    );
    expect(await createEmbedCode(42)).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('mints a token and reports pro:false when the caller is not Pro', async () => {
    currentUserId.mockResolvedValue('user-1');
    currentUserEmail.mockResolvedValue('user1@example.com');
    loadAuditRecord.mockResolvedValue(baseRecord());
    const result = await createEmbedCode(42);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.token).toMatch(/^42\./);
      expect(result.pro).toBe(false);
    }
  });

  it('reports pro:true when the caller is on the Pro allowlist', async () => {
    process.env.PRO_ACCOUNT_EMAILS = 'user1@example.com';
    currentUserId.mockResolvedValue('user-1');
    currentUserEmail.mockResolvedValue('user1@example.com');
    loadAuditRecord.mockResolvedValue(baseRecord());
    const result = await createEmbedCode(42);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pro).toBe(true);
  });

  it('returns a typed error and reports it on an unexpected throw, never throwing itself', async () => {
    currentUserId.mockResolvedValue('user-1');
    loadAuditRecord.mockRejectedValue(new Error('db exploded'));
    const result = await createEmbedCode(42);
    expect(result).toEqual({ ok: false, reason: 'error' });
    expect(reportError).toHaveBeenCalledWith('createEmbedCode', expect.any(Error), expect.objectContaining({ userId: 'user-1' }));
  });
});
