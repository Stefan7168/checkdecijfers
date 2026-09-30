// ADR 065 step 8: the owner alert for a pinned table the warm job could not refresh. Same contract
// as its siblings in alerts.ts (new-cbs-data-alert.test.ts is the template): no config -> log-only;
// an e-mail failure is swallowed; AT MOST ONE e-mail per check, batched; the day rule is applied
// inside maybeAlertWarmFailures. Hermetic: fetch is stubbed and the database is a two-line stub.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import type { WarmTableResult } from '../../src/ingestion/warm-job.ts';
import {
  alertWarmFailures,
  loadWarmFailureEntries,
  maybeAlertWarmFailures,
  shouldAlertAboutWarmFailure,
  type WarmFailureEntry,
} from '../../src/answer/audit/warm-alert.ts';

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
const NOW = new Date('2026-10-05T06:10:00.000Z');

/** A stub Db that answers the one lookup loadWarmFailureEntries makes. */
function dbWith(rows: Array<{ id: string; last_sync_at: string | null; created_at: string | null }>): Db {
  return {
    query: async (_text: string, params?: unknown[]) => {
      const wanted = new Set((params?.[0] as string[]) ?? []);
      return { rows: rows.filter((r) => wanted.has(r.id)) };
    },
    withTransaction: async () => {
      throw new Error('not used');
    },
  };
}

const failed = (tableId: string, over: Partial<WarmTableResult> = {}): WarmTableResult => ({
  tableId,
  outcome: 'failed',
  planned: 4,
  fetched: 1,
  confirmed: 0,
  remaining: 3,
  failure: { stage: 'fetch', summary: 'CBS did not answer within 45 seconds', quarantined: false },
  ...over,
});

const complete = (tableId: string): WarmTableResult => ({
  tableId,
  outcome: 'complete',
  planned: 4,
  fetched: 4,
  confirmed: 0,
  remaining: 0,
});
const partial = (tableId: string): WarmTableResult => ({
  tableId,
  outcome: 'partial',
  planned: 4,
  fetched: 1,
  confirmed: 0,
  remaining: 3,
});
const skipped = (tableId: string): WarmTableResult => ({
  tableId,
  outcome: 'skipped',
  planned: 0,
  fetched: 0,
  confirmed: 0,
  remaining: 0,
  skippedReason: 'deadline',
});

const entry = (over: Partial<WarmFailureEntry> = {}): WarmFailureEntry => ({
  tableId: '85770NED',
  stage: 'fetch',
  summary: 'CBS did not answer within 45 seconds',
  quarantined: false,
  daysSinceLastComplete: 1,
  ...over,
});

afterEach(() => vi.restoreAllMocks());

describe('shouldAlertAboutWarmFailure: the day rule (stateless, like the new-data alert)', () => {
  it('a plain failure is mailed the day after the last complete run, then every 7th day', () => {
    const due = (days: number | null) => shouldAlertAboutWarmFailure(entry({ daysSinceLastComplete: days }), true);
    expect(due(0)).toBe(false); // the same day as a success: today's run may be a blip
    expect(due(1)).toBe(true);
    for (const d of [2, 3, 4, 5, 6, 7]) expect(due(d)).toBe(false);
    expect(due(8)).toBe(true);
    expect(due(9)).toBe(false);
    expect(due(15)).toBe(true);
  });

  it('a plain failure is mailed only from the first (daily) run of the chain — a chained run of the same day stays quiet', () => {
    expect(shouldAlertAboutWarmFailure(entry({ daysSinceLastComplete: 1 }), false)).toBe(false);
    expect(shouldAlertAboutWarmFailure(entry({ daysSinceLastComplete: 8 }), false)).toBe(false);
  });

  it('a quarantined table is always mailed, from any run: it leaves the job afterwards, so this is the only sighting', () => {
    for (const days of [0, 3, 40, null]) {
      const q = entry({ quarantined: true, daysSinceLastComplete: days });
      expect(shouldAlertAboutWarmFailure(q, true)).toBe(true);
      expect(shouldAlertAboutWarmFailure(q, false)).toBe(true);
    }
  });

  it('an unknown clock is mailed on the daily run rather than guessed away', () => {
    expect(shouldAlertAboutWarmFailure(entry({ daysSinceLastComplete: null }), true)).toBe(true);
    expect(shouldAlertAboutWarmFailure(entry({ daysSinceLastComplete: null }), false)).toBe(false);
  });
});

