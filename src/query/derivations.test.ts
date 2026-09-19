import { describe, expect, it } from 'vitest';
import { deriveMean } from './derivations.ts';
import type { ResultCell } from './types.ts';

const cell = (resultId: string, value: number | null, periodCode: string, regionCode: string | null = 'GM0518', unit = 'aantal'): ResultCell => ({
  resultId, value, periodCode, regionCode, unit,
  tableId: 't', measure: 'm', measureTitle: 'm', periodLabel: periodCode, grain: 'JJ',
  dims: {}, dimLabels: {}, decimals: 0, status: 'Definitief',
  provisional: false, valueAttribute: 'None', batchId: 1,
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
