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
import { SlidersHorizontal } from 'lucide-react';
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
}

export function ChartConfigTrigger({
  open,
  onToggle,
  controlsId,
  triggerId,
  lang = 'nl',
  compact = false,
}: ChartConfigTriggerProps): ReactNode {
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
