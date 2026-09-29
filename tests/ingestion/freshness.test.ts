// #355: assessFreshness is pure — fixture rows in, findings out (no DB, no clock, no network).
import { describe, expect, it } from 'vitest';
import {
  assessFreshness,
  classifyRelease,
  findNewCbsData,
  shouldAlertAboutNewData,
  type FreshnessInputRow,
  type ReleaseDiffInput,
} from '../../src/ingestion/freshness.ts';

function row(overrides: Partial<FreshnessInputRow>): FreshnessInputRow {
  return {
    tableId: '86141NED',
    lastSyncAt: '2026-08-26T10:00:00.000Z',
    cbsModifiedAt: '2026-08-20T06:30:00+02:00',
    ...overrides,
  };
}

describe('assessFreshness', () => {
  it('is behind when CBS changed the table after our last successful sync, with whole days', () => {
    const [f] = assessFreshness([row({ cbsModifiedAt: '2026-09-08T06:30:00+02:00' })]);
    expect(f).toMatchObject({ tableId: '86141NED', status: 'behind', daysBehind: 12 });
  });

  it('is current when CBS last changed the table before our sync (or at the same instant)', () => {
    expect(assessFreshness([row({})])[0]!.status).toBe('current');
    expect(assessFreshness([row({ cbsModifiedAt: '2026-08-26T10:00:00.000Z' })])[0]!.status).toBe('current');
  });

  it('a table CBS changed hours after our sync is behind by 0 days, not current', () => {
    const [f] = assessFreshness([row({ cbsModifiedAt: '2026-08-26T18:00:00.000Z' })]);
    expect(f).toMatchObject({ status: 'behind', daysBehind: 0 });
  });

  it('never guesses: a missing or unreadable date on either side is unknown, never current', () => {
    expect(assessFreshness([row({ cbsModifiedAt: null })])[0]!.status).toBe('unknown');
    expect(assessFreshness([row({ lastSyncAt: null })])[0]!.status).toBe('unknown');
    expect(assessFreshness([row({ cbsModifiedAt: 'not a date' })])[0]!.status).toBe('unknown');
  });

  it('orders most-behind first, then unknown, then current, ties by table id', () => {
    const out = assessFreshness([
      row({ tableId: 'C-current' }),
      row({ tableId: 'B-behind-small', cbsModifiedAt: '2026-08-30T00:00:00.000Z' }),
      row({ tableId: 'D-unknown', cbsModifiedAt: null }),
      row({ tableId: 'A-behind-big', cbsModifiedAt: '2026-09-23T00:00:00.000Z' }),
      row({ tableId: 'A-behind-tie', cbsModifiedAt: '2026-08-30T00:00:00.000Z' }),
    ]);
    expect(out.map((f) => f.tableId)).toEqual(['A-behind-big', 'A-behind-tie', 'B-behind-small', 'D-unknown', 'C-current']);
  });
});

function diff(overrides: Partial<ReleaseDiffInput>): ReleaseDiffInput {
  return {
    timeDimension: 'Perioden',
    stored: { Perioden: ['2026MM06', '2026MM07'], Bestedingscategorieen: ['T001112', 'CPI011100'] },
    fetched: { Perioden: ['2026MM06', '2026MM07', '2026MM08'], Bestedingscategorieen: ['T001112', 'CPI011100'] },
    storedFingerprint: 'fp-1',
    fetchedFingerprint: 'fp-1',
    ...overrides,
  };
}

describe('classifyRelease', () => {
  it('is safe when the only change is the next period code and the fingerprint is unchanged', () => {
    expect(classifyRelease(diff({}))).toEqual({ verdict: 'safe', newPeriodCodes: ['2026MM08'], reasons: [] });
  });

  it('is safe when nothing changed in the code lists (a revision of existing figures)', () => {
    const same = { Perioden: ['2026MM06', '2026MM07'], Bestedingscategorieen: ['T001112'] };
    expect(classifyRelease(diff({ stored: same, fetched: same })).verdict).toBe('safe');
  });

  it('needs review when a new code appears on a NON-period dimension', () => {
    const r = classifyRelease(
      diff({ fetched: { Perioden: ['2026MM06', '2026MM07', '2026MM08'], Bestedingscategorieen: ['T001112', 'CPI011100', 'CPI999999'] } }),
    );
    expect(r.verdict).toBe('review');
    expect(r.reasons.join(' ')).toContain('new non-period code(s) in Bestedingscategorieen: CPI999999');
  });

  it('needs review when CBS stopped listing a stored code, even on the period dimension', () => {
    const r = classifyRelease(diff({ fetched: { Perioden: ['2026MM07', '2026MM08'], Bestedingscategorieen: ['T001112', 'CPI011100'] } }));
    expect(r.verdict).toBe('review');
    expect(r.reasons.join(' ')).toContain('no longer lists 1 code(s) of Perioden: 2026MM06');
  });

  it('needs review when the structure fingerprint moved, or was never recorded', () => {
    expect(classifyRelease(diff({ fetchedFingerprint: 'fp-2' })).verdict).toBe('review');
    expect(classifyRelease(diff({ storedFingerprint: null })).verdict).toBe('review');
  });

  it('needs review when a whole dimension disappeared or there is no time dimension', () => {
    expect(classifyRelease(diff({ fetched: { Perioden: ['2026MM06', '2026MM07'] } })).reasons.join(' ')).toContain(
      'dimension Bestedingscategorieen is no longer published',
    );
    expect(classifyRelease(diff({ timeDimension: null })).verdict).toBe('review');
  });
});

describe('findNewCbsData (#355 alert input)', () => {
  const now = new Date('2026-09-30T06:00:00.000Z');

  it('lists only the behind tables, each with how long ago CBS changed it', () => {
    const findings = assessFreshness([
      row({ tableId: 'A-behind', cbsModifiedAt: '2026-09-23T06:00:00.000Z' }),
      row({ tableId: 'B-current' }),
      row({ tableId: 'C-unknown', cbsModifiedAt: null }),
    ]);
    expect(findNewCbsData(findings, now)).toEqual([
      {
        tableId: 'A-behind',
        lastSyncAt: '2026-08-26T10:00:00.000Z',
        cbsModifiedAt: '2026-09-23T06:00:00.000Z',
        daysBehind: 27,
        cbsChangedDaysAgo: 7,
      },
    ]);
  });

  it('an unreadable CBS date is not news: unknown tables never appear', () => {
    expect(findNewCbsData(assessFreshness([row({ cbsModifiedAt: 'not a date' })]), now)).toEqual([]);
  });

  it('a change from the last few hours is age 0, and a clock a hair behind CBS never goes negative', () => {
    const fresh = findNewCbsData(assessFreshness([row({ cbsModifiedAt: '2026-09-30T02:00:00.000Z' })]), now);
    expect(fresh[0]!.cbsChangedDaysAgo).toBe(0);
    const future = findNewCbsData(assessFreshness([row({ cbsModifiedAt: '2026-09-30T09:00:00.000Z' })]), now);
    expect(future[0]!.cbsChangedDaysAgo).toBe(0);
  });
});

describe('shouldAlertAboutNewData (#355 dedupe)', () => {
  it('fires the day the news breaks, then every 7th day, and stays quiet in between', () => {
    const days = Array.from({ length: 23 }, (_, d) => d).filter(shouldAlertAboutNewData);
    expect(days).toEqual([0, 7, 14, 21]);
  });

  it('never fires for a negative age', () => {
    expect(shouldAlertAboutNewData(-7)).toBe(false);
  });
});
