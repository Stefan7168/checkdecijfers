// WP218 phase 4 (#219) — server-only language resolution: cookie first,
// Accept-Language second, Dutch otherwise
// (docs/superpowers/specs/2026-09-09-language-switch-design.md §2.3-2.4).
// `next/headers` makes this module server-only by construction (imported
// only from app/layout.tsx and Server Components).
import { cookies, headers } from 'next/headers';
import { isLang, type Lang } from './messages.ts';

export const LANG_COOKIE = 'lang';

// Pure and exported separately so it can be unit-tested without touching
// next/headers at all.
export function langFromAcceptLanguage(header: string | null): Lang {
  if (!header) return 'nl';

  const entries = header.split(',').map((part) => {
    const [rawTag, ...params] = part.trim().split(';');
    const tag = (rawTag ?? '').trim().toLowerCase();
    const qParam = params.find((param) => param.trim().toLowerCase().startsWith('q='));
    const q = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1;
    return { tag, q: Number.isFinite(q) ? q : 1 };
  });

  const bestQFor = (prefix: string): number =>
    entries.reduce((best, { tag, q }) => (tag === prefix || tag.startsWith(`${prefix}-`) ? Math.max(best, q) : best), -1);

  // English only when the browser genuinely ranks it above Dutch — a tie,
  // or neither present, keeps the Dutch default (design §2.3).
  return bestQFor('en') > bestQFor('nl') ? 'en' : 'nl';
}

export async function getLang(): Promise<Lang> {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(LANG_COOKIE)?.value;
  if (isLang(cookieValue)) return cookieValue;

  const headerStore = await headers();
  return langFromAcceptLanguage(headerStore.get('accept-language'));
}
