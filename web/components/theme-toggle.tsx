// Session 87 visual redesign (mockup Option B): the three-way light / dark /
// system segment in the chat card's header bar. Presentation only — the
// choice lives in next-themes (localStorage), never on the server.
'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';
import { useT } from '../lib/i18n/lang-provider.tsx';
import { cn } from '../lib/utils.ts';

// WP218 phase 4 (#219): the labels were English-only before this sweep — the
// design's "Dutch entries are today's strings verbatim" rule doesn't apply
// here (there were no Dutch strings yet), so nl gets NEW Dutch copy and the
// English text below moves into the en catalogue (design §3).
const OPTIONS = [
  { value: 'light', msgKey: 'themeToggle.light', Icon: Sun },
  { value: 'dark', msgKey: 'themeToggle.dark', Icon: Moon },
  { value: 'system', msgKey: 'themeToggle.system', Icon: Monitor },
] as const;

// The stored theme is only known on the client; until hydration finishes no
// option is marked active, so server and first client render agree.
const subscribe = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const t = useT();
  const current = mounted ? (theme ?? 'system') : null;
  return (
    <div
      role="group"
      aria-label={t('themeToggle.groupLabel')}
      className={cn('inline-flex items-center gap-px rounded-lg border border-border p-0.5', className)}
    >
      {OPTIONS.map(({ value, msgKey, Icon }) => {
        const label = t(msgKey);
        const active = current === value;
        return (
          <button
            key={value}
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={active}
            onClick={() => setTheme(value)}
            className={cn(
              // R9.1 (#238): 24px tall was under the 44px minimum tap target
              // at 375px; `h-11 sm:h-6` widens it only below `sm`, so the
              // desktop control stays pixel-identical to before.
              'inline-flex h-11 sm:h-6 w-11 sm:w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
              active && 'bg-secondary text-foreground',
            )}
          >
            <Icon aria-hidden="true" className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
