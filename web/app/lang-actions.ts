// WP218 phase 4 (#219) — the language switch's one server action: writes the
// `lang` cookie the rest of the app reads via getLang(). One year,
// SameSite=Lax, path '/', NOT httpOnly (the client also reads it, e.g. the
// systeemoverzicht toggle's initial value) — design §2.2.
'use server';

import { cookies } from 'next/headers';
import { isLang } from '../lib/i18n/messages.ts';
import { LANG_COOKIE } from '../lib/i18n/server.ts';

export async function setLanguage(raw: unknown): Promise<void> {
  if (!isLang(raw)) return;

  const cookieStore = await cookies();
  cookieStore.set(LANG_COOKIE, raw, {
    maxAge: 31536000,
    sameSite: 'lax',
    path: '/',
  });
}
