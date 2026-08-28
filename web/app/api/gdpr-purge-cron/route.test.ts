// #189: the retention-purge cron route's own contract. The JOB is pinned in
// tests/audit/retention-job.test.ts; what is pinned HERE is everything the job
// cannot see — the three lines that stand between "an anonymous GET" and
// "this database's question history is redacted and deleted":
//
//   1. fail-closed when CRON_SECRET is unset,
//   2. 401 on a wrong/absent Bearer,
//   3. `GDPR_PURGE_APPLY === '1'` — the ONLY thing separating reporting from
//      deleting, so every other value must read as dry-run.
//
// Module boundaries mocked per web convention.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The partial-failure class must be REAL in the mock: the route does an
// `instanceof` against it, so a mock that omits it makes that line throw. It
// lives inside vi.hoisted() because vi.mock's factory is hoisted above ordinary
// declarations — a plain `class` here is in the TDZ when the factory runs.
const { runRetentionPurge, maybeAlertRetentionPurge, FakePartialError } = vi.hoisted(() => ({
  runRetentionPurge: vi.fn(),
  maybeAlertRetentionPurge: vi.fn(),
  FakePartialError: class extends Error {
    auditRowsRedacted: number;
    leg: 'trial' | 'errorLog';
    constructor(message: string, auditRowsRedacted: number, leg: 'trial' | 'errorLog' = 'trial') {
      super(message);
      this.name = 'RetentionPurgePartialError';
      this.auditRowsRedacted = auditRowsRedacted;
      this.leg = leg;
    }
  },
}));
vi.mock('../../../backend/answer/audit/index.ts', () => ({
  runRetentionPurge,
  maybeAlertRetentionPurge,
  describeRetentionPurge: () => 'summary-line',
  RetentionPurgePartialError: FakePartialError,
}));
vi.mock('../../../backend/billing/index.ts', () => ({
  countPurgeableTrialBookkeeping: vi.fn(),
  purgeExpiredTrialBookkeeping: vi.fn(),
  trialRetentionCutoff: vi.fn(),
}));
vi.mock('../../../lib/db.ts', () => ({ getDb: vi.fn(() => ({ query: vi.fn() })) }));

import { GET } from './route.ts';

const DRY_SUMMARY = {
  mode: 'dry-run' as const,
  auditCutoff: '2024-07-25T00:00:00.000Z',
  auditRows: 0,
  pendingRows: 0,
  trial: { cutoff: '2026-04-26T00:00:00.000Z', rows: 0 },
};

function req(auth?: string): Request {
  return new Request('https://example.test/api/gdpr-purge-cron', {
    headers: auth === undefined ? {} : { authorization: auth },
  });
}

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'sekrit');
  runRetentionPurge.mockResolvedValue(DRY_SUMMARY);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('gdpr-purge-cron route', () => {
  it('fails CLOSED with 503 when CRON_SECRET is unset — and never touches the purge', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const res = await GET(req('Bearer sekrit'));
    expect(res.status).toBe(503);
    expect(runRetentionPurge).not.toHaveBeenCalled();
  });

  it('401s a wrong or absent Bearer, before any purge work', async () => {
    for (const auth of [undefined, '', 'Bearer wrong', 'sekrit', 'Basic sekrit']) {
      const res = await GET(req(auth));
      expect(res.status, `auth=${String(auth)}`).toBe(401);
    }
    expect(runRetentionPurge).not.toHaveBeenCalled();
  });

  // The safety-critical one. Anything other than the exact string '1' must
  // report, never apply — a cron that deletes on its first unattended run is
  // the thing this dormancy exists to prevent.
  it('is DRY-RUN for every GDPR_PURGE_APPLY value except exactly "1"', async () => {
    for (const value of [undefined, '', '0', 'true', 'yes', 'TRUE', '1 ', '11']) {
      vi.clearAllMocks();
      runRetentionPurge.mockResolvedValue(DRY_SUMMARY);
      if (value === undefined) vi.stubEnv('GDPR_PURGE_APPLY', '');
      else vi.stubEnv('GDPR_PURGE_APPLY', value);
      const res = await GET(req('Bearer sekrit'));
      expect(res.status).toBe(200);
      expect(runRetentionPurge.mock.calls[0]![0].apply, `value=${String(value)}`).toBe(false);
    }
  });

  it('applies ONLY on exactly "1"', async () => {
    vi.stubEnv('GDPR_PURGE_APPLY', '1');
    runRetentionPurge.mockResolvedValue({ ...DRY_SUMMARY, mode: 'applied', pendingRows: null });
    const res = await GET(req('Bearer sekrit'));
    expect(res.status).toBe(200);
    expect(runRetentionPurge.mock.calls[0]![0].apply).toBe(true);
  });

  it('alerts and 500s when the purge throws — silence is the bug this route fixes', async () => {
    runRetentionPurge.mockRejectedValue(new Error('lock timeout'));
    const res = await GET(req('Bearer sekrit'));
    expect(res.status).toBe(500);
    expect(maybeAlertRetentionPurge).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'failed', detail: expect.stringContaining('lock timeout') }),
    );
  });

  // A PARTIAL failure redacted rows before it broke. Reporting only "it failed"
  // would tell the owner nothing expired when the 2-year leg actually ran.
  it('says what COMMITTED when the trial leg fails after the audit leg', async () => {
    runRetentionPurge.mockRejectedValue(new FakePartialError('trial leg failed', 12, 'trial'));
    const res = await GET(req('Bearer sekrit'));
    expect(res.status).toBe(500);
    const detail = maybeAlertRetentionPurge.mock.calls[0]![0].detail as string;
    expect(detail).toContain('12 redaction(s) DID commit');
    expect(detail).toContain('the 2-year leg ran, only the 90-day trial leg did not');
  });

  // A review finding: this branch previously hardcoded "only the trial leg
  // did not" regardless of which leg actually threw, self-contradicting the
  // error's own message on exactly this path.
  it('says what COMMITTED when the error_log leg fails after the audit leg, without blaming the trial leg', async () => {
    runRetentionPurge.mockRejectedValue(new FakePartialError('error_log leg failed', 12, 'errorLog'));
    const res = await GET(req('Bearer sekrit'));
    expect(res.status).toBe(500);
    const detail = maybeAlertRetentionPurge.mock.calls[0]![0].detail as string;
    expect(detail).toContain('12 redaction(s) DID commit');
    expect(detail).toContain('the 2-year leg and the 90-day trial leg both ran; only the error_log leg did not');
    expect(detail).not.toContain('only the 90-day trial leg did not');
  });

  // Migration 020 has been live since the 2026-07-17 go-live, so on THIS
  // database "table absent" is a signal, not a shrug.
  it('alerts when the trial table reports absent, but still returns 200', async () => {
    runRetentionPurge.mockResolvedValue({ ...DRY_SUMMARY, trial: { skipped: 'table-absent' } });
    const res = await GET(req('Bearer sekrit'));
    expect(res.status).toBe(200);
    expect(maybeAlertRetentionPurge).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'skipped' }),
    );
  });

  it('returns counts only — never question text or user ids', async () => {
    const res = await GET(req('Bearer sekrit'));
    const body = JSON.stringify(await res.json());
    expect(body).toContain('auditRows');
    expect(body).not.toMatch(/question|user_id|userId|final_text/i);
  });
});
