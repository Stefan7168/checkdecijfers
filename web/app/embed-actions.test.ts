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

// Task 7 (#205): hasProPlan is no longer mocked here (it never was — this
// file always exercised the real src/billing/pro.ts) but it now DOES touch
// the db once the email allowlist misses, so getDb() must return something
// query()-able rather than the bare `undefined` a plain `vi.fn<() => Db>()`
// yields with no return value configured — a real `pro_subscriptions` table
// isn't stood up in this hermetic unit test, so an empty result set (no
// subscription row) is the correct stand-in for "not Pro via the DB".
function noSubscriptionDb(): Db {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    withTransaction: vi.fn(),
  } as unknown as Db;
}

const { loadAuditRecord } = vi.hoisted(() => ({ loadAuditRecord: vi.fn() }));
vi.mock('../backend/answer/audit/index.ts', () => ({ loadAuditRecord }));

const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock('../lib/error-report.ts', () => ({ reportError }));

// Task 11 (#205): startProSubscriptionCheckout's own dependencies.
// next/headers has no request context in jsdom/vitest — same fix as
// web/app/credits/actions.test.ts uses for the sibling one-time-pack action.
vi.mock('next/headers', () => ({ headers: vi.fn(async () => ({ get: () => null })) }));

// buildProSubscriptionCheckoutParams (src/billing/stripe-checkout.ts, via the
// web/backend -> ../src symlink) is a pure builder with its own hermetic
// tests — run for real here rather than mocked, same call as this file
// already makes for hasProPlan above (only I/O boundaries get mocked).
const { checkoutSessionsCreate } = vi.hoisted(() => ({ checkoutSessionsCreate: vi.fn() }));
vi.mock('stripe', () => ({
  // `new Stripe(secretKey)` requires a real constructor — an arrow-function
  // mock implementation is not a valid `new` target (jsdom/vitest throws
  // "is not a constructor").
  default: vi.fn().mockImplementation(function StripeMock(this: unknown, key: string) {
    Object.assign(this as object, { __secretKey: key, checkout: { sessions: { create: checkoutSessionsCreate } } });
  }),
}));

import { createEmbedCode, startProSubscriptionCheckout } from './embed-actions.ts';

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
  delete process.env.PRO_SUBSCRIPTIONS_ENABLED;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_PRO_PRICE_ID;
  delete process.env.NEXT_PUBLIC_APP_URL;
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
    getDb.mockReturnValue(noSubscriptionDb());
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
    getDb.mockReturnValue(noSubscriptionDb());
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

// Task 11 (#205): the flag must fail closed — unset or anything other than
// exactly '1' returns { ok: false, reason: 'disabled' }, never a crash and
// never a Stripe call, BEFORE currentUserId() or Stripe are ever touched.
describe('startProSubscriptionCheckout', () => {
  it('returns disabled when PRO_SUBSCRIPTIONS_ENABLED is not set', async () => {
    const original = process.env.PRO_SUBSCRIPTIONS_ENABLED;
    delete process.env.PRO_SUBSCRIPTIONS_ENABLED;
    try {
      const result = await startProSubscriptionCheckout();
      expect(result).toEqual({ ok: false, reason: 'disabled' });
    } finally {
      if (original !== undefined) process.env.PRO_SUBSCRIPTIONS_ENABLED = original;
    }
    expect(currentUserId).not.toHaveBeenCalled();
    expect(checkoutSessionsCreate).not.toHaveBeenCalled();
  });

  it('returns disabled for any value other than the exact string \'1\' (fail closed, never a truthy-string bypass)', async () => {
    process.env.PRO_SUBSCRIPTIONS_ENABLED = 'true';
    const result = await startProSubscriptionCheckout();
    expect(result).toEqual({ ok: false, reason: 'disabled' });
    expect(currentUserId).not.toHaveBeenCalled();
  });

  it('returns not_signed_in when the flag is on but nobody is logged in', async () => {
    process.env.PRO_SUBSCRIPTIONS_ENABLED = '1';
    currentUserId.mockResolvedValue(null);
    const result = await startProSubscriptionCheckout();
    expect(result).toEqual({ ok: false, reason: 'not_signed_in' });
    expect(checkoutSessionsCreate).not.toHaveBeenCalled();
  });

  it('throws (deploy misconfiguration, never a silent user-facing failure) when STRIPE_SECRET_KEY is missing', async () => {
    process.env.PRO_SUBSCRIPTIONS_ENABLED = '1';
    process.env.STRIPE_PRO_PRICE_ID = 'price_123';
    currentUserId.mockResolvedValue('user-1');
    await expect(startProSubscriptionCheckout()).rejects.toThrow(/STRIPE_SECRET_KEY/);
    expect(checkoutSessionsCreate).not.toHaveBeenCalled();
  });

  it('throws when STRIPE_PRO_PRICE_ID is missing', async () => {
    process.env.PRO_SUBSCRIPTIONS_ENABLED = '1';
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    currentUserId.mockResolvedValue('user-1');
    await expect(startProSubscriptionCheckout()).rejects.toThrow(/STRIPE_PRO_PRICE_ID/);
    expect(checkoutSessionsCreate).not.toHaveBeenCalled();
  });

  it('creates a real subscription Checkout session and returns its URL when fully configured', async () => {
    process.env.PRO_SUBSCRIPTIONS_ENABLED = '1';
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_PRO_PRICE_ID = 'price_123';
    process.env.NEXT_PUBLIC_APP_URL = 'https://checkdecijfers.vercel.app';
    currentUserId.mockResolvedValue('user-1');
    checkoutSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/session-xyz' });

    const result = await startProSubscriptionCheckout();

    expect(result).toEqual({ ok: true, url: 'https://checkout.stripe.com/session-xyz' });
    expect(checkoutSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        line_items: [{ price: 'price_123', quantity: 1 }],
        success_url: 'https://checkdecijfers.vercel.app/credits?pro=success',
        cancel_url: 'https://checkdecijfers.vercel.app/credits?pro=cancelled',
        metadata: { userId: 'user-1' },
        subscription_data: { metadata: { userId: 'user-1' } },
      }),
    );
  });

  // Review fix round: a transient Stripe failure must be caught and
  // returned gracefully, never left to reject uncaught — mirrors
  // createCheckoutSession's (web/app/credits/actions.ts) own try/catch
  // around this exact call, including its `vi.spyOn(console, 'error')`
  // convention for the expected log line.
  it('returns checkout_failed (not a throw) when Stripe does not return a Checkout URL', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.PRO_SUBSCRIPTIONS_ENABLED = '1';
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_PRO_PRICE_ID = 'price_123';
    currentUserId.mockResolvedValue('user-1');
    checkoutSessionsCreate.mockResolvedValue({ url: null });

    const result = await startProSubscriptionCheckout();
    expect(result).toEqual({ ok: false, reason: 'checkout_failed' });
  });

  it('returns checkout_failed (not a throw) when stripe.checkout.sessions.create itself rejects — a transient outage must never abort the caller uncaught', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.PRO_SUBSCRIPTIONS_ENABLED = '1';
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_PRO_PRICE_ID = 'price_123';
    currentUserId.mockResolvedValue('user-1');
    checkoutSessionsCreate.mockRejectedValue(new Error('Stripe API error: rate limited'));

    const result = await startProSubscriptionCheckout();
    expect(result).toEqual({ ok: false, reason: 'checkout_failed' });
    expect(console.error).toHaveBeenCalledWith('startProSubscriptionCheckout failed:', expect.any(Error));
  });
});
