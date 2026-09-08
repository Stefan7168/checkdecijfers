// WP218 phase 4 (#219) — the NL | EN switch, the theme toggle's own
// role="group" + aria-pressed segment pattern (theme-toggle.tsx). Clicking
// writes the cookie via the server action, then router.refresh() re-renders
// the tree in the new language — no full page reload (design §2.5).
'use client';

import { useRouter } from 'next/navigation';
import { setLanguage } from '../app/lang-actions.ts';
import { useLang, useT } from '../lib/i18n/lang-provider.tsx';
import { LANGS, type Lang } from '../lib/i18n/messages.ts';
import { cn } from '../lib/utils.ts';

export function LanguageSwitch({ className }: { className?: string }) {
  const lang = useLang();
  const t = useT();
  const router = useRouter();

  async function handleClick(next: Lang) {
    await setLanguage(next);
    router.refresh();
  }

  return (
    <div
      role="group"
      aria-label={t('lang.switchLabel')}
      className={cn('inline-flex items-center gap-px rounded-lg border border-border p-0.5', className)}
    >
      {LANGS.map((value) => {
        const active = lang === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            onClick={() => {
              void handleClick(value);
            }}
            className={cn(
              'inline-flex h-6 min-w-7 items-center justify-center rounded-md px-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
              active && 'bg-secondary text-foreground',
            )}
          >
            {value.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
