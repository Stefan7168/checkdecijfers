// #23 residual (2026-09-17, session 110): the MISSED-SYNC owner alert.
// Fail-soft by contract, same posture as every sibling alert in alerts.ts:
// no config → log-only; email failure → swallowed; AT MOST ONE email per
// check, batched (never one per table); the daily-alert-fatigue dedupe
// (shouldAlertToday, src/ingestion/stale-sync.ts) is applied inside
// maybeAlertMissedSyncs. Hermetic — fetch is stubbed, no env leaks between
// tests.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  alertMissedSyncs,
  maybeAlertMissedSyncs,
  type MissedSyncEntry,
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

const OVERDUE_A: MissedSyncEntry = {
  tableId: '82235NED',
  lastSuccessfulSyncAt: '2026-06-01T00:00:00.000Z',
  thresholdDays: 420,
  overdueDays: 1,
};

const OVERDUE_B: MissedSyncEntry = {
  tableId: 'eurostat:demo_r_d2jan',
  lastSuccessfulSyncAt: '2026-07-01T00:00:00.000Z',
  thresholdDays: 60,
  overdueDays: 8,
};

afterEach(() => vi.restoreAllMocks());

describe('alertMissedSyncs (#23 residual)', () => {
  it('without RESEND_API_KEY/ADMIN_ALERT_EMAIL: sends nothing', async () => {
    const restore = envPatch({ RESEND_API_KEY: undefined, ADMIN_ALERT_EMAIL: undefined });
    const fetchStub = vi.fn();
    try {
      await alertMissedSyncs({ overdue: [OVERDUE_A] }, fetchStub as unknown as typeof fetch);
      expect(fetchStub).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('with config: sends ONE email listing every overdue table, its last sync, threshold and overdue days', async () => {
    const restore = envPatch({ RESEND_API_KEY: 'key-x', ADMIN_ALERT_EMAIL: 'owner@example.com' });
    const fetchStub = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK' }));
    try {
      await alertMissedSyncs({ overdue: [OVERDUE_A, OVERDUE_B] }, fetchStub as unknown as typeof fetch);
      expect(fetchStub).toHaveBeenCalledOnce();
      const [url, init] = fetchStub.mock.calls[0]! as unknown as [string, RequestInit];
      expect(url).toBe('https://api.resend.com/emails');
      const body = JSON.parse(String(init.body));
      expect(body.to).toBe('owner@example.com');
      expect(body.subject).toContain('2 tabellen');
      for (const needle of [
        '82235NED',
        '2026-06-01T00:00:00.000Z',
        '420 dagen',
        '1 dag(en)',
        'eurostat:demo_r_d2jan',
        '2026-07-01T00:00:00.000Z',
        '60 dagen',
        '8 dag(en)',
      ]) {
        expect(body.text).toContain(needle);
      }
    } finally {
      restore();
    }
  });

  it('a single-table alert uses the singular subject line', async () => {
    const restore = envPatch({ RESEND_API_KEY: 'key-x', ADMIN_ALERT_EMAIL: 'owner@example.com' });
    const fetchStub = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK' }));
    try {
      await alertMissedSyncs({ overdue: [OVERDUE_A] }, fetchStub as unknown as typeof fetch);
      const [, init] = fetchStub.mock.calls[0]! as unknown as [string, RequestInit];
      const body = JSON.parse(String(init.body));
      expect(body.subject).toContain('tabel 82235NED');
    } finally {
      restore();
    }
  });

  it('an email failure is swallowed and logged via the maybe-wrapper — never throws to the caller', async () => {
    const restore = envPatch({ RESEND_API_KEY: 'key-x', ADMIN_ALERT_EMAIL: 'owner@example.com' });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub = vi.fn(async () => {
      throw new Error('network down');
    });
    try {
      await expect(
        maybeAlertMissedSyncs({ overdue: [OVERDUE_A] }, fetchStub as unknown as typeof fetch),
      ).resolves.toBeUndefined();
      expect(String(consoleError.mock.calls.at(-1))).toContain('alert e-mail failed');
    } finally {
      restore();
    }
  });
});

describe('maybeAlertMissedSyncs gating (#23 residual)', () => {
  it('an empty overdue list sends nothing and logs nothing', async () => {
    const restore = envPatch({ RESEND_API_KEY: 'key-x', ADMIN_ALERT_EMAIL: 'owner@example.com' });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub = vi.fn();
    try {
      await maybeAlertMissedSyncs({ overdue: [] }, fetchStub as unknown as typeof fetch);
      expect(fetchStub).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('two due tables in one check produce exactly ONE email, not two', async () => {
    const restore = envPatch({ RESEND_API_KEY: 'key-x', ADMIN_ALERT_EMAIL: 'owner@example.com' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK' }));
    try {
      await maybeAlertMissedSyncs({ overdue: [OVERDUE_A, OVERDUE_B] }, fetchStub as unknown as typeof fetch);
      expect(fetchStub).toHaveBeenCalledOnce();
    } finally {
      restore();
    }
  });

  it('a table mid-cooldown (overdueDays not a dedupe day) is silently dropped, even with config set', async () => {
    const restore = envPatch({ RESEND_API_KEY: 'key-x', ADMIN_ALERT_EMAIL: 'owner@example.com' });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub = vi.fn();
    const midCooldown: MissedSyncEntry = { ...OVERDUE_A, overdueDays: 3 };
    try {
      await maybeAlertMissedSyncs({ overdue: [midCooldown] }, fetchStub as unknown as typeof fetch);
      expect(fetchStub).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('mixed batch: only the due table is sent, the mid-cooldown one is filtered out first', async () => {
    const restore = envPatch({ RESEND_API_KEY: 'key-x', ADMIN_ALERT_EMAIL: 'owner@example.com' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK' }));
    const midCooldown: MissedSyncEntry = { ...OVERDUE_A, tableId: 'mid-cooldown', overdueDays: 4 };
    try {
      await maybeAlertMissedSyncs({ overdue: [midCooldown, OVERDUE_B] }, fetchStub as unknown as typeof fetch);
      expect(fetchStub).toHaveBeenCalledOnce();
      const [, init] = fetchStub.mock.calls[0]! as unknown as [string, RequestInit];
      const body = JSON.parse(String(init.body));
      expect(body.text).toContain(OVERDUE_B.tableId);
      expect(body.text).not.toContain('mid-cooldown');
    } finally {
      restore();
    }
  });
});
