'use client';
// ADR 044: the Story stage — the Insights story as a full-viewport,
// scroll-driven presentation. A portal for POSITION only: open/index live in
// ChartView (like the compact panel). The chart is a second, chrome-less
// ChartView (stage mode) driven by the active step; every animated property
// is a transform/opacity on a wrapper OUTSIDE the exported svg (there is no
// export here anyway). Zero libraries: CSS 3D + useStageScroll.
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { ChartSpec } from '../backend/chart/types.ts';
import {
  atmosphereState,
  ATMOSPHERE_MIX_MAX_PERCENT,
  captionStyle,
  entranceStyle,
  planeDriftPx,
  planeTransform,
  spotlightGlowStyle,
  spotlightStyle,
  STAGE_AUTOPLAY_MS,
  STAGE_ATMOSPHERE_TRANSITION_MS,
  STAGE_SPOTLIGHT_GLOW_BACKGROUND,
  STAGE_SPOTLIGHT_TRANSITION_EASING,
  STAGE_SPOTLIGHT_TRANSITION_MS,
} from '../lib/chart-stage.ts';
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

// The ambient atmosphere layer (visual upgrade, task 1 of a chain — see the
// task's own doc comment on the layer below for the full design). Two large,
// heavily blurred blobs drift in a slow, seamless loop; only the shape of
// the motion lives here (fixed, no digits that trace to any spec/step — the
// COLOUR and whether it runs at all are applied per-render via inline
// `style`, never baked into this string). `@keyframes` can only be defined
// in a stylesheet, never an inline `style` attribute, so this is portalled
// into `document.head` — DELIBERATELY NEVER `document.body`, where the
// dialog itself lives: chart.test.tsx runs a whole-card digit scan over
// `document.body`'s own text nodes while the stage is open (a `<style>`
// element's CSS text IS a DOM text node, so `25%`/`24s`/`130px` etc. below
// would otherwise read as unbound digits with no source in the spec). A
// future task extending this layer should keep that same split: real
// content in the dialog (`document.body`), stylesheet text in
// `document.head`. Hoisted as a module constant — the string never changes
// across renders.
const ATMOSPHERE_KEYFRAMES = `
@keyframes stage-atmosphere-drift-a {
  0% { transform: translate3d(-6%, -4%, 0) scale(1); }
  25% { transform: translate3d(5%, 6%, 0) scale(1.1); }
  50% { transform: translate3d(7%, -3%, 0) scale(0.95); }
  75% { transform: translate3d(-4%, 5%, 0) scale(1.05); }
  100% { transform: translate3d(-6%, -4%, 0) scale(1); }
}
@keyframes stage-atmosphere-drift-b {
  0% { transform: translate3d(5%, 5%, 0) scale(1); }
  33% { transform: translate3d(-6%, -4%, 0) scale(1.08); }
  66% { transform: translate3d(-3%, 6%, 0) scale(0.93); }
  100% { transform: translate3d(5%, 5%, 0) scale(1); }
}
`;

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
  // The v1 "no parallax" substitute (ADR 044 §"As built"): a small vertical
  // breathing drift on the SAME plane, driven by `scroll.progress` — the
  // PER-STEP nearest-centre progress, deliberately NOT `scroll.entry` above
  // (that ramp is fully spent on the tilt). `stageProgress` clamps a step's
  // own progress to 0 until the viewport centre passes that step's own
  // centre, which is exactly when `entry` reaches 1 — so the drift is always
  // 0 while the plane is still tilting, and `planeTransform` is
  // byte-identical to `entry.transform` at that point; only once the plane is
  // flat does a `translateY` get appended. Gated on the same `staticMotion`
  // the entry tilt already uses, not a second motion switch.
  const drift = planeDriftPx(scroll.progress, staticMotion);
  const planeStyleTransform = planeTransform(entry.transform, drift);
  // The ambient atmosphere layer's colour/intensity/motion (pure —
  // chart-stage.ts). Tied to the ACTIVE step's own highlighted series,
  // never invented; an overview step (`highlight` null) falls back to the
  // first series at reduced intensity rather than a different hue.
  const atmosphere = atmosphereState(overrides, step?.highlight ?? null, staticMotion);
  const atmosphereMixPct = Math.round(ATMOSPHERE_MIX_MAX_PERCENT * atmosphere.intensity);
  const atmosphereTransition = atmosphere.animated ? `background-color ${STAGE_ATMOSPHERE_TRANSITION_MS}ms ease` : 'none';
  // The spotlight glow's fixed size + moving `transform` (chart-stage.ts) —
  // derived from the SAME `spot`/`plot` state `readSpot` already produces
  // (no new DOM read), recomputed on every render so it always reflects the
  // current marker and plot-box size.
  const glow = spotlightGlowStyle(spot, plot);

  return (
    <>
      {createPortal(<style>{ATMOSPHERE_KEYFRAMES}</style>, document.head)}
      {createPortal(
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={`${t(lang, 'chart.stage.label')}: ${spec.title}`}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          className="fixed inset-0 z-50 bg-background text-foreground outline-none"
          data-story-stage="true"
          // SHARED INFRASTRUCTURE for the visual-upgrade tasks after this
          // one: `--stage-accent` always carries the ACTIVE step's own
          // highlighted-series colour as a raw value (see `atmosphereState`,
          // lib/chart-stage.ts — never invented), updated on THIS element
          // every time the active step's colour changes. It inherits to
          // every descendant below, so reference `var(--stage-accent)` in
          // your own color-mix()/rgba() expressions rather than re-deriving
          // the colour; do not re-set it lower in the tree unless a step
          // genuinely needs a different colour than the stage's own active
          // step (none does today).
          style={{ '--stage-accent': atmosphere.accent } as CSSProperties}
        >
          {/* The ambient atmosphere: a purely decorative, full-viewport
            * backdrop behind the scroll container and the buttons — the
            * brief was "make the stage feel like a real presentation, not
            * a plain overlay". aria-hidden + pointer-events-none: no
            * semantic content, never a click target, both buttons and the
            * scroller stay fully interactive. Two large, heavily blurred
            * blobs (`stage-atmosphere-drift-a`/`-b`, the keyframes
            * portalled into document.head above) drift slowly and
            * continuously in a seamless loop; their colour transitions
            * smoothly (background-color only — deliberately not the
            * gradient itself, which is not reliably interpolable across
            * browsers) when the active step's colour changes.
            *
            * CONTRAST (R4): every piece of real text this product requires
            * to stay legible — the source/attribution line, the caveat
            * notes, the captions, the chart itself — sits inside an OPAQUE
            * `bg-card` container (below), so this layer can never reduce
            * its contrast regardless of the colour or percentage chosen:
            * it is only ever visible in the surrounding margin. The one
            * exposed piece of chrome is the close/auto-play corner (the
            * autoplay pill has its own `bg-background`; the close button
            * is a transparent `ghost` button) — ATMOSPHERE_MIX_MAX_PERCENT
            * is kept conservative for that reason, and both blobs are
            * anchored away from the top-right corner.
            *
            * STACKING: `-z-10` (not DOM order) puts this behind every
            * sibling here regardless of any sibling's own `position` — the
            * scroll container below is `position: static`, so a static,
            * non-positioned box actually paints BEFORE an auto/0-z-index
            * positioned one in CSS's own paint order; only a NEGATIVE
            * z-index is guaranteed to paint first regardless. The
            * close/auto-play buttons keep their existing `z-10`.
            * `overflow-hidden` keeps a mid-drift blob from ever bleeding
            * past the dialog's own edge. NOT verified in a real browser in
            * this task — see the task's report for what a human should
            * re-check (both themes, both motion states). */}
          <div aria-hidden="true" data-stage-atmosphere="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
            <div
              data-stage-atmosphere-blob="a"
              className="absolute -left-[15%] -top-[10%] h-[75%] w-[65%] rounded-full blur-[130px]"
              style={{
                backgroundColor: `color-mix(in oklab, var(--stage-accent) ${atmosphereMixPct}%, var(--background))`,
                animation: atmosphere.animated ? 'stage-atmosphere-drift-a 24s ease-in-out infinite' : 'none',
                transition: atmosphereTransition,
              }}
            />
            <div
              data-stage-atmosphere-blob="b"
              className="absolute -bottom-[15%] -right-[10%] h-[70%] w-[60%] rounded-full blur-[130px]"
              style={{
                backgroundColor: `color-mix(in oklab, var(--stage-accent) ${Math.round(atmosphereMixPct * 0.7)}%, var(--background))`,
                animation: atmosphere.animated ? 'stage-atmosphere-drift-b 29s ease-in-out infinite' : 'none',
                transition: atmosphereTransition,
              }}
            />
          </div>
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
                style={{ transform: planeStyleTransform, boxShadow: entry.boxShadow, transformStyle: 'preserve-3d', willChange: 'transform' }}
                data-stage-plane="true"
              >
                <div ref={chartBoxRef} className="relative">
                  <StageChart spec={spec} step={step} overrides={overrides} />
                  {spot && plot && !staticMotion ? (
                    // Spotlight-motion task: two elements now, not one. A plain
                    // CSS `transition` does not reliably interpolate between two
                    // different `radial-gradient(...)` VALUES across browsers —
                    // the same reason the ambient atmosphere layer above
                    // transitions a solid `background-color` rather than its own
                    // gradient. So the OUTER element stays exactly what it
                    // always was — confined to the plot box, `left/top/width/
                    // height` in px, the whole confinement guarantee the
                    // "confined to the plot box" test checks — plus a new
                    // `overflow-hidden`, which now also clips the glow below (a
                    // corner marker's glow crops at the plot edge exactly as the
                    // old single-gradient version did: that was always painted
                    // onto an identically plot-sized box, so it was already
                    // cropped there too). The INNER glow is fixed-size and
                    // fixed-shape (`STAGE_SPOTLIGHT_GLOW_BACKGROUND`,
                    // chart-stage.ts — always centred on ITSELF) and MOVES via
                    // `transform: translate3d(...)` (`spotlightGlowStyle`) — an
                    // ordinary, always-smoothly-animatable property, matching
                    // the chart plane's own transition idiom elsewhere in this
                    // file. The easing overshoots slightly before settling — a
                    // small, free "arrival" flourish from the curve alone; a
                    // separate size/brightness pulse was considered and skipped
                    // as one animated property too many for what the eased move
                    // alone already reads as.
                    <div
                      aria-hidden="true"
                      data-stage-spotlight="true"
                      className="pointer-events-none absolute overflow-hidden rounded-lg"
                      style={{
                        // Item 8: over the PLOT only — the title, the legend and
                        // the source line stay at full contrast.
                        left: `${plot.left}px`,
                        top: `${plot.top}px`,
                        width: `${plot.width}px`,
                        height: `${plot.height}px`,
                      }}
                    >
                      {glow ? (
                        <div
                          data-stage-spotlight-glow="true"
                          className="absolute rounded-full"
                          style={{
                            left: '0px',
                            top: '0px',
                            width: glow.width,
                            height: glow.height,
                            transform: glow.transform,
                            background: STAGE_SPOTLIGHT_GLOW_BACKGROUND,
                            transition: `transform ${STAGE_SPOTLIGHT_TRANSITION_MS}ms ${STAGE_SPOTLIGHT_TRANSITION_EASING}`,
                            willChange: 'transform',
                          }}
                        />
                      ) : null}
                    </div>
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
                      className="flex min-h-[85vh] scroll-mt-[52vh] flex-col justify-center lg:scroll-mt-0"
                    >
                      {/* Editorial reveal (visual upgrade, task 2 of the
                        * chain — captions): the old bordered `bg-card` box
                        * read as UI chrome (a tooltip), wrong for a
                        * full-viewport, magazine-style presentation. The
                        * text now sits directly over the atmosphere layer;
                        * a borderless, blurred `bg-background/70` scrim
                        * (never a hard-edged card) sits BEHIND it via a
                        * negative inset, purely for legibility — a real,
                        * provable alpha blend, not a shadow trick, so
                        * contrast holds regardless of which series colour
                        * the atmosphere is currently tinted to:
                        * ATMOSPHERE_MIX_MAX_PERCENT (chart-stage.ts) caps
                        * the atmosphere layer itself at 30% colour toward
                        * `--stage-accent`; this scrim is only 30%
                        * see-through on top of THAT, so under 10% of the
                        * accent colour can ever reach the pixels directly
                        * behind this text — against a foreground/background
                        * pair that is already near-pure black-on-white (or
                        * white-on-black) to begin with (globals.css).
                        * `backdrop-blur-md` additionally smooths whatever
                        * texture shows through the remaining 30%, so there
                        * is never a hard colour edge under a letterform.
                        * The small accent rule above the title is the ONLY
                        * colour tie to the active finding —
                        * `var(--stage-accent)` reused exactly as the
                        * atmosphere task's own doc comment asks, never a
                        * re-derived colour. NOT verified in a real browser
                        * in this task — see the task's report for what a
                        * human should re-check (both themes, the blur
                        * reveal's actual feel). */}
                      <div className="relative max-w-xl" style={style}>
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute -inset-x-6 -inset-y-6 -z-10 rounded-3xl bg-background/70 backdrop-blur-md sm:-inset-x-9 sm:-inset-y-8"
                        />
                        <div
                          aria-hidden="true"
                          className="mb-3 h-[3px] w-10 rounded-full sm:mb-4 sm:w-12"
                          style={{ backgroundColor: 'var(--stage-accent)' }}
                        />
                        <p className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl md:text-5xl">{s.title}</p>
                        <p className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground sm:mt-5 sm:text-lg md:text-xl">{s.caption}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
          {/* Position dots — never "N of M". A small premium touch (visual
            * upgrade, task 2 of the chain): the active dot grows slightly
            * and sits inside a soft glow ring in the SAME `--stage-accent`
            * the caption's own rule and the atmosphere layer use — never a
            * new colour, so the one piece of chrome outside the caption
            * still reads as part of the same system. Digit-free, as
            * required; `duration-300` keeps it inside the brief's
            * 300-500ms family. */}
          <ol role="list" aria-label={t(lang, 'chart.stage.positionLabel')} className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1">
            {steps.map((s, i) => (
              <li key={s.id}>
                <button type="button" aria-label={s.title} aria-current={i === index ? 'step' : undefined} onClick={() => { setAutoplay(false); go(i); }} className="flex size-6 items-center justify-center">
                  <span
                    className={
                      'block size-2.5 rounded-full transition-[transform,background-color,box-shadow] duration-300 ' +
                      (i === index ? 'scale-125 bg-foreground' : 'bg-border hover:bg-muted-foreground')
                    }
                    style={i === index ? { boxShadow: '0 0 0 4px color-mix(in oklab, var(--stage-accent) 35%, transparent)' } : undefined}
                  />
                </button>
              </li>
            ))}
          </ol>
        </div>,
        document.body,
      )}
    </>
  );
}
