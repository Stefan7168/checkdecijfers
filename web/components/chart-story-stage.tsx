'use client';
// ADR 044: the Story stage — the Insights story as a full-viewport,
// scroll-driven presentation. A portal for POSITION only: open/index live in
// ChartView (like the compact panel). The chart is a second, chrome-less
// ChartView (stage mode) driven by the active step; every animated property
// is a transform/opacity on a wrapper OUTSIDE the exported svg (there is no
// export here anyway). Zero libraries: CSS 3D + useStageScroll.
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
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

// useStageScroll's progress/entry state updates on nearly every rAF-throttled
// scroll frame while the reader is scrolling; without this wrapper, the
// inline `<ChartView spec={spec} stage={{ step, overrides }} />` below built a
// brand-new `stage` object every one of those ticks, and ChartView (a plain,
// unmemoized component) re-ran its full body — resolvePresentation, row/
// series-meta building, its own effects/ResizeObservers — on every tick
// instead of only on an actual step change. `spec`/`step`/`overrides` are
// each already stable across a scroll session (they only change on a real
// step transition), so a shallow-compared memo here is safe and correct: it
// changes nothing about what other ChartView callers do (this wrapper is
// local to the stage, ChartView itself is untouched).
const StageChart = memo(function StageChart({
  spec,
  step,
  overrides,
}: {
  spec: ChartSpec;
  step: StoryStep | null;
  overrides: PresentationOverrides;
}) {
  return <ChartView spec={spec} stage={{ step, overrides }} />;
});

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

// Fix round 1 (item A): focus containment for the `aria-modal` dialog.
// There is no `inert` on the rest of the page (cheapest mechanism, per the
// brief) — instead Tab/Shift+Tab wrap at the dialog's own edges.
const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// Fix round 2 (item 2): the depth effects are a DESKTOP-POINTER
// presentation, and ADR 044 decision 4 already says so — "Below `lg`, on
// `(hover: none)`, or with `prefers-reduced-motion: reduce`: no tilt, no
// shadow animation, instant step switches". Only the reduced-motion third of
// that ruling was actually implemented, so a phone still got the tilt, the
// lifting shadow and the vignette on top of a 50 vh chart. One "static"
// boolean now covers all three signals; `lg` is Tailwind's 1024 px.
const STATIC_MOTION_QUERIES = ['(prefers-reduced-motion: reduce)', '(hover: none)', '(max-width: 1023px)'];

function readStaticMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return STATIC_MOTION_QUERIES.some((query) => window.matchMedia(query)?.matches === true);
}

/** True when the stage must render statically: a flat plane, no spotlight,
 * instant step switches (what `prefers-reduced-motion` alone used to give).
 * The initial state is LAZY — the queries are read during the very first
 * render, so a phone or a reduced-motion reader never sees one tilted frame
 * before an effect corrects it. */
function useStageMotion(): boolean {
  const [isStatic, setIsStatic] = useState(readStaticMotion);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const lists = STATIC_MOTION_QUERIES.map((query) => window.matchMedia(query));
    const update = (): void => setIsStatic(lists.some((mq) => mq?.matches === true));
    update();
    for (const mq of lists) mq?.addEventListener?.('change', update);
    return () => {
      for (const mq of lists) mq?.removeEventListener?.('change', update);
    };
  }, []);
  return isStatic;
}

/** The plot box the vignette is confined to, in pixels relative to the chart
 * box (item 8: the overlay used to cover the whole card — title, legend and
 * attribution included — dimming the source line the honesty rules require
 * to stay readable). */
interface PlotBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function ChartStoryStage({ open, spec, steps, index, onIndexChange, onClose, triggerId, overrides, lang = 'nl', onAutoplay }: ChartStoryStageProps): ReactNode {
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chartBoxRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<(HTMLElement | null)[]>([]);
  const staticMotion = useStageMotion();
  const scroll = useStageScroll(scrollRef, panelRefs, steps.length, open);
  const [autoplay, setAutoplay] = useState(false);
  const [spot, setSpot] = useState<{ left: string; top: string } | null>(null);
  const [plot, setPlot] = useState<PlotBox | null>(null);
  // Fix round 2 (item 1): true once the reader has actually driven the
  // scroller with their own hands (wheel, touch, pointer, an unhandled key).
  // The hook's very first measurement after an open is ALWAYS index 0 — a
  // freshly mounted scroller sits at scrollTop 0 even when the stage opens at
  // step N — so an unguarded "the hook says 0, the prop says 2" sync would
  // drag the shared index straight back to the first finding on every open.
  const readerScrolled = useRef(false);
  const last = steps.length - 1;
  const step = steps[index] ?? null;

