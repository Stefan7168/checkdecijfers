// #355 (session 148): the NEW-CBS-DATA owner alert. Same contract as its siblings in alerts.ts
// (missed-sync-alert.test.ts is the template): no config -> log-only; an e-mail failure is
// swallowed; AT MOST ONE e-mail per check, batched; the day rule (shouldAlertAboutNewData,
// src/ingestion/freshness.ts) is applied inside maybeAlertNewCbsData. Hermetic — fetch is
// stubbed, no env leaks between tests.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { alertNewCbsData, maybeAlertNewCbsData } from '../../src/answer/audit/alerts.ts';
import type { NewCbsDataEntry } from '../../src/ingestion/freshness.ts';

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

const CONFIGURED = { RESEND_API_KEY: 'key-x', ADMIN_ALERT_EMAIL: 'owner@example.com' };

const BREAKING: NewCbsDataEntry = {
  tableId: '84584NED',
  lastSyncAt: '2026-09-29T10:00:00.000Z',
  cbsModifiedAt: '2026-10-02T06:30:00.000Z',
  daysBehind: 3,
  cbsChangedDaysAgo: 0,
};

const REMINDER: NewCbsDataEntry = {
  tableId: '85615NED',
  lastSyncAt: '2026-09-01T10:00:00.000Z',
  cbsModifiedAt: '2026-09-23T06:30:00.000Z',
  daysBehind: 22,
  cbsChangedDaysAgo: 7,
};

const MID_COOLDOWN: NewCbsDataEntry = { ...REMINDER, tableId: '83693NED', cbsChangedDaysAgo: 3 };

afterEach(() => vi.restoreAllMocks());

describe('alertNewCbsData (#355)', () => {
  it('without RESEND_API_KEY/ADMIN_ALERT_EMAIL: sends nothing', async () => {
    const restore = envPatch({ RESEND_API_KEY: undefined, ADMIN_ALERT_EMAIL: undefined });
    const fetchStub = vi.fn();
    try {
      await alertNewCbsData({ behind: [BREAKING] }, fetchStub as unknown as typeof fetch);
      expect(fetchStub).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('with config: ONE e-mail naming every behind table, both dates, and the exact command to run', async () => {
    const restore = envPatch(CONFIGURED);
    const fetchStub = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK' }));
    try {
      await alertNewCbsData({ behind: [BREAKING, REMINDER] }, fetchStub as unknown as typeof fetch);
      expect(fetchStub).toHaveBeenCalledOnce();
      const [url, init] = fetchStub.mock.calls[0]! as unknown as [string, RequestInit];
      expect(url).toBe('https://api.resend.com/emails');
      const body = JSON.parse(String(init.body));
      expect(body.to).toBe('owner@example.com');
      expect(body.subject).toContain('2 tabellen');
      for (const needle of [
        '84584NED',
        '2026-10-02',
        '2026-09-29',
        '85615NED',
        '2026-09-23',
        '7 dag(en) geleden',
        'npm run ingest:freshness',
      ]) {
        expect(body.text).toContain(needle);
      }
    } finally {
      restore();
    }
  });

  it('the e-mail promises nothing was changed and names no sync command that writes by itself', async () => {
    const restore = envPatch(CONFIGURED);
    const fetchStub = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK' }));
    try {
      await alertNewCbsData({ behind: [BREAKING] }, fetchStub as unknown as typeof fetch);
      const [, init] = fetchStub.mock.calls[0]! as unknown as [string, RequestInit];
      const text = String(JSON.parse(String(init.body)).text);
      expect(text).toContain('Er is niets aan de data of de site veranderd');
      expect(text).not.toContain('--accept-new-codes');
    } finally {
      restore();
    }
  });

  it('a single-table alert uses the singular subject line', async () => {
    const restore = envPatch(CONFIGURED);
    const fetchStub = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK' }));
    try {
      await alertNewCbsData({ behind: [BREAKING] }, fetchStub as unknown as typeof fetch);
      const [, init] = fetchStub.mock.calls[0]! as unknown as [string, RequestInit];
      expect(JSON.parse(String(init.body)).subject).toContain('tabel 84584NED');
    } finally {
      restore();
    }
  });
});

describe('maybeAlertNewCbsData gating (#355)', () => {
  it('nothing behind: sends nothing and logs nothing', async () => {
    const restore = envPatch(CONFIGURED);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub = vi.fn();
    try {
      await maybeAlertNewCbsData({ behind: [] }, fetchStub as unknown as typeof fetch);
      expect(fetchStub).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('every table mid-reminder-cooldown: silent, even with config set', async () => {
    const restore = envPatch(CONFIGURED);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub = vi.fn();
    try {
      await maybeAlertNewCbsData({ behind: [MID_COOLDOWN] }, fetchStub as unknown as typeof fetch);
      expect(fetchStub).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('one due table pulls the whole behind list into ONE e-mail (the mid-cooldown table is named too)', async () => {
    const restore = envPatch(CONFIGURED);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK' }));
    try {
      await maybeAlertNewCbsData({ behind: [MID_COOLDOWN, BREAKING] }, fetchStub as unknown as typeof fetch);
      expect(fetchStub).toHaveBeenCalledOnce();
      const [, init] = fetchStub.mock.calls[0]! as unknown as [string, RequestInit];
      const text = String(JSON.parse(String(init.body)).text);
      expect(text).toContain(BREAKING.tableId);
      expect(text).toContain(MID_COOLDOWN.tableId);
    } finally {
      restore();
    }
  });

  it('with no config the console line is the floor: a due day still logs each behind table', async () => {
    const restore = envPatch({ RESEND_API_KEY: undefined, ADMIN_ALERT_EMAIL: undefined });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub = vi.fn();
    try {
      await maybeAlertNewCbsData({ behind: [BREAKING] }, fetchStub as unknown as typeof fetch);
      expect(fetchStub).not.toHaveBeenCalled();
      expect(String(consoleError.mock.calls[0])).toContain('[new-cbs-data] 84584NED');
    } finally {
      restore();
    }
  });

  it('an e-mail failure is swallowed and logged — never throws to the caller', async () => {
    const restore = envPatch(CONFIGURED);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub = vi.fn(async () => {
      throw new Error('network down');
    });
    try {
      await expect(
        maybeAlertNewCbsData({ behind: [BREAKING] }, fetchStub as unknown as typeof fetch),
      ).resolves.toBeUndefined();
      expect(String(consoleError.mock.calls.at(-1))).toContain('alert e-mail failed');
    } finally {
      restore();
    }
  });
});
