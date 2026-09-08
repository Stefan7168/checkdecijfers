// WP218 phase 4 (#219): setLanguage's isLang guard and the exact cookie
// attributes (design §2.2) — maxAge one year, SameSite=Lax, path '/', no
// httpOnly key at all (so it stays readable client-side).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LANG_COOKIE } from '../lib/i18n/server.ts';
import { setLanguage } from './lang-actions.ts';

const { cookieSet } = vi.hoisted(() => ({ cookieSet: vi.fn() }));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ set: cookieSet })),
}));

afterEach(() => {
  cookieSet.mockReset();
});

describe('setLanguage()', () => {
  it('sets the lang cookie with the design-specified attributes', async () => {
    await setLanguage('en');

    expect(cookieSet).toHaveBeenCalledTimes(1);
    expect(cookieSet).toHaveBeenCalledWith(LANG_COOKIE, 'en', {
      maxAge: 31536000,
      sameSite: 'lax',
      path: '/',
    });
    const [, , options] = cookieSet.mock.calls[0]!;
    expect(options).not.toHaveProperty('httpOnly');
  });

  it('accepts nl too', async () => {
    await setLanguage('nl');
    expect(cookieSet).toHaveBeenCalledWith(LANG_COOKIE, 'nl', expect.any(Object));
  });

  it('ignores an invalid value and sets no cookie', async () => {
    await setLanguage('fr');
    await setLanguage(undefined);
    await setLanguage(42);
    expect(cookieSet).not.toHaveBeenCalled();
  });
});
