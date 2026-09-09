'use client';
// Story mode (session 92 design, docs/superpowers/specs/
// 2026-09-09-story-mode-and-embed-design.md Part A): the colourful trigger
// and the story panel. Both are DUMB and CONTROLLED — chart.tsx owns
// open/index (exactly like the Style panel), builds the steps
// (web/lib/chart-story.ts) and reacts to the index (highlight, point ring).
//
// The panel renders one card per step in a fixed-height scroll area; the
// card nearest the area's centre becomes the active step (IntersectionObserver,
// absent under jsdom — the buttons, dots and arrow keys drive the same
// `onIndexChange`). No "step N of M" text anywhere: the dotted list carries
// the position, so the card's whole-text digit scans stay exemption-free.
// House ARIA: role="region", aria-expanded/aria-controls on the trigger,
// Escape closes and refocuses the trigger.
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { WandSparkles } from 'lucide-react';
import type { StoryStep } from '../lib/chart-story.ts';
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

export interface ChartStoryPanelProps {
  steps: StoryStep[];
  index: number;
  onIndexChange(index: number): void;
  open: boolean;
  onClose(): void;
  triggerId: string;
  idPrefix: string;
  lang?: Lang;
}

export function ChartStoryPanel({ steps, index, onIndexChange, open, onClose, triggerId, idPrefix, lang = 'nl' }: ChartStoryPanelProps): ReactNode {
  const regionRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);
  // True while a button/dot/key is scrolling a card into view, so the
  // observer's intermediate intersections don't fight the chosen step.
  const programmatic = useRef<ReturnType<typeof setTimeout> | null>(null);
  const regionId = `${idPrefix}-story`;
  const headingId = `${idPrefix}-story-heading`;
  const last = steps.length - 1;

  function go(next: number): void {
    const clamped = Math.max(0, Math.min(last, next));
    if (clamped === index) return;
    onIndexChange(clamped);
    const card = cardRefs.current[clamped];
    if (card && typeof card.scrollIntoView === 'function') {
      if (programmatic.current) clearTimeout(programmatic.current);
      programmatic.current = setTimeout(() => {
        programmatic.current = null;
      }, 500);
      const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      card.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    }
  }

  function closeAndRefocus(): void {
    onClose();
    document.getElementById(triggerId)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAndRefocus();
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      go(index + 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      go(index - 1);
    }
  }

  // Focus the region on open so arrow keys work at once (the trigger keeps
  // focus otherwise); not a focus trap — Tab leaves normally.
  useEffect(() => {
    if (open) regionRef.current?.focus();
  }, [open]);

  // Scroll-driven steps: the card with the largest visible share of the
  // scroll area wins. jsdom has no IntersectionObserver — the buttons cover it.
  useEffect(() => {
    if (!open || typeof IntersectionObserver === 'undefined' || !scrollRef.current) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (programmatic.current) return;
        let best: { i: number; ratio: number } | null = null;
        for (const entry of entries) {
          const i = Number((entry.target as HTMLElement).dataset.storyStep);
          if (!Number.isInteger(i)) continue;
          if (!best || entry.intersectionRatio > best.ratio) best = { i, ratio: entry.intersectionRatio };
        }
        if (best && best.ratio >= 0.5 && best.i !== index) onIndexChange(best.i);
      },
      { root: scrollRef.current, threshold: [0.5, 0.75, 1] },
    );
    for (const card of cardRefs.current) if (card) observer.observe(card);
    return () => observer.disconnect();
  }, [open, index, onIndexChange, steps.length]);

  if (!open) return null;

  return (
    <section
      ref={regionRef}
      id={regionId}
      role="region"
      aria-labelledby={headingId}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="mt-3 rounded-lg border border-border bg-card p-3 text-card-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={headingId} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <WandSparkles aria-hidden="true" className="size-3.5" />
          {t(lang, 'chart.story.regionLabel')}
        </span>
        <span className="text-xs text-muted-foreground">{t(lang, 'chart.story.hint')}</span>
      </div>
      <div ref={scrollRef} className="mt-2 max-h-40 space-y-2 overflow-y-auto pr-1">
        {steps.map((step, i) => (
          <article
            key={step.id}
            ref={(el) => {
              cardRefs.current[i] = el;
            }}
            data-story-step={i}
            aria-current={i === index ? 'step' : undefined}
            onClick={() => go(i)}
            className={
              'rounded-md border px-3 py-2 transition-colors ' +
              (i === index ? 'border-foreground/40 bg-muted' : 'border-border bg-background text-muted-foreground')
            }
          >
            <p className="text-sm font-medium text-foreground">{step.title}</p>
            <p className="mt-0.5 text-sm">{step.caption}</p>
          </article>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={index <= 0} onClick={() => go(index - 1)}>
          {t(lang, 'chart.story.prev')}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={index >= last} onClick={() => go(index + 1)}>
          {t(lang, 'chart.story.next')}
        </Button>
        <ol aria-label={t(lang, 'chart.story.stepsLabel')} className="ml-auto flex items-center gap-1">
          {steps.map((step, i) => (
            <li key={step.id}>
              <button
                type="button"
                aria-label={step.title}
                aria-current={i === index ? 'step' : undefined}
                onClick={() => go(i)}
                className={'block size-2.5 rounded-full ' + (i === index ? 'bg-foreground' : 'bg-border hover:bg-muted-foreground')}
              />
            </li>
          ))}
        </ol>
        <Button type="button" variant="ghost" size="sm" onClick={closeAndRefocus}>
          {t(lang, 'chart.story.close')}
        </Button>
      </div>
    </section>
  );
}
