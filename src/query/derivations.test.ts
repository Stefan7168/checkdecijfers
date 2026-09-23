import { describe, expect, it } from 'vitest';
import { deriveDirection, deriveFirstLast, deriveMean } from './derivations.ts';
import type { ResultCell } from './types.ts';

const cell = (resultId: string, value: number | null, periodCode: string, regionCode: string | null = 'GM0518', unit = 'aantal'): ResultCell => ({
  resultId, value, periodCode, regionCode, unit,
  tableId: 't', measure: 'm', measureTitle: 'm', periodLabel: periodCode, grain: 'JJ',
  dims: {}, dimLabels: {}, decimals: 0, status: 'Definitief',
  provisional: false, valueAttribute: 'None', batchId: 1,
} as ResultCell);

// ADR 048 D5b's cell builder: `tableId` carries the source-key prefix
// (`sourceKeyForTableId`), and `status`/`valueAttribute` carry a Eurostat
// flag VERBATIM (jsonstat.ts ~l.470-495) — a real Eurostat 'b' cell sets
// both to 'b', not just one.
const flaggedCell = (
  resultId: string,
  value: number,
  periodCode: string,
  tableId: string,
  status = 'Definitief',
): ResultCell => ({
  resultId, value, periodCode, regionCode: 'NL', unit: 'aantal',
  tableId, measure: 'm', measureTitle: 'm', periodLabel: periodCode, grain: 'JJ',
  dims: {}, dimLabels: {}, decimals: 0, status,
  provisional: status !== 'Definitief', valueAttribute: status === 'Definitief' ? 'None' : status, batchId: 1,
} as ResultCell);

describe('deriveMean', () => {
  it('averages ≥2 same-region cells', () => {
    const result = deriveMean([cell('r1', 10, '2019'), cell('r1', 20, '2020'), cell('r1', 30, '2021')]);
    expect(result).toEqual({ ok: true, record: expect.objectContaining({ kind: 'mean', value: 20, sourceResultIds: ['r1', 'r1', 'r1'] }) });
  });

  it('refuses fewer than 2 cells', () => {
    expect(deriveMean([cell('r1', 10, '2019')])).toEqual({ ok: false, reason: expect.stringContaining('needs at least 2') });
  });

  it('refuses when any cell is null (never guesses over a gap)', () => {
    const result = deriveMean([cell('r1', 10, '2019'), cell('r2', null, '2020')]);
    expect(result.ok).toBe(false);
  });

  it('refuses mixed units', () => {
    const result = deriveMean([cell('r1', 10, '2019', 'GM0518', 'aantal'), cell('r2', 20, '2020', 'GM0518', 'euro')]);
    expect(result.ok).toBe(false);
  });

  it('refuses cells spanning more than one region (not a meaningful average)', () => {
    const result = deriveMean([cell('r1', 10, '2019', 'GM0518'), cell('r2', 20, '2020', 'GM0363')]);
    expect(result.ok).toBe(false);
  });
});

describe('deriveDirection / deriveFirstLast — Eurostat break in series (ADR 048 D5b)', () => {
  it('deriveDirection refuses when a non-earliest Eurostat cell has the break (b) flag', () => {
    const cells = [
      flaggedCell('r2019', 10, '2019', 'eurostat:t'),
      flaggedCell('r2020', 20, '2020', 'eurostat:t'),
      flaggedCell('r2021', 30, '2021', 'eurostat:t', 'b'),
      flaggedCell('r2022', 40, '2022', 'eurostat:t'),
    ];
    const result = deriveDirection(cells);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('break in series');
      expect(result.reason).toContain('r2021');
    }
  });

  it('deriveFirstLast refuses when a non-earliest Eurostat cell has the break (b) flag', () => {
    const cells = [
      flaggedCell('r2019', 10, '2019', 'eurostat:t'),
      flaggedCell('r2020', 20, '2020', 'eurostat:t', 'b'),
    ];
    const result = deriveFirstLast(cells);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('break in series');
      expect(result.reason).toContain('r2020');
    }
  });

  it('deriveDirection succeeds when only the EARLIEST cell has the break flag (the break lies outside the compared range)', () => {
    const cells = [
      flaggedCell('r2019', 10, '2019', 'eurostat:t', 'b'),
      flaggedCell('r2020', 20, '2020', 'eurostat:t'),
      flaggedCell('r2021', 30, '2021', 'eurostat:t'),
    ];
    expect(deriveDirection(cells).ok).toBe(true);
  });

  it('deriveFirstLast succeeds when only the EARLIEST cell has the break flag (the break lies outside the compared range)', () => {
    const cells = [
      flaggedCell('r2019', 10, '2019', 'eurostat:t', 'b'),
      flaggedCell('r2020', 20, '2020', 'eurostat:t'),
    ];
    expect(deriveFirstLast(cells).ok).toBe(true);
  });

  it('a CBS cell whose status string happens to be "b" is unaffected (gated by source key, not the literal flag)', () => {
    const cells = [
      flaggedCell('r2019', 10, '2019', 't'),
      flaggedCell('r2020', 20, '2020', 't', 'b'),
      flaggedCell('r2021', 30, '2021', 't'),
    ];
    expect(deriveDirection(cells).ok).toBe(true);
    expect(deriveFirstLast(cells).ok).toBe(true);
  });
});
