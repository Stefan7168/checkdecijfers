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
