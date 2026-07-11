// WP30b: encodePeriodCode is the exact inverse of parsePeriodCode — the
// canonical-grammar round-trip the conformance harness (family F2) holds
// every adapter's period mapping to. Exhaustive over the grammar.
import { describe, expect, it } from 'vitest';
import { encodePeriodCode, parsePeriodCode } from '../../src/ingestion/periods.ts';

describe('encodePeriodCode ∘ parsePeriodCode round-trip', () => {
  it('parse→encode is the identity on every valid code shape', () => {
    const codes: string[] = [];
    for (const year of [1900, 1921, 2019, 2024, 2025]) {
      codes.push(`${year}JJ00`);
      for (let q = 1; q <= 4; q++) codes.push(`${year}KW${String(q).padStart(2, '0')}`);
      for (let m = 1; m <= 12; m++) codes.push(`${year}MM${String(m).padStart(2, '0')}`);
    }
    for (const code of codes) {
      const parsed = parsePeriodCode(code);
      expect(parsed, code).not.toBeNull();
      expect(encodePeriodCode(parsed!)).toBe(code);
    }
  });

  it('encode→parse is the identity on parsed shapes (JJ null index encodes as 00)', () => {
    const shapes = [
      { grain: 'JJ' as const, year: 2024, index: null },
      { grain: 'KW' as const, year: 2024, index: 4 },
      { grain: 'MM' as const, year: 1999, index: 12 },
    ];
    for (const p of shapes) {
      expect(parsePeriodCode(encodePeriodCode(p))).toEqual(p);
    }
  });

  it('invalid codes still parse to null (grammar unchanged by WP30b)', () => {
    for (const bad of ['2024KW00', '2024KW05', '2024MM13', '2024JJ01', '2024XX01', '24JJ00', '2024jj00']) {
      expect(parsePeriodCode(bad), bad).toBeNull();
    }
  });
});
