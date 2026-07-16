// #144 (ADR 034 §5, owner decision 2026-07-16): the fail-open ADMIN ALERT.
// Fail-soft by contract: no config → log-only; email failure → swallowed;
// the hook fires ONLY on a served answer carrying a checker record with
// status 'error'. Hermetic — fetch is stubbed, no env leaks between tests.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { alertSemanticCheckSkip, maybeAlertSemanticCheckSkip } from '../../src/answer/audit/alerts.ts';
import type { AuditedResponse } from '../../src/answer/audit/respond-audited.ts';
import type { SemanticCheckRecord } from '../../src/answer/compose/types.ts';

const ALERT = { auditId: 253, userId: 'user-1', question: 'Hoeveel inwoners?', error: 'api down' };

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

function auditedAnswer(check: SemanticCheckRecord | undefined): AuditedResponse {
  return {
    auditId: 253,
    response: {
      kind: 'answer',
      question: 'Hoeveel inwoners?',
      answer: check === undefined ? {} : { semanticCheck: check },
    } as unknown as AuditedResponse['response'],
  };
}

const ERROR_RECORD: SemanticCheckRecord = {
  schemaVersion: 1,
  promptVersion: 2,
  mode: 'fail_open',
  status: 'error',
  model: null,
  suspects: [{ token: '2024', index: 3, sentence: 'x', kind: 'period' }],
  verdicts: null,
  error: 'api down',
  latencyMs: 12,
};

afterEach(() => vi.restoreAllMocks());

describe('alertSemanticCheckSkip (#144 fail-open admin alert)', () => {
  it('without RESEND_API_KEY/ADMIN_ALERT_EMAIL: logs the floor line, sends nothing', async () => {
    const restore = envPatch({ RESEND_API_KEY: undefined, ADMIN_ALERT_EMAIL: undefined });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub = vi.fn();
    try {
      await alertSemanticCheckSkip(ALERT, fetchStub as unknown as typeof fetch);
      expect(fetchStub).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledOnce();
      expect(String(consoleError.mock.calls[0])).toContain('FAIL-OPEN skip');
    } finally {
      restore();
    }
  });

  it('with config: sends the Dutch owner email carrying user, question, error and audit row', async () => {
    const restore = envPatch({ RESEND_API_KEY: 'key-x', ADMIN_ALERT_EMAIL: 'owner@example.com' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK' }));
    try {
      await alertSemanticCheckSkip(ALERT, fetchStub as unknown as typeof fetch);
      expect(fetchStub).toHaveBeenCalledOnce();
      const [url, init] = fetchStub.mock.calls[0]! as unknown as [string, RequestInit];
      expect(url).toBe('https://api.resend.com/emails');
      const body = JSON.parse(String(init.body));
      expect(body.to).toBe('owner@example.com');
      expect(body.subject).toContain('semantische controle overgeslagen');
      for (const needle of ['user-1', 'Hoeveel inwoners?', 'api down', 'Audit-rij: 253', 'deterministisch gevalideerd']) {
        expect(body.text).toContain(needle);
      }
    } finally {
      restore();
    }
  });

  it('an email failure is swallowed and logged — the answer is never affected', async () => {
    const restore = envPatch({ RESEND_API_KEY: 'key-x', ADMIN_ALERT_EMAIL: 'owner@example.com' });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub = vi.fn(async () => {
      throw new Error('network down');
    });
    try {
      await expect(
        alertSemanticCheckSkip(ALERT, fetchStub as unknown as typeof fetch),
      ).resolves.toBeUndefined();
      expect(String(consoleError.mock.calls.at(-1))).toContain('alert email failed');
    } finally {
      restore();
    }
  });
});

describe('maybeAlertSemanticCheckSkip hook gating', () => {
  it("fires ONLY on a served answer with checker status 'error' — ok/skipped/absent/refusal stay silent", async () => {
    const restore = envPatch({ RESEND_API_KEY: undefined, ADMIN_ALERT_EMAIL: undefined });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await maybeAlertSemanticCheckSkip(auditedAnswer(undefined), 'user-1'); // flag off
      await maybeAlertSemanticCheckSkip(auditedAnswer({ ...ERROR_RECORD, status: 'ok', model: 'm', verdicts: [] }), 'user-1');
      await maybeAlertSemanticCheckSkip(
        { auditId: 1, response: { kind: 'refusal' } as unknown as AuditedResponse['response'] },
        'user-1',
      );
      expect(consoleError).not.toHaveBeenCalled();

      await maybeAlertSemanticCheckSkip(auditedAnswer(ERROR_RECORD), 'user-1');
      expect(consoleError).toHaveBeenCalledOnce();
      expect(String(consoleError.mock.calls[0])).toContain('audit row 253');
    } finally {
      restore();
    }
  });
});
