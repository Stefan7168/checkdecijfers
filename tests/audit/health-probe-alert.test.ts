// #23 (2026-09-17, session 110): the proactive HEALTH-PROBE owner alert —
// the daily onboarding cron re-runs /api/health's own checks (#114) after its
// main job and alerts once when any fail. Fail-soft by contract, same posture
// as every sibling alert in alerts.ts: no config → log-only; email failure →
// swallowed; at most one email per run; no-op on a fully clean (empty
// `failed`) result. Hermetic — fetch is stubbed, no env leaks between tests.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  alertHealthProbeFailure,
  maybeAlertHealthProbeFailure,
  type HealthProbeFailureAlert,
} from '../../src/answer/audit/alerts.ts';

function envPatch(values: Record<string, string | undefined>): () => void {
  const saved = new Map(Object.keys(values).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

const ONE_FAILED: HealthProbeFailureAlert = { failed: ['question-history-read'] };

afterEach(() => vi.restoreAllMocks());

describe('alertHealthProbeFailure (#23)', () => {
  it('without RESEND_API_KEY/ADMIN_ALERT_EMAIL: sends nothing', async () => {
    const restore = envPatch({ RESEND_API_KEY: undefined, ADMIN_ALERT_EMAIL: undefined });
    const fetchStub = vi.fn();
    try {
      await alertHealthProbeFailure(ONE_FAILED, fetchStub as unknown as typeof fetch);
      expect(fetchStub).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('with config: sends ONE email naming the failed check, never error text', async () => {
    const restore = envPatch({ RESEND_API_KEY: 'key-x', ADMIN_ALERT_EMAIL: 'owner@example.com' });
    const fetchStub = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK' }));
    try {
      await alertHealthProbeFailure(ONE_FAILED, fetchStub as unknown as typeof fetch);
      expect(fetchStub).toHaveBeenCalledOnce();
      const [url, init] = fetchStub.mock.calls[0]! as unknown as [string, RequestInit];
      expect(url).toBe('https://api.resend.com/emails');
      const body = JSON.parse(String(init.body));
      expect(body.to).toBe('owner@example.com');
      expect(body.subject).toContain('question-history-read');
      expect(body.text).toContain('question-history-read');
    } finally {
      restore();
    }
  });

  it('multiple failed checks use the plural subject and list every name', async () => {
    const restore = envPatch({ RESEND_API_KEY: 'key-x', ADMIN_ALERT_EMAIL: 'owner@example.com' });
    const fetchStub = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK' }));
    try {
      await alertHealthProbeFailure(
        { failed: ['balance-read', 'pro-subscription-read'] },
        fetchStub as unknown as typeof fetch,
      );
      const [, init] = fetchStub.mock.calls[0]! as unknown as [string, RequestInit];
      const body = JSON.parse(String(init.body));
      expect(body.subject).toContain('2 punten');
      expect(body.text).toContain('balance-read');
      expect(body.text).toContain('pro-subscription-read');
    } finally {
      restore();
    }
  });

  it('an email failure is swallowed and logged via the maybe-wrapper — never affects the caller', async () => {
    const restore = envPatch({ RESEND_API_KEY: 'key-x', ADMIN_ALERT_EMAIL: 'owner@example.com' });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub = vi.fn(async () => {
      throw new Error('network down');
    });
    try {
      await expect(
        maybeAlertHealthProbeFailure(ONE_FAILED, fetchStub as unknown as typeof fetch),
      ).resolves.toBeUndefined();
      expect(String(consoleError.mock.calls.at(-1))).toContain('alert e-mail failed');
    } finally {
      restore();
    }
  });
});

describe('maybeAlertHealthProbeFailure gating (#23)', () => {
  it('a fully clean probe (empty failed list) sends nothing and logs nothing', async () => {
    const restore = envPatch({ RESEND_API_KEY: 'key-x', ADMIN_ALERT_EMAIL: 'owner@example.com' });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub = vi.fn();
    try {
      await maybeAlertHealthProbeFailure({ failed: [] }, fetchStub as unknown as typeof fetch);
      expect(fetchStub).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('a failing probe produces exactly ONE email', async () => {
    const restore = envPatch({ RESEND_API_KEY: 'key-x', ADMIN_ALERT_EMAIL: 'owner@example.com' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK' }));
    try {
      await maybeAlertHealthProbeFailure(ONE_FAILED, fetchStub as unknown as typeof fetch);
      expect(fetchStub).toHaveBeenCalledOnce();
    } finally {
      restore();
    }
  });
});
