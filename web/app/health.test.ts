// #114: the auth-free synthetic health route. The read functions are stubbed
// at their modules (the actions.test.ts convention) — what is under test is
// the ROUTE's contract: which checks run under which flags (the page.tsx
// mirror), the response shapes, that failure names only OUR check name (never
// error text — raw messages could describe schema/SQL to anonymous callers),
// and that the reads only ever see the synthetic nil-uuid user.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../backend/db/types.ts';

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn<() => Db>() }));
vi.mock('../lib/db.ts', () => ({ getDb }));

const billing = vi.hoisted(() => ({
  getBalance: vi.fn(),
  getQuestionHistory: vi.fn(),
  getActionClassPrice: vi.fn(),
  getSignupGrantCredits: vi.fn(),
}));
vi.mock('../backend/billing/index.ts', () => billing);

const threads = vi.hoisted(() => ({ listThreads: vi.fn() }));
vi.mock('../backend/threads/index.ts', () => threads);

const errorReport = vi.hoisted(() => ({ reportError: vi.fn<() => Promise<void>>() }));
vi.mock('../lib/error-report.ts', () => errorReport);

import { dynamic, GET, runtime } from './api/health/route.ts';

const fakeDb = {} as Db;
const NIL = '00000000-0000-0000-0000-000000000000';

beforeEach(() => {
  getDb.mockReturnValue(fakeDb);
  billing.getBalance.mockResolvedValue(0);
  billing.getQuestionHistory.mockResolvedValue([]);
  billing.getActionClassPrice.mockResolvedValue(20);
  billing.getSignupGrantCredits.mockResolvedValue(100);
  threads.listThreads.mockResolvedValue([]);
  errorReport.reportError.mockResolvedValue(undefined);
  vi.stubEnv('ONBOARDING_ENABLED', '');
  vi.stubEnv('WEBSEARCH_ENABLED', '');
  vi.stubEnv('WORKSPACE_ENABLED', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('#114 /api/health — wiring pins', () => {
  it('is force-dynamic on the node runtime: a build-time-cached 200 would be a health check that cannot fail', () => {
    expect(dynamic).toBe('force-dynamic');
    expect(runtime).toBe('nodejs');
  });
});

describe('#114 /api/health — the dashboard-read probes', () => {
  it('200 with the base checks when every read succeeds, and never a real user id', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; checks: string[] };
    expect(body.ok).toBe(true);
    expect(body.checks).toEqual([
      'balance-read',
      'question-history-read',
      'pricing-read-simple',
      'pricing-read-clarification',
      'signup-grant-read',
    ]);
    // The synthetic id, never a session's: this route holds no auth at all.
    expect(billing.getBalance).toHaveBeenCalledWith(fakeDb, NIL);
    expect(billing.getQuestionHistory).toHaveBeenCalledWith(fakeDb, NIL, {
      includeOnboarding: false,
    });
    // A cached health response is a lying one.
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('mirrors page.tsx flag gating: onboarding flag reaches the history read, websearch/workspace add their probes', async () => {
    vi.stubEnv('ONBOARDING_ENABLED', '1');
    vi.stubEnv('WEBSEARCH_ENABLED', '1');
    vi.stubEnv('WORKSPACE_ENABLED', '1');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { checks: string[] };
    expect(body.checks).toContain('pricing-read-web-addon');
    expect(body.checks).toContain('threads-read');
    // THE session-27 query shape: with the flag on, the history read joins
    // pending_table_requests exactly as the live dashboard does.
    expect(billing.getQuestionHistory).toHaveBeenCalledWith(fakeDb, NIL, {
      includeOnboarding: true,
    });
    expect(threads.listThreads).toHaveBeenCalledWith(fakeDb, NIL);
  });

  it('while a feature is dormant its probe NEVER runs (the migration-before-flag deploy order)', async () => {
    await GET();
    expect(threads.listThreads).not.toHaveBeenCalled();
    expect(billing.getActionClassPrice).not.toHaveBeenCalledWith(fakeDb, 'web_addon');
  });

  it('a failing read → 503 naming ONLY the check — no error text in the body — and a durable #65 copy', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      billing.getQuestionHistory.mockRejectedValue(
        new Error('relation "pending_table_requests" does not exist'),
      );
      const res = await GET();
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ ok: false, failed: 'question-history-read' });
      // The leak pin: raw error text (schema/SQL detail) must never reach an
      // anonymous caller — it goes to the logs and error_log instead.
      expect(text).not.toContain('pending_table_requests');
      expect(text).not.toContain('relation');
      expect(errorReport.reportError).toHaveBeenCalledWith(
        'health',
        expect.any(Error),
        expect.objectContaining({ extra: { check: 'question-history-read' } }),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('checks run in order and stop at the FIRST failure (the named check is the broken one)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      billing.getBalance.mockRejectedValue(new Error('no db at all'));
      const res = await GET();
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, failed: 'balance-read' });
      // Nothing after the failure ran — one broken dependency, one clear name.
      expect(billing.getQuestionHistory).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
