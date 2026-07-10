// WP16 sub-part 2 (ADR 026, design §7): the audit record for an onboarding
// acknowledgment must reconstruct from the stored row alone (R8) — both new
// reasons round-trip, and the onboarding envelope field's present/absent shape
// is checked for consistency with the reason. Pure: no LLM, no database — a
// hand-built refusal response through buildAuditRow, then reconstructionReport.
import { describe, expect, it } from 'vitest';
import { buildOnboardingRefusal, toRefusalResponse } from '../../src/answer/respond/refusals.ts';
import { buildAuditRow, type AuditContext } from '../../src/answer/audit/write.ts';
import { reconstructionReport } from '../../src/answer/audit/reconstruct.ts';
import type { AuditRecord } from '../../src/answer/audit/types.ts';
import type { RefusalResponse } from '../../src/answer/respond/types.ts';

const CONTEXT: AuditContext = {
  referenceDate: '2026-07-06',
  userId: '11111111-1111-1111-1111-111111111111',
  sourceTag: 'user',
  requestId: 'req-abc',
  replyText: null,
  pendingClarification: null,
  conversationContext: null,
  llmCalls: [],
  latencyMs: 12,
};

function recordFor(response: RefusalResponse): AuditRecord {
  const row = buildAuditRow(response, CONTEXT);
  return { ...row, id: 1, createdAt: '2026-07-06T00:00:00.000Z' };
}

function onboardingResponse(already: boolean): RefusalResponse {
  const built = buildOnboardingRefusal(
    { tableId: '82610NED', topicTerm: 'zonnestroom', confidence: 0.91, candidateIds: ['82610NED'] },
    already,
  );
  return toRefusalResponse({ question: 'hoeveel zonnestroom in 2024', built, parse: null, queryRefusal: null });
}

describe('onboarding acknowledgment audit round-trip (WP16 sub-part 2, R8)', () => {
  it('onboarding_pending row reconstructs — reason + envelope field consistent', () => {
    const record = recordFor(onboardingResponse(false));
    expect(record.refusalReason).toBe('onboarding_pending');
    const report = reconstructionReport(record);
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('onboarding_already_pending row reconstructs — reason with NO envelope field', () => {
    const record = recordFor(onboardingResponse(true));
    expect(record.refusalReason).toBe('onboarding_already_pending');
    const report = reconstructionReport(record);
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('detects an onboarding_pending row whose envelope field was stripped (tamper)', () => {
    const record = recordFor(onboardingResponse(false));
    // Tamper: reason says a fetch started, but the envelope target is gone.
    const tampered: AuditRecord = JSON.parse(JSON.stringify(record));
    (tampered.response as RefusalResponse).onboarding = null;
    const report = reconstructionReport(tampered);
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toContain('onboarding envelope field');
  });

  it('detects a non-onboarding_pending reason that wrongly carries an envelope (tamper)', () => {
    const record = recordFor(onboardingResponse(true)); // already_pending → no envelope
    const tampered: AuditRecord = JSON.parse(JSON.stringify(record));
    (tampered.response as RefusalResponse).onboarding = {
      tableId: 'X',
      topicTerm: 't',
      confidence: 1,
      candidateIds: ['X'],
    };
    const report = reconstructionReport(tampered);
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toContain('onboarding envelope field');
  });

  it('detects a promoted refusal_reason that diverges from the envelope (existing R8 check still fires)', () => {
    const record = recordFor(onboardingResponse(false));
    const tampered: AuditRecord = JSON.parse(JSON.stringify(record));
    tampered.refusalReason = 'scope';
    const report = reconstructionReport(tampered);
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toContain('refusal_reason differs from the envelope');
  });
});
