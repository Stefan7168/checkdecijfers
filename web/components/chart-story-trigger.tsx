'use client';
// Split out of chart-story.tsx (session 110, perf pass second attempt —
// docs/session-briefs/2026-09-13-build-performance-diagnosis.md, "Landing
// bundle" section). Same reasoning as chart-config-trigger.tsx's own header:
// chart.tsx needs the always-visible Insights trigger button available
// synchronously, while ChartStoryPanel/ChartStoryStage are lazy-loaded via
// next/dynamic, which only works if chart.tsx holds no static import edge
// into chart-story.tsx. Re-exported from chart-story.tsx unchanged so the
// existing chart-story.test.tsx import keeps resolving.
import type { ReactNode } from 'react';
import { WandSparkles } from 'lucide-react';
import { t, type Lang } from '../lib/i18n/messages.ts';
import { Button } from './ui/button.tsx';

export interface ChartStoryTriggerProps {
  open: boolean;
  onToggle(): void;
  controlsId: string;
  triggerId: string;
  lang?: Lang;
}

/** The owner's ask: "a colourful border, with a magic wand … to show
 * something exciting will happen". The gradient lives on a 2 px wrapper;
 * the button itself paints the card colour so the ring reads as a border.
 * This is the one gradient in the product (12-huisstijl). */
export function ChartStoryTrigger({ open, onToggle, controlsId, triggerId, lang = 'nl' }: ChartStoryTriggerProps): ReactNode {
  return (
    <span
      className="inline-flex rounded-lg p-[2px]"
      style={{ background: 'linear-gradient(135deg, #7c3aed, #ec4899, #f59e0b)' }}
      data-story-trigger-ring="true"
    >
      <Button
        id={triggerId}
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={controlsId}
        onClick={onToggle}
        className="rounded-[6px] bg-card text-foreground hover:bg-muted aria-expanded:bg-muted"
      >
        <WandSparkles aria-hidden="true" />
        {t(lang, 'chart.story.trigger')}
      </Button>
    </span>
  );
}
