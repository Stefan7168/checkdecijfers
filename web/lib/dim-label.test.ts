import { describe, expect, it } from 'vitest';
import { stripDimensionCode } from './dim-label.ts';

// WP-LOOK part (a) round 2 (session 143, ADR 063): the card's subtitle used
// to read "% 000000 Alle bestedingen" — CBS's own dimension title for the CPI
// categories carries the COICOP code in front (568 such titles in the
// fixtures, all in 86141NED's Bestedingscategorieen). A reader must never see
// that machine prefix on the card; the proof panel still shows the raw title.
describe('stripDimensionCode', () => {
  it('drops a leading all-digit code (four digits or more) and the space after it', () => {
    expect(stripDimensionCode('000000 Alle bestedingen')).toBe('Alle bestedingen');
    expect(stripDimensionCode('011150 Pastaproducten, noedels, couscous')).toBe('Pastaproducten, noedels, couscous');
    expect(stripDimensionCode('000000 All items')).toBe('All items');
  });
  it('leaves labels without such a prefix untouched', () => {
    expect(stripDimensionCode('Totaal')).toBe('Totaal');
    expect(stripDimensionCode('Alle kenmerken')).toBe('Alle kenmerken');
    expect(stripDimensionCode('Noord-Holland (PV)')).toBe('Noord-Holland (PV)');
  });
  it('does not touch labels that only LOOK numeric: years, ranges, short codes, letter codes', () => {
    expect(stripDimensionCode('2024')).toBe('2024');
    expect(stripDimensionCode('15 tot 25 jaar')).toBe('15 tot 25 jaar');
    expect(stripDimensionCode('65 jaar of ouder')).toBe('65 jaar of ouder');
    expect(stripDimensionCode('GM0363 Amsterdam')).toBe('GM0363 Amsterdam');
    expect(stripDimensionCode('T001036 Totaal')).toBe('T001036 Totaal');
  });
  it('never returns an empty label', () => {
    expect(stripDimensionCode('000000')).toBe('000000');
    expect(stripDimensionCode('000000 ')).toBe('000000 ');
    expect(stripDimensionCode('')).toBe('');
  });
});