  // Scroll position → step index (the hook only reports; the owner of the
  // index is ChartView). Only honoured once the reader has scrolled — see
  // `readerScrolled` above; dots, arrow keys and auto-play set the index
  // through `go()` instead and never depend on this.
  useEffect(() => {
    if (open && readerScrolled.current && scroll.index !== index) onIndexChange(scroll.index);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to the hook's index only
  }, [scroll.index]);

  // Open: focus the dialog, lock the page scroll; close: restore both.
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    readerScrolled.current = false;
    // Fix round 2 (item 1): open AT the step the reader is on. Presenting
    // from finding three used to show panel one (the panels only moved on a
    // hook-reported index CHANGE), and re-opening after stepping through the
    // story reset it to the first finding. "Presenting never resets the
    // step" (chart.tsx) is now true of the panels too, not just the index.
    if (index > 0) {
      scroll.beginProgrammatic();
      panelRefs.current[index]?.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
    return () => {
      document.body.style.overflow = previous;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on open only; `index` is read as the step to open AT
  }, [open]);

  // Fix round 2 (item 10): auto-play never survives a close. It used to stay
  // switched on across close/re-open (the toggle is component state and the
  // component is not unmounted), so re-opening resumed advancing on its own.
  useEffect(() => {
    if (!open) setAutoplay(false);
  }, [open]);

  // Spotlight: read the ringed marker ONCE per step change (never per frame),
  // plus the plot box the vignette is confined to (item 8).
  const readSpot = useCallback((): void => {
    const box = chartBoxRef.current;
    const plotEl = box?.querySelector<HTMLElement>('[data-slot="chart-frame"]') ?? null;
    const ring = box?.querySelector<SVGCircleElement | SVGRectElement>('[data-story-marker]') ?? null;
    if (!box || !plotEl || !ring) {
      setSpot(null);
      setPlot(null);
      return;
    }
    const b = box.getBoundingClientRect();
    const p = plotEl.getBoundingClientRect();
    const r = ring.getBoundingClientRect();
    // Percentages are relative to the PLOT box, not the card: the overlay is
    // positioned over the plot alone, so its centre must be measured there.
    const centre = spotlightStyle(
      { cx: r.left + r.width / 2 - p.left, cy: r.top + r.height / 2 - p.top },
      { width: p.width, height: p.height },
    );
    setSpot(centre);
    setPlot(centre === null ? null : { left: p.left - b.left, top: p.top - b.top, width: p.width, height: p.height });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    readSpot();
  }, [open, step?.id, readSpot]);

  // Fix round 2 (item 5): Recharts measures its own size asynchronously, so
  // at the moment the layout effect above runs on OPEN the chart is often
  // still zero-sized and the marker not yet drawn — the first step of every
  // presentation came up without its vignette. A ResizeObserver on the chart
  // box re-runs the same read the instant the chart actually has a size (and
  // again on any later resize).
  useEffect(() => {
    if (!open || typeof ResizeObserver === 'undefined') return undefined;
    const box = chartBoxRef.current;
    if (!box) return undefined;
    const observer = new ResizeObserver(() => readSpot());
    observer.observe(box);
    return () => observer.disconnect();
  }, [open, readSpot]);

