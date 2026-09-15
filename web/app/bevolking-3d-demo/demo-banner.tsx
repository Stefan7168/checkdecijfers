// ADR 049: the always-on "this is fiction" label. Deliberately a plain
// component with NO 'use client' and NO prop other than `lang`, rendered by
// the PAGE (server) above the 3D loader — it is in the HTML before any
// JavaScript runs and survives a failed or slow 3D chunk. map3d.test.tsx
// pins that no prop exists that could hide it.
import type { ReactNode } from 'react';
import { t, type Lang } from '../../lib/i18n/messages.ts';

export function DemoBanner({ lang }: { lang: Lang }): ReactNode {
  return (
    <div role="note" data-demo-banner="true" className="rounded-md border-2 border-warning bg-warning/10 px-4 py-3 text-foreground">
      <strong className="block text-sm font-bold uppercase tracking-wide">{t(lang, 'lab3d.badge')}</strong>
      <span className="mt-1 block text-sm">{t(lang, 'lab3d.badgeDetail')}</span>
    </div>
  );
}
