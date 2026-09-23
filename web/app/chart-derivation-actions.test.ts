// Co-pilot phase 4 (session 115, #274): the server action that re-runs a
// registered derivation (difference/mean) over an ALREADY-AUDITED chart's own
// cells, on demand. No CBS fetch, no new audit_answers row — the source cells
// were already fetched and verified once, when this chart's answer was first
// built; this only re-applies deterministic math to them (R5). Mirrors the
// mocking pattern from dataset-copilot-actions.test.ts and
// chart-headline-actions.test.ts.
import { describe, expect, it, vi } from 'vitest';

const { currentUserId, getDb } = vi.hoisted(() => ({
  currentUserId: vi.fn().mockResolvedValue('u1'),
  getDb: vi.fn(),
}));
vi.mock('../lib/current-user.ts', () => ({ currentUserId }));
vi.mock('../lib/db.ts', () => ({ getDb }));

const { loadAuditRecord, isRedacted } = vi.hoisted(() => ({
  loadAuditRecord: vi.fn(),
  isRedacted: vi.fn().mockReturnValue(false),
}));
vi.mock('../../src/answer/audit/index.ts', () => ({ loadAuditRecord, isRedacted }));

vi.mock('../lib/error-report.ts', () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

import { requestChartDerivation } from './chart-derivation-actions.ts';

const spec = { unit: 'aantal', series: [{ label: 'x', regionCode: 'GM0599', points: [
  { resultId: 'r1', periodCode: '2019', periodLabel: '2019', value: 10, formattedValue: '10', decimals: 0, status: 'Definitief', provisional: false, valueAttribute: 'None' },
  { resultId: 'r2', periodCode: '2020', periodLabel: '2020', value: 20, formattedValue: '20', decimals: 0, status: 'Definitief', provisional: false, valueAttribute: 'None' },
] }] };

describe('requestChartDerivation', () => {
  it('refuses a non-answer key (own-data charts have no audit row to re-read)', async () => {
    const result = await requestChartDerivation({ kind: 'turn', id: 1 }, 'difference', ['r1', 'r2']);
    expect(result.ok).toBe(false);
  });

  it('re-derives a difference over the audited chart\'s own cells, no new CBS fetch, no new audit row', async () => {
    loadAuditRecord.mockResolvedValue({ id: 5, userId: 'u1', response: { kind: 'answer', chart: spec, cells: [], derivations: [] } });
    const result = await requestChartDerivation({ kind: 'answer', id: 5 }, 'difference', ['r1', 'r2']);
    expect(result).toEqual({ ok: true, record: expect.objectContaining({ kind: 'difference', value: 10 }) });
  });

  it('code-review fix round 3: sorts cells by periodCode before deriving, so clicking the LATER point first never flips the sign', async () => {
    loadAuditRecord.mockResolvedValue({ id: 5, userId: 'u1', response: { kind: 'answer', chart: spec, cells: [], derivations: [] } });
    // r2 (2020) clicked first, r1 (2019) clicked second — the reverse of the
    // chronological order. Before this fix, `requestChartDerivation` passed
    // resultIds straight through to `deriveDifference`, which treats
    // cells[0] as "earlier" unconditionally — this would have returned -10.
    const result = await requestChartDerivation({ kind: 'answer', id: 5 }, 'difference', ['r2', 'r1']);
    expect(result).toEqual({ ok: true, record: expect.objectContaining({ kind: 'difference', value: 10 }) });
  });

  it('#292(b): refuses the same point named twice, rather than computing an automatic zero', async () => {
    loadAuditRecord.mockResolvedValue({ id: 5, userId: 'u1', response: { kind: 'answer', chart: spec, cells: [], derivations: [] } });
    expect((await requestChartDerivation({ kind: 'answer', id: 5 }, 'difference', ['r1', 'r1'])).ok).toBe(false);
    expect((await requestChartDerivation({ kind: 'answer', id: 5 }, 'mean', ['r1', 'r2', 'r1'])).ok).toBe(false);
  });

  it('refuses a resultId not present on that chart, rather than guessing', async () => {
    loadAuditRecord.mockResolvedValue({ id: 5, userId: 'u1', response: { kind: 'answer', chart: spec, cells: [], derivations: [] } });
    const result = await requestChartDerivation({ kind: 'answer', id: 5 }, 'difference', ['r1', 'not-real']);
    expect(result.ok).toBe(false);
  });

  it('refuses an answer belonging to a different user, rather than leaking its data (security fix, final review)', async () => {
    loadAuditRecord.mockResolvedValue({ id: 5, userId: 'someone-else', response: { kind: 'answer', chart: spec, cells: [], derivations: [] } });
    const result = await requestChartDerivation({ kind: 'answer', id: 5 }, 'difference', ['r1', 'r2']);
    expect(result.ok).toBe(false);
  });

  it('refuses a redacted answer', async () => {
    isRedacted.mockReturnValueOnce(true);
    loadAuditRecord.mockResolvedValue({ id: 5, userId: 'u1', response: { kind: 'answer', chart: spec, cells: [], derivations: [] } });
    const result = await requestChartDerivation({ kind: 'answer', id: 5 }, 'difference', ['r1', 'r2']);
    expect(result.ok).toBe(false);
  });

  it('refuses when the audit row has no chart at all', async () => {
    loadAuditRecord.mockResolvedValue({ id: 5, userId: 'u1', response: { kind: 'answer', chart: null, cells: [], derivations: [] } });
    const result = await requestChartDerivation({ kind: 'answer', id: 5 }, 'difference', ['r1', 'r2']);
    expect(result.ok).toBe(false);
  });

  // Minor fix (final review): a stored row can have `chart: undefined`
  // (never written, rather than explicitly written as null) — the old
  // `spec === null` check missed this case and fell through to the generic
  // catch/reportError path instead of this specific, honest refusal.
  it('refuses when the audit row\'s chart is undefined (not explicitly null), with the same honest reason as a null chart', async () => {
    loadAuditRecord.mockResolvedValue({ id: 5, userId: 'u1', response: { kind: 'answer', chart: undefined, cells: [], derivations: [] } });
    const result = await requestChartDerivation({ kind: 'answer', id: 5 }, 'difference', ['r1', 'r2']);
    expect(result).toEqual({ ok: false, reason: 'this answer has no chart to derive from' });
  });

  it('refuses derivation on null-valued cells with an accurate CBS reason message', async () => {
    const specWithNull = { unit: 'aantal', series: [{ label: 'x', regionCode: 'GM0599', points: [
      { resultId: 'r1', periodCode: '2019', periodLabel: '2019', value: 10, formattedValue: '10', decimals: 0, status: 'Definitief', provisional: false, valueAttribute: 'None' },
      { resultId: 'r2', periodCode: '2020', periodLabel: '2020', value: null, formattedValue: null, decimals: 0, status: 'Definitief', provisional: false, valueAttribute: 'DataNotAvailable' },
    ] }] };
    loadAuditRecord.mockResolvedValue({ id: 5, userId: 'u1', response: { kind: 'answer', chart: specWithNull, cells: [], derivations: [] } });
    const result = await requestChartDerivation({ kind: 'answer', id: 5 }, 'mean', ['r1', 'r2']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('DataNotAvailable');
    }
  });
});
