'use client';
// ADR 044: the Story stage — the Insights story as a full-viewport,
// scroll-driven presentation. A portal for POSITION only: open/index live in
// ChartView (like the compact panel). The chart is a second, chrome-less
// ChartView (stage mode) driven by the active step; every animated property
// is a transform/opacity on a wrapper OUTSIDE the exported svg (there is no
// export here anyway). Zero libraries: CSS 3D + useStageScroll.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { ChartSpec } from '../backend/chart/types.ts';
import { captionStyle, entranceStyle, spotlightStyle, STAGE_AUTOPLAY_MS } from '../lib/chart-stage.ts';
import type { PresentationOverrides } from '../lib/chart-presentation.ts';
import type { StoryStep } from '../lib/chart-story.ts';
import { t, type Lang } from '../lib/i18n/messages.ts';
import { useStageScroll } from '../lib/use-stage-scroll.ts';
import { ChartView } from './chart.tsx';
import { Button } from './ui/button.tsx';

export interface ChartStoryStageProps {
  open: boolean;
  spec: ChartSpec;
  steps: StoryStep[];
  index: number;
  onIndexChange(index: number): void;
  onClose(): void;
  /** Where focus returns on close. */
  triggerId: string;
  overrides: PresentationOverrides;
  lang?: Lang;
  /** Fired once each time auto-play is switched on. */
  onAutoplay?(): void;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (!mq) return undefined;
    const update = (): void => setReduced(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

export function ChartStoryStage({ open, spec, steps, index, onIndexChange, onClose, triggerId, overrides, lang = 'nl', onAutoplay }: ChartStoryStageProps): ReactNode {
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chartBoxRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<(HTMLElement | null)[]>([]);
  const reduced = useReducedMotion();
  const scroll = useStageScroll(scrollRef, panelRefs, steps.length, open);
  const [autoplay, setAutoplay] = useState(false);
  const [spot, setSpot] = useState<{ left: string; top: string } | null>(null);
  const last = steps.length - 1;
  const step = steps[index] ?? null;

  // Scroll position → step index (the hook only reports; the owner of the index is ChartView).
  useEffect(() => {
    if (open && scroll.index !== index) onIndexChange(scroll.index);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to the hook's index only
  }, [scroll.index]);

  // Open: focus the dialog, lock the page scroll; close: restore both.
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Spotlight: read the ringed marker ONCE per step change (never per frame).
  useLayoutEffect(() => {
    if (!open) return;
    const box = chartBoxRef.current;
    const ring = box?.querySelector<SVGCircleElement | SVGRectElement>('[data-story-marker]');
    if (!box || !ring) {
      setSpot(null);
      return;
    }
    const b = box.getBoundingClientRect();
    const r = ring.getBoundingClientRect();
    setSpot(spotlightStyle({ cx: r.left + r.width / 2 - b.left, cy: r.top + r.height / 2 - b.top }, { width: b.width, height: b.height }));
  }, [open, step?.id]);

  // Auto-play: advance every STAGE_AUTOPLAY_MS, stop at the end.
  useEffect(() => {
    if (!open || !autoplay) return undefined;
    if (index >= last) {
      setAutoplay(false);
      return undefined;
    }
    const id = setTimeout(() => go(index + 1), STAGE_AUTOPLAY_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `go` is stable per render for this purpose
  }, [open, autoplay, index, last]);

  function go(next: number): void {
    const clamped = Math.max(0, Math.min(last, next));
    if (clamped === index) return;
    onIndexChange(clamped);
    const panel = panelRefs.current[clamped];
    if (panel && typeof panel.scrollIntoView === 'function') {
      scroll.beginProgrammatic();
      panel.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    }
  }

  function closeAndRefocus(): void {
    setAutoplay(false);
    onClose();
    document.getElementById(triggerId)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAndRefocus();
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      setAutoplay(false);
      go(index + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1));
    }
  }

  function toggleAutoplay(): void {
    setAutoplay((on) => {
      if (!on) onAutoplay?.();
      return !on;
    });
  }

  if (!open || typeof document === 'undefined') return null;

  // The entry tilt runs over the FIRST step's progress only; from step two on the plane is flat.
  const entry = entranceStyle(index === 0 ? scroll.progress : 1, reduced);
  const chartOverrides = overrides;

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${t(lang, 'chart.stage.label')}: ${spec.title}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-50 bg-background text-foreground outline-none"
      data-story-stage="true"
    >
      <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
        <button
          type="button"
          aria-pressed={autoplay}
          onClick={toggleAutoplay}
          className="min-h-6 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-foreground hover:bg-muted aria-pressed:bg-secondary"
        >
          {t(lang, 'chart.stage.autoplay')}
        </button>
        <Button type="button" variant="ghost" size="sm" aria-label={t(lang, 'chart.stage.close')} onClick={closeAndRefocus}>
          <X aria-hidden="true" />
        </Button>
      </div>
      <div ref={scrollRef} className="h-full overflow-y-auto touch-pan-y lg:grid lg:grid-cols-[55%_45%]">
        {/* The pinned chart: sticky at the top of the scroller, the plane tilted on entry. */}
        <div className="sticky top-0 z-0 flex h-[45vh] items-center bg-background px-4 lg:h-screen lg:px-10">
          <div
            className="relative w-full rounded-xl bg-card p-4 text-card-foreground transition-[box-shadow] duration-300"
            style={{ transform: entry.transform, boxShadow: entry.boxShadow, transformStyle: 'preserve-3d', willChange: 'transform' }}
            data-stage-plane="true"
          >
            <div ref={chartBoxRef} className="relative">
              <ChartView spec={spec} stage={{ step, overrides: chartOverrides }} />
              {spot && !reduced ? (
                <div
                  aria-hidden="true"
                  data-stage-spotlight="true"
                  className="pointer-events-none absolute inset-0 rounded-lg"
                  style={{ background: `radial-gradient(circle at ${spot.left} ${spot.top}, transparent 0, transparent 22%, color-mix(in oklab, var(--card) 55%, transparent) 60%)` }}
                />
              ) : null}
            </div>
          </div>
        </div>
        {/* The steps: one full-height panel each; the scroll position picks the step. */}
        <div className="px-4 pb-[40vh] lg:px-10 lg:pt-[20vh]">
          <p className="mb-2 text-xs text-muted-foreground">{t(lang, 'chart.stage.scrollHint')}</p>
          <ol aria-label={t(lang, 'chart.stage.stepsLabel')} className="m-0 list-none p-0">
            {steps.map((s, i) => {
              const distance = i === index ? (i === last ? 0 : scroll.progress) : i === index + 1 ? 1 - scroll.progress : 1;
              const style = captionStyle(distance, reduced);
              return (
                <li
                  key={s.id}
                  ref={(el) => {
                    panelRefs.current[i] = el;
                  }}
                  data-stage-step={i}
                  aria-current={i === index ? 'step' : undefined}
                  className="flex min-h-[85vh] flex-col justify-center"
                >
                  <div className="max-w-md rounded-lg border border-border bg-card p-4" style={style}>
                    <p className="text-base font-semibold text-foreground">{s.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{s.caption}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      {/* Position dots — never "N of M". */}
      <ol aria-label={t(lang, 'chart.stage.stepsLabel')} className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1">
        {steps.map((s, i) => (
          <li key={s.id}>
            <button type="button" aria-label={s.title} aria-current={i === index ? 'step' : undefined} onClick={() => { setAutoplay(false); go(i); }} className="flex size-6 items-center justify-center">
              <span className={'block size-2.5 rounded-full ' + (i === index ? 'bg-foreground' : 'bg-border hover:bg-muted-foreground')} />
            </button>
          </li>
        ))}
      </ol>
    </div>,
    document.body,
  );
}
