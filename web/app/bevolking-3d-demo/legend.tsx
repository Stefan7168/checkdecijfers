'use client';
// ADR 049 v2 (D3′, session 104): a floating legend card INSIDE the canvas
// wrapper — replaces the old below-canvas gradient bar. Domain labels are
// computed from scales.ts's own GROWTH_DOMAIN, never hardcoded (D6: the two
// swatch colours are the existing GROWTH_LOW_HEX/GROWTH_HIGH_HEX, no new
// colour literal). Every digit sits under data-fictional="true" — D7's
// digit-scan (map3d.test.tsx) walks this subtree too, so a miss here fails
// loudly rather than silently.
import type { ReactNode } from 'react';
import { t, type Lang } from '../../lib/i18n/messages.ts';
import { useMediaQuery } from '../../lib/use-media-query.ts';
import { formatGrowth, GROWTH_DOMAIN, GROWTH_HIGH_HEX, GROWTH_LOW_HEX } from './scales.ts';

export function Legend({ lang }: { lang: Lang }): ReactNode {
  const compact = useMediaQuery('(max-width: 640px)');
  const low = formatGrowth(-GROWTH_DOMAIN, lang);
  const high = formatGrowth(GROWTH_DOMAIN, lang);

  return (
    <div
      data-legend="true"
      className={`pointer-events-none absolute right-2 top-2 z-10 rounded-md border border-border bg-card/90 text-card-foreground shadow-sm backdrop-blur-sm ${compact ? 'max-w-[9rem] p-2 text-[10px]' : 'max-w-[13rem] p-3 text-xs'}`}
    >
      <p className="font-semibold uppercase tracking-wide text-muted-foreground">{t(lang, 'lab3d.growth')}</p>
      <div aria-hidden="true" className="mt-1.5 h-2 w-full rounded" style={{ background: `linear-gradient(90deg, ${GROWTH_LOW_HEX}, transparent 50%, ${GROWTH_HIGH_HEX})` }} />
      <p data-fictional="true" className="tnum mt-1 flex items-center justify-between gap-1">
        <span>{low}</span>
        <span>{high}</span>
      </p>
      <p className="mt-0.5 flex items-center justify-between gap-1 text-muted-foreground">
        <span>{t(lang, 'lab3d.legendLow')}</span>
        <span>{t(lang, 'lab3d.legendHigh')}</span>
      </p>
      {!compact ? <p className="mt-2 border-t border-border pt-1.5 text-muted-foreground">{t(lang, 'lab3d.heightNote')}</p> : null}
    </div>
  );
}
