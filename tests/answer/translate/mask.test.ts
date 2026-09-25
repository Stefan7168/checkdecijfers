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
    expect(m.entries.filter((e) => e.kind === 'number').map((e) => e.dutch)).toEqual(['1.234,5', '1', '000', '3,5']);
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