  // Fix round 2 (item 6): auto-play stops the moment the reader takes over —
  // ADR 044 decision 7 promises "stopping at the last or on any user
  // scroll/key", and only the key half existed. The same gesture also marks
  // the hook's index reports as reader-driven (item 1). Registered whenever
  // the stage is open rather than only while auto-play is on: one listener
  // set serves both jobs, and the updater is a no-op while auto-play is off.
  // Fix 3: a scrollbar-thumb drag fires only the `scroll` event, not
  // wheel/touch/pointer, so it was not guarded. The passive scroll listener
  // catches it too (the hook's mount-time measure is a direct call, not a
  // scroll event, so mount-time index-0 suppression stays intact).
  useEffect(() => {
    if (!open) return undefined;
    const el = scrollRef.current;
    if (!el) return undefined;
    // Shared by both listeners below so a later change to how auto-play is
    // stopped only has to be made once.
    const stopAutoplay = (): void => {
      readerScrolled.current = true;
      setAutoplay((on) => (on ? false : on));
    };
    const onReaderGesture = (): void => {
      stopAutoplay();
    };
    // `scroll` fires for the stage's OWN moves too — `go()` → `scrollIntoView`
    // (auto-play, dots, arrow keys) and the open-at-step scroll — so binding
    // it straight to the gesture handler switched auto-play off after its own
    // first advance (jsdom stubs `scrollIntoView`, which is why no test
    // caught it). Fix (this task): `useStageScroll` now exposes
    // `isProgrammatic()`, a live read of the same ref `beginProgrammatic()`
    // sets — true only while a scroll the STAGE itself caused has not yet
    // settled. A `scroll` event that is NOT programmatic — a scrollbar-thumb
    // drag included, which fires only this event and none of
    // wheel/touch/pointerdown — is the reader taking over, so it now also
    // stops auto-play (pinned by the two regression tests below). This
    // closes the common case of the scrollbar-drag gap ADR 044's as-built
    // section recorded as "accepted" — an ISOLATED drag, not overlapping an
    // in-flight programmatic scroll, now stops auto-play like any other
    // gesture. Residual (code-review finding, not fixed here — the ref this
    // reads has no way to attribute a `scroll` event to a CAUSE, only to a
    // time window): a drag that starts while a stage-caused scroll is still
    // settling — e.g. the reader grabs the thumb during auto-play's own
    // ~150ms+ settle window right after `go()` — keeps `isProgrammatic()`
    // true throughout (the drag's own events re-arm the same settle timer
    // the animation's tail was already re-arming, indistinguishably), so
    // auto-play is not stopped until the reader's drag pauses for 150ms.
    // Narrower than the original bug (which affected every scrollbar drag,
    // any time), not eliminated by it.
    const onAnyScroll = (): void => {
      readerScrolled.current = true;
      if (!scroll.isProgrammatic()) stopAutoplay();
    };
    el.addEventListener('wheel', onReaderGesture, { passive: true });
    el.addEventListener('touchmove', onReaderGesture, { passive: true });
    el.addEventListener('pointerdown', onReaderGesture, { passive: true });
    el.addEventListener('scroll', onAnyScroll, { passive: true });
    return () => {
      el.removeEventListener('wheel', onReaderGesture);
      el.removeEventListener('touchmove', onReaderGesture);
      el.removeEventListener('pointerdown', onReaderGesture);
      el.removeEventListener('scroll', onAnyScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `scroll.isProgrammatic` is stable across renders (it closes over a ref, not state); re-running this effect on every scroll-driven re-render would repeatedly detach/reattach the listeners.
  }, [open]);

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
      panel.scrollIntoView({ block: 'center', behavior: staticMotion ? 'auto' : 'smooth' });
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
      return;
    }
    // Fix round 2 (item 1): keys the stage does NOT handle (PageDown, Home,
    // End, Space) scroll the column natively — that is the reader driving,
    // so the hook's index reports become authoritative from here on. Also
    // stop auto-play here (ADR 044 decision 7 / #236(g): "stops on any user
    // scroll/key") — without this, auto-play's own timer kept firing and
    // yanked the reader back via scrollIntoView shortly after they navigated
    // with one of these keys.
    if (event.key !== 'Tab' && event.key !== 'Shift') {
      readerScrolled.current = true;
      setAutoplay(false);
    }
    if (event.key === 'Tab') {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const firstFocusable = focusable[0]!;
      const lastFocusable = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === firstFocusable || active === dialog) {
          event.preventDefault();
          lastFocusable.focus();
        }
      } else if (active === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    }
  }

  function toggleAutoplay(): void {
    // Fix round 2 (item 10): the usage count fires OUTSIDE the state updater.
    // React may run an updater twice (Strict Mode) and requires it to be
    // pure — counting inside it double-counted an activation.
    const next = !autoplay;
    setAutoplay(next);
    if (next) onAutoplay?.();
  }

  if (!open || typeof document === 'undefined') return null;

  // Fix round 2 (items 3+4): the entry runs on its own continuous 0→1 ramp
  // (`scroll.entry`), settled by the time the first caption reaches the
  // viewport centre. It used to be driven by `scroll.progress` on step 0,
  // which is nearest-centre and only reaches ~0.5 before restarting — so the
  // plane snapped 4°→0° at the first boundary and the first finding was read
  // at the full 8° tilt, the opposite of what ADR 044 decision 4 promises.
  const entry = entranceStyle(scroll.entry, staticMotion);

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
      <div ref={scrollRef} data-stage-scroller="true" className="h-full overflow-y-auto touch-pan-y lg:grid lg:grid-cols-[55%_45%]">
        {/* The pinned chart: sticky at the top of the scroller, the plane
          * tilted on entry. Fix round 2 (item 9): below `lg` the pinned area
          * is a MAXIMUM of half the viewport that scrolls internally when the
          * card is taller — a fixed `h-[45vh]` clipped the attribution line
          * and the caveat notes off the bottom on a phone, exactly the
          * strings R4/R11 require to stay readable. `lg:h-screen` unchanged
          * (with `lg:max-h-none`, or the cap would beat the height there). */}
        {/* Fix 3: `items-start` + `my-auto` on the child keeps the card's top
          * reachable when taller than the max-h cap — prevents both-ends
          * overflow on a scroll container. */}
        <div className="sticky top-0 z-0 flex max-h-[50vh] items-start overflow-y-auto bg-background px-4 lg:h-screen lg:max-h-none lg:overflow-visible lg:px-10">
          <div
            className={
              'relative w-full rounded-xl bg-card p-4 text-card-foreground my-auto' +
              // Fix round 2 (items 3+4): `transform` joins the transition so
              // a programmatic jump (a dot, an arrow key, auto-play) eases
              // instead of snapping. Static mode has nothing to ease.
              (staticMotion ? '' : ' transition-[transform,box-shadow] duration-200 ease-out')
            }
            style={{ transform: entry.transform, boxShadow: entry.boxShadow, transformStyle: 'preserve-3d', willChange: 'transform' }}
            data-stage-plane="true"
          >
            <div ref={chartBoxRef} className="relative">
              <StageChart spec={spec} step={step} overrides={overrides} />
              {spot && plot && !staticMotion ? (
                <div
                  aria-hidden="true"
                  data-stage-spotlight="true"
                  className="pointer-events-none absolute rounded-lg"
                  style={{
                    // Item 8: over the PLOT only — the title, the legend and
                    // the source line stay at full contrast.
                    left: `${plot.left}px`,
                    top: `${plot.top}px`,
                    width: `${plot.width}px`,
                    height: `${plot.height}px`,
                    background: `radial-gradient(circle at ${spot.left} ${spot.top}, transparent 0, transparent 22%, color-mix(in oklab, var(--card) 55%, transparent) 60%)`,
                  }}
                />
              ) : null}
            </div>
          </div>
        </div>
        {/* The steps: one full-height panel each; the scroll position picks the step. */}
        <div className="px-4 pb-[40vh] lg:px-10 lg:pt-[20vh]">
          <p className="mb-2 text-xs text-muted-foreground">{t(lang, 'chart.stage.scrollHint')}</p>
          <ol role="list" aria-label={t(lang, 'chart.stage.stepsLabel')} className="m-0 list-none p-0">
            {steps.map((s, i) => {
              // Fix round 2 (items 3+4): `progress` is nearest-centre, so it
              // runs 0 → ~0.5 across a step and restarts — the captions used
              // it raw and therefore only ever half-faded before popping to
              // the next panel. Doubling it gives the intended continuous
              // hand-over: the active caption fades out as its own centre is
              // left behind (2 × progress) exactly as the next one fades in
              // (1 − 2 × progress). `captionStyle` clamps either way.
              const distance = i === index ? 2 * scroll.progress : i === index + 1 ? 1 - 2 * scroll.progress : 1;
              const style = captionStyle(distance, staticMotion);
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
      <ol role="list" aria-label={t(lang, 'chart.stage.positionLabel')} className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1">
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