describe('loadWarmFailureEntries', () => {
  it('keeps only failed tables — complete, partial and skipped never become an entry', async () => {
    const db = dbWith([
      { id: 'A', last_sync_at: '2026-10-04T06:05:00.000Z', created_at: '2026-09-01T00:00:00.000Z' },
      { id: 'B', last_sync_at: '2026-10-04T06:05:00.000Z', created_at: '2026-09-01T00:00:00.000Z' },
    ]);
    const entries = await loadWarmFailureEntries(db, [complete('A'), partial('B'), skipped('C'), failed('D')], NOW);
    expect(entries.map((e) => e.tableId)).toEqual(['D']);
  });

  it('counts calendar days (UTC) since the last complete run, so a run at 06:05 yesterday is 1 day at 06:00 today', async () => {
    const db = dbWith([
      { id: 'A', last_sync_at: '2026-10-04T06:05:00.000Z', created_at: '2026-09-01T00:00:00.000Z' },
      { id: 'B', last_sync_at: '2026-09-27T23:59:00.000Z', created_at: '2026-09-01T00:00:00.000Z' },
    ]);
    const entries = await loadWarmFailureEntries(db, [failed('A'), failed('B')], NOW);
    expect(entries.find((e) => e.tableId === 'A')!.daysSinceLastComplete).toBe(1);
    expect(entries.find((e) => e.tableId === 'B')!.daysSinceLastComplete).toBe(8);
  });

  it('a table that never completed a run is counted from its registration', async () => {
    const db = dbWith([{ id: 'A', last_sync_at: null, created_at: '2026-10-02T12:00:00.000Z' }]);
    const [e] = await loadWarmFailureEntries(db, [failed('A')], NOW);
    expect(e!.daysSinceLastComplete).toBe(3);
  });

  it('carries the stage, the summary and the quarantine flag, and nothing else from the result', async () => {
    const db = dbWith([{ id: 'A', last_sync_at: '2026-10-04T06:05:00.000Z', created_at: '2026-09-01T00:00:00.000Z' }]);
    const withRows = {
      ...failed('A', { failure: { stage: 'validate', summary: 'x'.repeat(900), quarantined: true } }),
      rows: [{ Value: 1234 }],
    } as WarmTableResult;
    const [e] = await loadWarmFailureEntries(db, [withRows], NOW);
    expect(Object.keys(e!).sort()).toEqual(['daysSinceLastComplete', 'quarantined', 'stage', 'summary', 'tableId']);
    expect(e!.quarantined).toBe(true);
    expect(e!.summary.length).toBeLessThanOrEqual(300);
  });

  it('nothing failed: no database read at all', async () => {
    const query = vi.fn();
    const db = { query, withTransaction: vi.fn() } as unknown as Db;
    expect(await loadWarmFailureEntries(db, [complete('A'), partial('B')], NOW)).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('alertWarmFailures', () => {
  it('without RESEND_API_KEY/ADMIN_ALERT_EMAIL: sends nothing', async () => {
    const restore = envPatch({ RESEND_API_KEY: undefined, ADMIN_ALERT_EMAIL: undefined });
    const fetchStub = vi.fn();
    try {
      await alertWarmFailures({ failures: [entry()] }, fetchStub as unknown as typeof fetch);
      expect(fetchStub).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('a plain failure: names the table, the stage and the summary, and says the next daily run retries', async () => {
    const restore = envPatch(CONFIGURED);
    const fetchStub = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK' }));
    try {
      await alertWarmFailures({ failures: [entry()] }, fetchStub as unknown as typeof fetch);
      const [url, init] = fetchStub.mock.calls[0]! as unknown as [string, RequestInit];
      expect(url).toBe('https://api.resend.com/emails');
      const body = JSON.parse(String(init.body));
      expect(body.to).toBe('owner@example.com');
      expect(body.subject).toContain('85770NED');
      for (const needle of ['85770NED', 'fetch', 'CBS did not answer within 45 seconds', 'next daily run']) {
        expect(body.text).toContain(needle);
      }
      expect(body.text).not.toContain('rebaseline-slices');
    } finally {
      restore();
    }
  });

  it('a quarantined failure: says it refuses to answer and names the exact re-baseline command', async () => {
    const restore = envPatch(CONFIGURED);
    const fetchStub = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK' }));
    try {
      await alertWarmFailures(
        { failures: [entry({ quarantined: true, stage: 'validate', summary: 'unit changed' })] },
        fetchStub as unknown as typeof fetch,
      );
      const [, init] = fetchStub.mock.calls[0]! as unknown as [string, RequestInit];
      const text = String(JSON.parse(String(init.body)).text);
      expect(text).toContain('quarantined');
      expect(text).toContain('refuses to answer');
      expect(text).toContain('npm run ingest -- rebaseline-slices 85770NED --yes');
      expect(text).not.toContain('retries automatically');
    } finally {
      restore();
    }
  });

  it('several tables: ONE e-mail, each with its own advice (the command only for the quarantined one)', async () => {
    const restore = envPatch(CONFIGURED);
    const fetchStub = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK' }));
    try {
      await alertWarmFailures(
        { failures: [entry({ tableId: 'AAA' }), entry({ tableId: 'BBB', quarantined: true })] },
        fetchStub as unknown as typeof fetch,
      );
      expect(fetchStub).toHaveBeenCalledOnce();
      const [, init] = fetchStub.mock.calls[0]! as unknown as [string, RequestInit];
      const body = JSON.parse(String(init.body));
      expect(body.subject).toContain('2 tables');
      expect(body.text).toContain('rebaseline-slices BBB --yes');
      expect(body.text).not.toContain('rebaseline-slices AAA');
    } finally {
      restore();
    }
  });

  it('carries no row-level or personal data: only ids, stage names and the capped failure text', async () => {
    const restore = envPatch(CONFIGURED);
    const fetchStub = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK' }));
    try {
      const smuggled = { ...entry(), rows: [{ Value: 987654321 }], userId: 'user-42' } as WarmFailureEntry;
      await alertWarmFailures({ failures: [smuggled] }, fetchStub as unknown as typeof fetch);
      const [, init] = fetchStub.mock.calls[0]! as unknown as [string, RequestInit];
      const text = String(JSON.parse(String(init.body)).text);
      expect(text).not.toContain('987654321');
      expect(text).not.toContain('user-42');
    } finally {
      restore();
    }
  });
});

describe('maybeAlertWarmFailures: gating and de-duplication', () => {
  const okFetch = () => vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK' }));
  const rowFor = (id: string, lastSync: string | null) => ({
    id,
    last_sync_at: lastSync,
    created_at: '2026-09-01T00:00:00.000Z',
  });

  it('sends on a failed table (day after its last complete run)', async () => {
    const restore = envPatch(CONFIGURED);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub = okFetch();
    try {
      const db = dbWith([rowFor('A', '2026-10-04T06:05:00.000Z')]);
      await maybeAlertWarmFailures({ db, results: [failed('A')], now: NOW, dailyRun: true }, fetchStub as unknown as typeof fetch);
      expect(fetchStub).toHaveBeenCalledOnce();
    } finally {
      restore();
    }
  });

  it('does not send for complete, partial or skipped tables — and does not even read the database', async () => {
    const restore = envPatch(CONFIGURED);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub = okFetch();
    const query = vi.fn();
    try {
      const db = { query, withTransaction: vi.fn() } as unknown as Db;
      await maybeAlertWarmFailures(
        { db, results: [complete('A'), partial('B'), skipped('C')], now: NOW, dailyRun: true },
        fetchStub as unknown as typeof fetch,
      );
      expect(fetchStub).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('de-duplication: the same failure is mailed on day 1, silent on days 2-7, mailed again on day 8', async () => {
    const restore = envPatch(CONFIGURED);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const lastComplete = '2026-10-04T06:05:00.000Z';
      const db = dbWith([rowFor('A', lastComplete)]);
      const sentOn = async (isoNow: string): Promise<boolean> => {
        const fetchStub = okFetch();
        await maybeAlertWarmFailures(
          { db, results: [failed('A')], now: new Date(isoNow), dailyRun: true },
          fetchStub as unknown as typeof fetch,
        );
        return fetchStub.mock.calls.length === 1;
      };
      expect(await sentOn('2026-10-04T06:10:00.000Z')).toBe(false); // day 0: the same day as the success
      expect(await sentOn('2026-10-05T06:10:00.000Z')).toBe(true); // day 1
      expect(await sentOn('2026-10-06T06:10:00.000Z')).toBe(false);
      expect(await sentOn('2026-10-11T06:10:00.000Z')).toBe(false); // day 7
      expect(await sentOn('2026-10-12T06:10:00.000Z')).toBe(true); // day 8: the weekly reminder
      expect(await sentOn('2026-10-13T06:10:00.000Z')).toBe(false);
    } finally {
      restore();
    }
  });

  it('a second run of the same day (a chained run) sends nothing for a plain failure', async () => {
    const restore = envPatch(CONFIGURED);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub = okFetch();
    try {
      const db = dbWith([rowFor('A', '2026-10-04T06:05:00.000Z')]);
      await maybeAlertWarmFailures({ db, results: [failed('A')], now: NOW, dailyRun: false }, fetchStub as unknown as typeof fetch);
      expect(fetchStub).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('a quarantine is mailed even from a chained run', async () => {
    const restore = envPatch(CONFIGURED);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub = okFetch();
    try {
      const db = dbWith([rowFor('A', '2026-10-05T06:01:00.000Z')]);
      const q = failed('A', { failure: { stage: 'validate', summary: 'unit changed', quarantined: true } });
      await maybeAlertWarmFailures({ db, results: [q], now: NOW, dailyRun: false }, fetchStub as unknown as typeof fetch);
      expect(fetchStub).toHaveBeenCalledOnce();
      const [, init] = fetchStub.mock.calls[0]! as unknown as [string, RequestInit];
      expect(String(JSON.parse(String(init.body)).text)).toContain('rebaseline-slices A --yes');
    } finally {
      restore();
    }
  });

  it('only the due tables are named: one mid-cooldown table is left out of the mail', async () => {
    const restore = envPatch(CONFIGURED);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub = okFetch();
    try {
      const db = dbWith([rowFor('DUE', '2026-10-04T06:05:00.000Z'), rowFor('COOLING', '2026-10-01T06:05:00.000Z')]);
      await maybeAlertWarmFailures(
        { db, results: [failed('DUE'), failed('COOLING')], now: NOW, dailyRun: true },
        fetchStub as unknown as typeof fetch,
      );
      const [, init] = fetchStub.mock.calls[0]! as unknown as [string, RequestInit];
      const text = String(JSON.parse(String(init.body)).text);
      expect(text).toContain('DUE');
      expect(text).not.toContain('COOLING');
    } finally {
      restore();
    }
  });

  it('with no config the console line is the floor: a due failure still logs', async () => {
    const restore = envPatch({ RESEND_API_KEY: undefined, ADMIN_ALERT_EMAIL: undefined });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub = okFetch();
    try {
      const db = dbWith([rowFor('A', '2026-10-04T06:05:00.000Z')]);
      await maybeAlertWarmFailures({ db, results: [failed('A')], now: NOW, dailyRun: true }, fetchStub as unknown as typeof fetch);
      expect(fetchStub).not.toHaveBeenCalled();
      expect(String(consoleError.mock.calls[0])).toContain('[warm-failure] A');
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
      const db = dbWith([rowFor('A', '2026-10-04T06:05:00.000Z')]);
      await expect(
        maybeAlertWarmFailures({ db, results: [failed('A')], now: NOW, dailyRun: true }, fetchStub as unknown as typeof fetch),
      ).resolves.toBeUndefined();
      expect(String(consoleError.mock.calls.at(-1))).toContain('alert e-mail failed');
    } finally {
      restore();
    }
  });

  it('a database failure while reading the clock is swallowed and logged too', async () => {
    const restore = envPatch(CONFIGURED);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = {
      query: async () => {
        throw new Error('db down');
      },
      withTransaction: vi.fn(),
    } as unknown as Db;
    try {
      await expect(
        maybeAlertWarmFailures({ db, results: [failed('A')], now: NOW, dailyRun: true }, okFetch() as unknown as typeof fetch),
      ).resolves.toBeUndefined();
      expect(String(consoleError.mock.calls.at(-1))).toContain('could not be prepared');
    } finally {
      restore();
    }
  });
});
