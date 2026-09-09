// WP218 phase 4 (#219): langFromAcceptLanguage is pure and gets the full
// table from the task brief; getLang() is exercised with next/headers
// mocked the way app/trial-actions.test.ts mocks it (cookies()/headers() as
// async factories returning a get()).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLang, LANG_COOKIE, langFromAcceptLanguage } from './server.ts';

const { cookieGet, headerGet } = vi.hoisted(() => ({
  cookieGet: vi.fn<(name: string) => { value: string } | undefined>(),
  headerGet: vi.fn<(name: string) => string | null>(),
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: cookieGet })),
  headers: vi.fn(async () => ({ get: headerGet })),
}));

afterEach(() => {
  cookieGet.mockReset();
  headerGet.mockReset();
});

describe('langFromAcceptLanguage()', () => {
  it.each([
    ['en-US,en;q=0.9,nl;q=0.8', 'en'],
    ['nl-NL,nl;q=0.9,en;q=0.8', 'nl'],
    [null, 'nl'],
    ['fr', 'nl'],
  ] as const)('%s -> %s', (header, expected) => {
    expect(langFromAcceptLanguage(header)).toBe(expected);
  });
});

describe('getLang()', () => {
  it('uses the lang cookie when it holds a valid value', async () => {
    cookieGet.mockReturnValue({ value: 'en' });
    await expect(getLang()).resolves.toBe('en');
    expect(cookieGet).toHaveBeenCalledWith(LANG_COOKIE);
    expect(headerGet).not.toHaveBeenCalled();
  });

  it('ignores a garbage cookie value and falls through to Accept-Language', async () => {
    cookieGet.mockReturnValue({ value: 'fr' });
    headerGet.mockReturnValue('en-US,en;q=0.9,nl;q=0.8');
    await expect(getLang()).resolves.toBe('en');
  });

  it('falls back to nl with no cookie and no Accept-Language match', async () => {
    cookieGet.mockReturnValue(undefined);
    headerGet.mockReturnValue(null);
    await expect(getLang()).resolves.toBe('nl');
  });
});
