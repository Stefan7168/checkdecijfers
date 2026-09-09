// WP218 phase 4 (#219): the catalogue's own pure helpers — placeholder
// filling, the nl fallback, and the isLang guard.
import { describe, expect, it } from 'vitest';
import { isLang, MESSAGES, t, type Lang } from './messages.ts';

describe('t()', () => {
  it('fills a {name} placeholder from vars', () => {
    expect(t('nl', 'header.balance', { n: 42 })).toBe('42 credits');
    expect(t('en', 'header.balance', { n: 7 })).toBe('7 credits');
  });

  it('returns the template unchanged when no vars are given', () => {
    expect(t('nl', 'header.credits')).toBe('Credits kopen');
    expect(t('en', 'header.credits')).toBe('Buy credits');
  });

  it('leaves an unmatched placeholder in place', () => {
    expect(t('nl', 'header.balance', {})).toBe('{n} credits');
  });

  it('falls back to nl for an unrecognised lang', () => {
    const bogus = 'fr' as Lang;
    expect(t(bogus, 'header.credits')).toBe(MESSAGES.nl['header.credits']);
  });
});

describe('isLang()', () => {
  it('accepts nl and en only', () => {
    expect(isLang('nl')).toBe(true);
    expect(isLang('en')).toBe(true);
    expect(isLang('fr')).toBe(false);
    expect(isLang(undefined)).toBe(false);
    expect(isLang(null)).toBe(false);
    expect(isLang(42)).toBe(false);
  });
});

// Design §3: "one catalogue test: every `en` key exists (type-level) and no
// value in either language contains a digit unless the Dutch original did".
// The `Messages` type already makes a missing/extra `en` key a COMPILE
// error (messages.ts's own header) — this is the same guarantee enforced at
// RUNTIME too, so a build that skips typechecking (or a future refactor that
// loosens the type) still catches drift. The digit rule matters because the
// chart card's whole-card digit scans (chart.test.tsx) only ever check
// numbers are BOUND to a spec string — they never police whether a
// TRANSLATION quietly introduced a new number that reads as a CBS figure.
describe('MESSAGES — catalogue-wide invariants', () => {
  it('every nl key has an en key and vice versa (runtime mirror of the Messages type)', () => {
    const nlKeys = Object.keys(MESSAGES.nl).sort();
    const enKeys = Object.keys(MESSAGES.en).sort();
    expect(enKeys).toEqual(nlKeys);
  });

  it('no en value contains a digit unless the matching nl value does', () => {
    for (const key of Object.keys(MESSAGES.nl) as (keyof typeof MESSAGES.nl)[]) {
      const nlHasDigit = /\d/.test(MESSAGES.nl[key]);
      const enHasDigit = /\d/.test(MESSAGES.en[key]);
      if (enHasDigit) {
        expect(nlHasDigit, `en['${key}'] has a digit nl['${key}'] does not: ${JSON.stringify(MESSAGES.en[key])}`).toBe(true);
      }
    }
  });
});
