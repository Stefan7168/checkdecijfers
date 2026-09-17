// #23 residual (missed-sync trigger, session 110): findStaleSyncs/
// shouldAlertToday are pure — no DB, no clock read inside them — so this
// suite drives them entirely with fixture rows and a fixed `now`.
import { describe, expect, it } from 'vitest';
import {
  cadenceThresholdDays,
  finestGrain,
  findStaleSyncs,
  shouldAlertToday,
  SYNC_CADENCE_THRESHOLD_DAYS,
  type StaleSyncCandidateRow,
} from '../../src/ingestion/stale-sync.ts';

const NOW = new Date('2026-09-17T06:00:00.000Z');

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function row(overrides: Partial<StaleSyncCandidateRow>): StaleSyncCandidateRow {
  return {
    tableId: '82235NED',
    status: 'active',
    lastSyncAt: daysAgo(1),
    periodSemantics: { JJ: 'some yearly description' },
    ...overrides,
  };
}

describe('finestGrain / cadenceThresholdDays', () => {
  it('picks the finest grain present: MM > KW > JJ', () => {
    expect(finestGrain({ JJ: 'x', MM: 'y' })).toBe('MM');
    expect(finestGrain({ JJ: 'x', KW: 'y' })).toBe('KW');
    expect(finestGrain({ JJ: 'x' })).toBe('JJ');
  });

  it('falls back to unknown for null, empty, or unrecognized-grain semantics', () => {
    expect(finestGrain(null)).toBe('unknown');
    expect(finestGrain({})).toBe('unknown');
    expect(finestGrain({ WK: 'weekly, not a grain this table registers' })).toBe('unknown');
  });

  it('maps each grain to its documented threshold constant', () => {
    expect(cadenceThresholdDays({ MM: 'x' })).toBe(SYNC_CADENCE_THRESHOLD_DAYS.MM);
    expect(cadenceThresholdDays({ KW: 'x' })).toBe(SYNC_CADENCE_THRESHOLD_DAYS.KW);
    expect(cadenceThresholdDays({ JJ: 'x' })).toBe(SYNC_CADENCE_THRESHOLD_DAYS.JJ);
    expect(cadenceThresholdDays(null)).toBe(SYNC_CADENCE_THRESHOLD_DAYS.unknown);
    expect(SYNC_CADENCE_THRESHOLD_DAYS).toEqual({ MM: 60, KW: 130, JJ: 420, unknown: 420 });
  });
});

describe('findStaleSyncs', () => {
  it('a table well within its cadence is not stale', () => {
    const rows = [row({ tableId: 'fresh', lastSyncAt: daysAgo(10), periodSemantics: { MM: 'x' } })];
    expect(findStaleSyncs(rows, NOW)).toEqual([]);
  });

  it('a monthly table 61 days since its last sync is overdue by 1 day', () => {
    const rows = [row({ tableId: 'monthly', lastSyncAt: daysAgo(61), periodSemantics: { MM: 'x' } })];
    const result = findStaleSyncs(rows, NOW);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ tableId: 'monthly', thresholdDays: 60, overdueDays: 1 });
  });

  it('exactly AT the threshold (60 days) is not yet overdue', () => {
    const rows = [row({ tableId: 'monthly', lastSyncAt: daysAgo(60), periodSemantics: { MM: 'x' } })];
    expect(findStaleSyncs(rows, NOW)).toEqual([]);
  });

  it('a quarterly table uses the 130-day threshold', () => {
    const rows = [row({ tableId: 'quarterly', lastSyncAt: daysAgo(140), periodSemantics: { KW: 'x' } })];
    const result = findStaleSyncs(rows, NOW);
    expect(result[0]).toMatchObject({ tableId: 'quarterly', thresholdDays: 130, overdueDays: 10 });
  });

  it('a yearly-only table uses the 420-day threshold', () => {
    const rows = [row({ tableId: 'yearly', lastSyncAt: daysAgo(425), periodSemantics: { JJ: 'x' } })];
    const result = findStaleSyncs(rows, NOW);
    expect(result[0]).toMatchObject({ tableId: 'yearly', thresholdDays: 420, overdueDays: 5 });
  });

  it('a table with no period_semantics at all falls back to the 420-day (unknown) threshold', () => {
    const rows = [row({ tableId: 'unclassified', lastSyncAt: daysAgo(500), periodSemantics: null })];
    const result = findStaleSyncs(rows, NOW);
    expect(result[0]).toMatchObject({ tableId: 'unclassified', thresholdDays: 420, overdueDays: 80 });
  });

  it('a needs_review table is excluded even if its sync is ancient (covered by the existing quarantine alert)', () => {
    const rows = [row({ tableId: 'quarantined', status: 'needs_review', lastSyncAt: daysAgo(1000) })];
    expect(findStaleSyncs(rows, NOW)).toEqual([]);
  });

  it('an active table that has NEVER synced (lastSyncAt null) is excluded — a different gap, not guessed at', () => {
    const rows = [row({ tableId: 'never-synced', lastSyncAt: null })];
    expect(findStaleSyncs(rows, NOW)).toEqual([]);
  });

  it('an unparsable lastSyncAt is excluded rather than throwing or producing NaN', () => {
    const rows = [row({ tableId: 'bad-timestamp', lastSyncAt: 'not-a-date' })];
    expect(findStaleSyncs(rows, NOW)).toEqual([]);
  });

  it('mixed rows: only the genuinely overdue active table is returned, in input order', () => {
    const rows = [
      row({ tableId: 'fresh-monthly', lastSyncAt: daysAgo(5), periodSemantics: { MM: 'x' } }),
      row({ tableId: 'stale-monthly', lastSyncAt: daysAgo(90), periodSemantics: { MM: 'x' } }),
      row({ tableId: 'quarantined', status: 'needs_review', lastSyncAt: daysAgo(1000) }),
    ];
    const result = findStaleSyncs(rows, NOW);
    expect(result.map((r) => r.tableId)).toEqual(['stale-monthly']);
  });
});

describe('shouldAlertToday (daily-alert-fatigue dedupe)', () => {
  it('never alerts before the table is actually overdue', () => {
    expect(shouldAlertToday(0)).toBe(false);
    expect(shouldAlertToday(-1)).toBe(false);
  });

  it('alerts on day 1 — the first day it crosses the threshold', () => {
    expect(shouldAlertToday(1)).toBe(true);
  });

  it('stays silent days 2 through 7 after crossing', () => {
    for (const d of [2, 3, 4, 5, 6, 7]) {
      expect(shouldAlertToday(d)).toBe(false);
    }
  });

  it('alerts again on day 8, then every 7th day after (15, 22, ...)', () => {
    expect(shouldAlertToday(8)).toBe(true);
    expect(shouldAlertToday(15)).toBe(true);
    expect(shouldAlertToday(22)).toBe(true);
    expect(shouldAlertToday(9)).toBe(false);
    expect(shouldAlertToday(21)).toBe(false);
  });
});
