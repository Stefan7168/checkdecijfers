// #121 (unconditional half): the internal-refusal ADMIN ALERT — the #144
// posture mirrored (console.error floor, Resend when configured, fail-soft
// always). MEASURED design correction pinned here in prose: a template-rung
// throw does NOT propagate uncaught (respond.ts's catch-all already serves
// the honest 'internal' refusal on every production path — see
// respondToQuestion/respondToClarificationReply); what was missing is the
// LOUDNESS: nothing told the owner the floor of the ladder broke. Hermetic —
// fetch stubbed, env patched per test.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { alertInternalRefusal, maybeAlertInternalRefusal } from '../../src/answer/audit/alerts.ts';
import type { AuditedResponse } from '../../src/answer/audit/respond-audited.ts';

const ALERT = {
  auditId: 300,
  userId: 'user-1',
  question: 'Hoeveel inwoners?',
  internalNote: 'TypeError: cells[0] is undefined',
};

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

function auditedRefusal(reason: string, internalNote: string | null = ALERT.internalNote): AuditedResponse {
  return {
    auditId: 300,
    response: {
      kind: 'refusal',
      reason,
      question: ALERT.question,
      internalNote,
    } as unknown as AuditedResponse['response'],
  } as AuditedResponse;
}

afterEach(() => vi.restoreAllMocks());

describe('alertInternalRefusal (#121 admin alert)', () => {
  it('without RESEND_API_KEY/ADMIN_ALERT_EMAIL: logs the floor line, sends nothing', async () => {
    const restore = envPatch({ RESEND_API_KEY: undefined, ADMIN_ALERT_EMAIL: undefined });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub = vi.fn();
    try {
      await alertInternalRefusal(ALERT, fetchStub as unknown as typeof fetch);
      expect(fetchStub).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledOnce();
      expect(String(consoleError.mock.calls[0])).toContain('INTERNAL refusal served');
      expect(String(consoleError.mock.calls[0])).toContain(ALERT.internalNote);
    } finally {
      restore();
    }
  });

  it('with config: sends the Resend email carrying audit row, user, question and the internal note', async () => {
    const restore = envPatch({ RESEND_API_KEY: 'key-x', ADMIN_ALERT_EMAIL: 'owner@example.com' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub = vi.fn().mockResolvedValue({ ok: true });
    try {
      await alertInternalRefusal(ALERT, fetchStub as unknown as typeof fetch);
      expect(fetchStub).toHaveBeenCalledOnce();
      const body = JSON.parse((fetchStub.mock.calls[0]![1] as { body: string }).body) as {
        to: string;
        subject: string;
        text: string;
      };
      expect(body.to).toBe('owner@example.com');
      expect(body.subject).toContain('interne weigering');
      expect(body.text).toContain('Audit-rij: 300');
      expect(body.text).toContain('Gebruiker: user-1');
      expect(body.text).toContain(ALERT.question);
      expect(body.text).toContain(ALERT.internalNote);
    } finally {
      restore();
    }
  });

  it('an email failure is swallowed (fail-soft) — the served refusal is never affected', async () => {
    const restore = envPatch({ RESEND_API_KEY: 'key-x', ADMIN_ALERT_EMAIL: 'owner@example.com' });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub = vi.fn().mockRejectedValue(new Error('resend down'));
    try {
      await expect(
        alertInternalRefusal(ALERT, fetchStub as unknown as typeof fetch),
      ).resolves.toBeUndefined();
      expect(String(consoleError.mock.calls.at(-1))).toContain('email failed');
    } finally {
      restore();
    }
  });
});

describe('maybeAlertInternalRefusal (the respond-audited hook)', () => {
  it('fires ONLY on reason internal — a normal refusal stays silent', async () => {
    const restore = envPatch({ RESEND_API_KEY: undefined, ADMIN_ALERT_EMAIL: undefined });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await maybeAlertInternalRefusal(auditedRefusal('freshness'), 'user-1');
      await maybeAlertInternalRefusal(auditedRefusal('scope'), 'user-1');
      expect(consoleError).not.toHaveBeenCalled();
      await maybeAlertInternalRefusal(auditedRefusal('internal'), 'user-1');
      expect(consoleError).toHaveBeenCalledOnce();
      expect(String(consoleError.mock.calls[0])).toContain('INTERNAL refusal served');
    } finally {
      restore();
    }
  });

  it('never fires on answers/clarifications and never throws on a malformed envelope', async () => {
    const restore = envPatch({ RESEND_API_KEY: undefined, ADMIN_ALERT_EMAIL: undefined });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await maybeAlertInternalRefusal(
        { auditId: 1, response: { kind: 'answer' } as unknown as AuditedResponse['response'] } as AuditedResponse,
        null,
      );
      expect(consoleError).not.toHaveBeenCalled();
      await expect(
        maybeAlertInternalRefusal({ auditId: 1, response: null as never } as AuditedResponse, null),
      ).resolves.toBeUndefined();
    } finally {
      restore();
    }
  });
});
