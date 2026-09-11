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
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { WandSparkles } from 'lucide-react';
import Link from 'next/link';
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
  /** Task 5 (Story-stage plan): opens the full Story stage. Undefined
   * renders no Present button at all — chart.tsx passes it only when this
   * chart itself isn't already the stage (a stage never opens a stage). */
  onPresent?(): void;
  /** R5 item 3 (experience-improvement-plan, session 96): true when the last
   * generateInsights call came back `{ ok: false, reason: 'unauthenticated' }`
   * — an anonymous visitor, not a transient error. Undefined/false renders
   * nothing extra, byte-identical to before this prop existed. */
  needsLoginForAi?: boolean;
}

export function ChartStoryPanel({
  steps,
  index,
  onIndexChange,
  open,
  onClose,
  triggerId,
  idPrefix,
  lang = 'nl',
  onPresent,
  needsLoginForAi = false,
}: ChartStoryPanelProps): ReactNode {
  const regionRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);
  // True while a button/dot/key is scrolling a card into view, so the
  // observer's intermediate intersections don't fight the chosen step. A
  // smooth scroll can take longer than any fixed timeout, so the guard is
  // settle-based: it lifts 150 ms after the LAST scroll event (or at once on
  // 'scrollend' where supported), with a 1500 ms hard cap in case no scroll
  // event ever fires (e.g. the card is already in view).
  const programmatic = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardCapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollHandlerRef = useRef<(() => void) | null>(null);
  const scrollendHandlerRef = useRef<(() => void) | null>(null);
  // Latest index/onIndexChange for the observer effect below, which
  // subscribes only once per open (see that effect's comment).
  const indexRef = useRef(index);
  const onIndexChangeRef = useRef(onIndexChange);
  const regionId = `${idPrefix}-story`;
  const headingId = `${idPrefix}-story-heading`;
  const last = steps.length - 1;

  // Final-review fix: these two used to be plain assignments right here,
  // during the render phase. Moved into their own dependency-free Effect —
  // runs synchronously on commit (layout phase), strictly before the observer
  // effect's own callback could ever fire (Effects commit in declaration
  // order) — so the refs the observer reads are never assigned mid-render.
  useLayoutEffect(() => {
    indexRef.current = index;
    onIndexChangeRef.current = onIndexChange;
  });

  function clearProgrammaticGuard(): void {
    programmatic.current = false;
    if (settleTimer.current) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
    if (hardCapTimer.current) {
      clearTimeout(hardCapTimer.current);
      hardCapTimer.current = null;
    }
    const area = scrollRef.current;
    if (area) {
      if (scrollHandlerRef.current) area.removeEventListener('scroll', scrollHandlerRef.current);
      if (scrollendHandlerRef.current) area.removeEventListener('scrollend', scrollendHandlerRef.current);
    }
    scrollHandlerRef.current = null;
    scrollendHandlerRef.current = null;
  }

  function armProgrammaticGuard(): void {
    const area = scrollRef.current;
    // Only one scroll listener at a time — drop the previous one (if any)
    // before wiring the fresh one for this scroll.
    if (area) {
      if (scrollHandlerRef.current) area.removeEventListener('scroll', scrollHandlerRef.current);
      if (scrollendHandlerRef.current) area.removeEventListener('scrollend', scrollendHandlerRef.current);
    }
    programmatic.current = true;

    function armSettleTimer(): void {
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(clearProgrammaticGuard, 150);
    }
    armSettleTimer();

    const onScroll = (): void => armSettleTimer();
    scrollHandlerRef.current = onScroll;
    area?.addEventListener('scroll', onScroll);

    if (typeof window !== 'undefined' && 'onscrollend' in window) {
      const onScrollEnd = (): void => clearProgrammaticGuard();
      scrollendHandlerRef.current = onScrollEnd;
      area?.addEventListener('scrollend', onScrollEnd, { once: true });
    }

    if (hardCapTimer.current) clearTimeout(hardCapTimer.current);
    hardCapTimer.current = setTimeout(clearProgrammaticGuard, 1500);
  }

  function go(next: number): void {
    const clamped = Math.max(0, Math.min(last, next));
    if (clamped === index) return;
    onIndexChange(clamped);
    const card = cardRefs.current[clamped];
    if (card && typeof card.scrollIntoView === 'function') {
      armProgrammaticGuard();
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
  // scroll area wins. jsdom has no IntersectionObserver — the buttons cover
  // it. Subscribed once per open (not on every step) — the callback reads
  // indexRef/onIndexChangeRef so it always sees the latest values without
  // tearing the observer down and rebuilding it on each step.
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
        if (best && best.ratio >= 0.5 && best.i !== indexRef.current) onIndexChangeRef.current(best.i);
      },
      { root: scrollRef.current, threshold: [0.5, 0.75, 1] },
    );
    for (const card of cardRefs.current) if (card) observer.observe(card);
    return () => observer.disconnect();
  }, [open, steps.length]);

  // Clear any pending programmatic-scroll guard (timers + listeners) on
  // unmount and whenever the panel closes.
  useEffect(() => {
    return () => clearProgrammaticGuard();
  }, [open]);

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
      {/* R5 item 3 (experience-improvement-plan, session 96): a real reason
        * to sign up that was previously invisible — an anonymous visitor's
        * generateInsights call fails closed to these same deterministic
        * captions with no indication a logged-in visitor gets AI prose. */}
      {needsLoginForAi ? (
        <p className="mt-1 text-xs text-muted-foreground">
          <Link href="/login" className="underline">
            {t(lang, 'chart.story.loginForAi')}
          </Link>
        </p>
      ) : null}
      <div ref={scrollRef} className="mt-2 max-h-40 space-y-2 overflow-y-auto pr-1">
        {/* Final-review fix (a11y): no `onClick` here — the Vorige/Volgende
          * buttons and the dots below already reach every step, so a
          * non-focusable, clickable `<article>` was a keyboard trap risk
          * (a sighted mouse user could click a card no keyboard user could
          * ever "click" the same way). */}
        {steps.map((step, i) => (
          <article
            key={step.id}
            ref={(el) => {
              cardRefs.current[i] = el;
            }}
            data-story-step={i}
            aria-current={i === index ? 'step' : undefined}
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
        {onPresent ? (
          <Button type="button" variant="outline" size="sm" id={`${idPrefix}-story-present`} onClick={onPresent}>
            {t(lang, 'chart.stage.present')}
          </Button>
        ) : null}
        <ol aria-label={t(lang, 'chart.story.stepsLabel')} className="ml-auto flex items-center gap-1">
          {steps.map((step, i) => (
            <li key={step.id}>
              {/* Final-review fix (a11y): a bare size-2.5 (10px) dot was
                * below the ~24px minimum touch/click target — the button
                * itself now reserves a size-6 (24px) hit area, with the
                * small coloured dot as an inner, non-interactive span. */}
              <button
                type="button"
                aria-label={step.title}
                aria-current={i === index ? 'step' : undefined}
                onClick={() => go(i)}
                className="flex size-6 items-center justify-center"
              >
                <span className={'block size-2.5 rounded-full ' + (i === index ? 'bg-foreground' : 'bg-border hover:bg-muted-foreground')} />
              </button>
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
