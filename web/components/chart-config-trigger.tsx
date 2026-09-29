'use client';
// Split out of chart-config-panel.tsx (session 110, perf pass second
// attempt — docs/session-briefs/2026-09-13-build-performance-diagnosis.md,
// "Landing bundle" section). chart.tsx needs the always-visible Style
// trigger button available synchronously (it's part of the chart card's
// first paint), while the actual panel (chart-config-panel.tsx, 1900+
// lines) is lazy-loaded via next/dynamic — but a component can only be
// code-split away from a module if NOTHING in that module is also imported
// statically from the same importer. Splitting the trigger into its own
// tiny file is what lets chart.tsx hold zero static import edges into
// chart-config-panel.tsx. Re-exported from chart-config-panel.tsx unchanged
// (see that file's own re-export line) so the existing
// chart-config-panel.test.tsx import keeps resolving.
import type { ReactNode } from 'react';
import { Pencil, SlidersHorizontal } from 'lucide-react';
import { EDIT_ACTION_ICON_CLASS } from '../lib/chart-action-row.ts';
import { t, type Lang } from '../lib/i18n/messages.ts';
import { Button } from './ui/button.tsx';

export interface ChartConfigTriggerProps {
  open: boolean;
  onToggle: () => void;
  controlsId: string;
  triggerId: string;
  lang?: Lang;
  /** Chart-card polish (2026-09-15): icon-only rendering for the card's
   * header — the label moves into `aria-label` + `title` (same catalogue
   * string, so the accessible name is unchanged) and the button takes the
   * 44 px phone tap target (R9.1) via `max-sm:size-11`. Default false =
   * the text button every existing harness/test renders, byte-identical. */
  compact?: boolean;
  /** WP-LOOK part (a) (session 142, ADR 063): the card's ONE primary action,
   * "Edit" — a filled button with a pencil that opens the popup holding
   * every reader control (form, period, style, notes, co-pilot …), not only
   * the Style panel this trigger used to name. Same id/aria wiring as the
   * other two renderings, so focus-return and `aria-controls` are unchanged.
   * Default false = the two existing renderings, byte-identical. */
  edit?: boolean;
}

export function ChartConfigTrigger({
  open,
  onToggle,
  controlsId,
  triggerId,
  lang = 'nl',
  compact = false,
  edit = false,
}: ChartConfigTriggerProps): ReactNode {
  if (edit) {
    return (
      <Button id={triggerId} type="button" variant="default" size="sm" aria-expanded={open} aria-controls={controlsId} onClick={onToggle}>
        {/* Round 2 (session 143): the pencil goes on the phone card
          * (< 20rem action row), the word never does — see
          * web/lib/chart-action-row.ts for the measured tiers. */}
        <Pencil aria-hidden="true" className={EDIT_ACTION_ICON_CLASS} />
        {t(lang, 'chart.edit.trigger')}
      </Button>
    );
  }
  const label = t(lang, 'chart.panel.trigger');
  if (compact) {
    return (
      <Button
        id={triggerId}
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={controlsId}
        onClick={onToggle}
        className="max-sm:size-11"
      >
        <SlidersHorizontal aria-hidden="true" />
      </Button>
    );
  }
  return (
    <Button id={triggerId} type="button" variant="ghost" size="sm" aria-expanded={open} aria-controls={controlsId} onClick={onToggle}>
      <SlidersHorizontal aria-hidden="true" />
      {label}
    </Button>
  );
}
