// #23 (2026-09-17, session 109): the proactive INGESTION-RUN owner alert.
// Fail-soft by contract, same posture as every sibling alert in alerts.ts:
// no config → log-only; email failure → swallowed; AT MOST ONE email per run,
// batched (never one per table), no-op on a fully clean run. Hermetic —
// fetch is stubbed, no env leaks between tests.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  alertIngestionRunProblems,
  maybeAlertIngestionRunProblems,
  type IngestionRunProblem,
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

const PROBLEM_A: IngestionRunProblem = {
  tableId: '82235NED',
  source: 'cbs',
  check: 'row_plausibility',
  message: 'row count fell outside tolerance',
  batchId: 42,
};

const PROBLEM_B: IngestionRunProblem = {
  tableId: 'eurostat:demo_r_d2jan',
  source: 'eurostat',
  check: 'threw',
  message: 'fetch timed out',
  batchId: null,
};

afterEach(() => vi.restoreAllMocks());

describe('alertIngestionRunProblems (#23)', () => {
  it('without RESEND_API_KEY/ADMIN_ALERT_EMAIL: sends nothing', async () => {
    const restore = envPatch({ RESEND_API_KEY: undefined, ADMIN_ALERT_EMAIL: undefined });
    const fetchStub = vi.fn();
    try {
      await alertIngestionRunProblems({ problems: [PROBLEM_A] }, fetchStub as unknown as typeof fetch);
      expect(fetchStub).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('with config: sends ONE email listing every affected table, its check, batch id and message', async () => {
    const restore = envPatch({ RESEND_API_KEY: 'key-x', ADMIN_ALERT_EMAIL: 'owner@example.com' });
    const fetchStub = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK' }));
    try {
      await alertIngestionRunProblems({ problems: [PROBLEM_A, PROBLEM_B] }, fetchStub as unknown as typeof fetch);
      expect(fetchStub).toHaveBeenCalledOnce();
      const [url, init] = fetchStub.mock.calls[0]! as unknown as [string, RequestInit];
      expect(url).toBe('https://api.resend.com/emails');
      const body = JSON.parse(String(init.body));
      expect(body.to).toBe('owner@example.com');
      expect(body.subject).toContain('2 ingestieproblemen');
      for (const needle of [
        '82235NED',
        'row_plausibility',
        'batch: 42',
        'row count fell outside tolerance',
        'eurostat:demo_r_d2jan',
        'threw',
        'geen batch-id',
        'fetch timed out',
      ]) {
        expect(body.text).toContain(needle);
      }
    } finally {
      restore();
    }
  });

  it('a single-problem run uses the singular subject line', async () => {
    const restore = envPatch({ RESEND_API_KEY: 'key-x', ADMIN_ALERT_EMAIL: 'owner@example.com' });
    const fetchStub = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK' }));
    try {
      await alertIngestionRunProblems({ problems: [PROBLEM_A] }, fetchStub as unknown as typeof fetch);
      const [, init] = fetchStub.mock.calls[0]! as unknown as [string, RequestInit];
      const body = JSON.parse(String(init.body));
      expect(body.subject).toContain('ingestieprobleem bij tabel 82235NED');
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
        maybeAlertIngestionRunProblems({ problems: [PROBLEM_A] }, fetchStub as unknown as typeof fetch),
      ).resolves.toBeUndefined();
      expect(String(consoleError.mock.calls.at(-1))).toContain('alert e-mail failed');
    } finally {
      restore();
    }
  });
});

describe('maybeAlertIngestionRunProblems gating (#23)', () => {
  it('a fully clean run (empty problems) sends nothing and logs nothing', async () => {
    const restore = envPatch({ RESEND_API_KEY: 'key-x', ADMIN_ALERT_EMAIL: 'owner@example.com' });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub = vi.fn();
    try {
      await maybeAlertIngestionRunProblems({ problems: [] }, fetchStub as unknown as typeof fetch);
      expect(fetchStub).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('two failures in one run produce exactly ONE email, not two', async () => {
    const restore = envPatch({ RESEND_API_KEY: 'key-x', ADMIN_ALERT_EMAIL: 'owner@example.com' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK' }));
    try {
      await maybeAlertIngestionRunProblems({ problems: [PROBLEM_A, PROBLEM_B] }, fetchStub as unknown as typeof fetch);
      expect(fetchStub).toHaveBeenCalledOnce();
    } finally {
      restore();
    }
  });
});
