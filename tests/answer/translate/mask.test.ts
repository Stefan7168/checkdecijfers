import { describe, expect, it } from 'vitest';
import { parseNlNumber } from '../../../src/answer/compose/format.ts';
import {
  createMasker,
  fillPlaceholders,
  hasDigitOutsidePlaceholders,
  parseEnNumber,
  toEnglishNumberToken,
} from '../../../src/answer/translate/mask.ts';

describe('toEnglishNumberToken', () => {
  it.each([
    ['18.044.027', '18,044,027'],
    ['3,3', '3.3'],
    ['1.234,5', '1,234.5'],
    ['2024', '2024'],
    ['-24', '-24'],
    ['-1.234,56', '-1,234.56'],
    ['000', '000'],
  ])('%s -> %s', (nl, en) => {
    expect(toEnglishNumberToken(nl)).toBe(en);
  });

  it('keeps the value identical for every generated token (round trip)', () => {
    for (let i = 0; i < 2000; i++) {
      const value = (Math.random() - 0.3) * 10 ** Math.floor(Math.random() * 9);
      const decimals = Math.floor(Math.random() * 4);
      const fixed = Math.abs(value).toFixed(decimals);
      const [int, frac] = fixed.split('.');
      const nl = (value < 0 ? '-' : '') + int!.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (frac ? `,${frac}` : '');
      expect(parseEnNumber(toEnglishNumberToken(nl))).toBe(parseNlNumber(nl));
    }
  });
});

describe('createMasker', () => {
  const masker = () =>
    createMasker({
      periodLabels: [
        { dutch: '2023 1e kwartaal', english: '2023 Q1' },
        { dutch: '2023', english: '2023' },
      ],
      caveats: [
        { dutch: ' (nader voorlopig cijfer)', english: ' (revised provisional figure)' },
        { dutch: ' (voorlopig cijfer)', english: ' (provisional figure)' },
      ],
    });

  it('masks periods (longest first), caveats and numbers; leaves no digit', () => {
    const m = masker();
    const out = m.mask('In 2023 1e kwartaal had Utrecht 1.234,5 x 1 000 inwoners (voorlopig cijfer), in 2023 3,5%.');
    expect(hasDigitOutsidePlaceholders(out)).toBe(false);
    expect(out).not.toMatch(/\d/);
    expect(m.entries.filter((e) => e.kind === 'period').map((e) => e.dutch)).toEqual(['2023 1e kwartaal', '2023']);
    expect(m.entries.filter((e) => e.kind === 'caveat')).toHaveLength(1);
    // Final-review fix wave (ruling 17a): '3,5%' — the '%' is masked WITH its number.
    expect(m.entries.filter((e) => e.kind === 'number').map((e) => e.dutch)).toEqual(['1.234,5', '1', '000', '3,5%']);
  });

  it('gives unique placeholders across calls on the same masker', () => {
    const m = masker();
    const a = m.mask('3,5');
    const b = m.mask('3,5');
    expect(a).not.toBe(b);
  });

  it('fills back in English notation', () => {
    const m = masker();
    const masked = m.mask('Utrecht had 1.234,5 inwoners (voorlopig cijfer) in 2023.');
    expect(fillPlaceholders(masked, m.entries)).toBe('Utrecht had 1,234.5 inwoners (provisional figure) in 2023.');
  });

  it('treats a fullwidth digit as a digit', () => {
    expect(hasDigitOutsidePlaceholders('abc ９')).toBe(true);
    expect(hasDigitOutsidePlaceholders('⟦Na⟧ ⟦Pb⟧')).toBe(false);
  });
});

describe('createMasker — names (ruling 9, Task 6 fix round 1)', () => {
  it('masks a digit-bearing name WHOLE, before it can be sliced up by period/number scanning', () => {
    const m = createMasker({
      names: [{ dutch: 'Bevolking op 1 januari', english: 'Population on 1 January' }],
      periodLabels: [{ dutch: '2023', english: '2023' }],
      caveats: [],
    });
    const out = m.mask('Bevolking op 1 januari in Nederland was in 2023 1.234.');
    expect(hasDigitOutsidePlaceholders(out)).toBe(false);
    // Exactly one 'name' entry, covering the WHOLE phrase (not split into a
    // separate '1' number placeholder plus leftover text) — its own '1'
    // never becomes an independent number placeholder.
    const nameEntries = m.entries.filter((e) => e.kind === 'name');
    expect(nameEntries).toHaveLength(1);
    expect(nameEntries[0]!.dutch).toBe('Bevolking op 1 januari');
    expect(nameEntries[0]!.english).toBe('Population on 1 January');
    expect(m.entries.filter((e) => e.kind === 'number').map((e) => e.dutch)).toEqual(['1.234']);
    expect(m.entries.filter((e) => e.kind === 'period').map((e) => e.dutch)).toEqual(['2023']);
    expect(fillPlaceholders(out, m.entries)).toBe('Population on 1 January in Nederland was in 2023 1,234.');
  });

  it('is exact and case-sensitive: a differently-cased occurrence is left to ordinary number masking', () => {
    const m = createMasker({
      names: [{ dutch: 'Bevolking op 1 januari', english: 'Population on 1 January' }],
      periodLabels: [],
      caveats: [],
    });
    const out = m.mask('bevolking op 1 januari');
    expect(m.entries.filter((e) => e.kind === 'name')).toHaveLength(0);
    expect(m.entries.filter((e) => e.kind === 'number').map((e) => e.dutch)).toEqual(['1']);
    expect(out).toBe('bevolking op ⟦Na⟧ januari');
  });

  it('createMasker without `names` behaves exactly as before (optional, defaults to none)', () => {
    const m = createMasker({ periodLabels: [{ dutch: '2023', english: '2023' }], caveats: [] });
    expect(m.mask('in 2023')).toBe('in ⟦Pa⟧');
  });
});
