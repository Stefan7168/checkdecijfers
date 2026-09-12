// ADR 044: the stage's scroll → step mapping. One rAF-throttled scroll
// listener on the steps column; `stageProgress` (pure) does the arithmetic.
// A programmatic scroll (dots, keys, auto-play) calls `beginProgrammatic()`
// first, and the listener ignores events until 150 ms after the last one —
// the compact panel's settle-guard idea, without IntersectionObserver
// (the stage needs continuous progress, not membership).
//
// Fix round 1 (item B): closing the settle window used to just flip
// `programmatic.current` back to false — `measure()` never ran, so
// index/progress stayed stale after a dot/arrow/auto-play jump, and a later
// manual scroll back to that same step was silently dropped (no state
// change → no onIndexChange → chart/caption desync). Both places that arm
// the settle timer (`beginProgrammatic` itself, and the "still moving"
// branch inside `onScroll`) now share one `armSettle` helper whose timeout
// re-measures once it actually fires. `measure` is defined inside the
// effect (it closes over the current panel refs), so it's exposed to
// `armSettle` — which is stable across renders — through a ref.
//
// Fix round 2 (items 3+4): the hook now also reports `entry` — how far the
// plane's entry animation has run (`entryProgress`), which unlike `progress`
// ramps once, continuously, from the top of the column to the moment the
// first caption is centred. `progress` stays exactly as it was.
//
// Fix (scrollbar-drag auto-play gap): `programmatic.current` was internal
// only — no caller outside this hook could tell the stage's own scroll
// (`beginProgrammatic()` already called) apart from the reader's. The hook
// now also returns `isProgrammatic()`, a live read of that same ref, so
// chart-story-stage.tsx can stop auto-play on a real reader scroll —
// including a scrollbar-thumb drag, which fires only a `scroll` DOM event —
// while leaving the stage's own programmatic moves alone.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { entryProgress, stageProgress, type StageProgress } from './chart-stage.ts';

/** The scroll state the stage reads: the active step, the progress toward
 * the next (nearest-centre semantics — see `stageProgress`), and the 0→1
 * entry ramp that settles the chart plane before the first caption is read. */
export interface StageState extends StageProgress {
  entry: number;
}

export interface StageScroll extends StageState {
  beginProgrammatic(): void;
  /** True from the moment `beginProgrammatic()` is called until 150 ms have
   * passed with no further `scroll` event — i.e. while a scroll the STAGE
   * itself caused (a dot/arrow-key jump, auto-play's own `scrollIntoView`)
   * has not yet finished settling. False once that window has closed, so a
   * scrollbar-thumb drag (which fires only a `scroll` DOM event, unlike
   * wheel/touch/pointerdown) reads as non-programmatic and can stop
   * auto-play the way any other reader gesture does
   * (chart-story-stage.tsx's `onAnyScroll`).
   *
   * This is a TIME-WINDOW read, not a per-event cause read: any `scroll`
   * event — the stage's own or the reader's — re-arms the same window while
   * it is open (see `onScroll` below), so a drag that starts WHILE a
   * programmatic scroll is still settling reads as programmatic too, for as
   * long as the drag itself keeps producing events under 150 ms apart.
   * Known, accepted residual (narrower than the gap this method closes):
   * only an isolated drag — one that does not overlap an in-flight
   * programmatic scroll — is guaranteed to be told apart.
   *
   * Reads the same ref `beginProgrammatic` sets, live at call time — safe to
   * call from a scroll listener registered outside this hook. */
  isProgrammatic(): boolean;
}

const SETTLE_MS = 150;

export function useStageScroll(
  containerRef: RefObject<HTMLElement | null>,
  panelRefs: RefObject<(HTMLElement | null)[]>,
  stepCount: number,
  enabled: boolean,
): StageScroll {
  const [state, setState] = useState<StageState>({ index: 0, progress: 0, entry: 0 });
  const programmatic = useRef(false);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<number | null>(null);
  const measureRef = useRef<() => void>(() => {});

  const armSettle = useCallback((): void => {
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      programmatic.current = false;
      measureRef.current();
    }, SETTLE_MS);
  }, []);

  const beginProgrammatic = useCallback((): void => {
    programmatic.current = true;
    armSettle();
  }, [armSettle]);

  // Fix (scrollbar-drag auto-play gap): a plain accessor over the ref, so a
  // caller outside this hook (chart-story-stage.tsx's `onAnyScroll`) can tell
  // its own programmatic scroll apart from the reader's, per-event. Stable
  // across renders like `beginProgrammatic` above — it closes over the ref,
  // never over `state` — so it is safe to call from an effect whose deps
  // deliberately exclude the hook's return value.
  const isProgrammatic = useCallback((): boolean => programmatic.current, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!enabled || !el) return undefined;
    const measure = (): void => {
      const panels = (panelRefs.current ?? []).slice(0, stepCount);
      const offsets = panels.map((p) => p?.offsetTop ?? 0);
      const heights = panels.map((p) => p?.offsetHeight ?? 0);
      const step = stageProgress(el.scrollTop, el.clientHeight, offsets, heights);
      const next: StageState = { ...step, entry: entryProgress(el.scrollTop, el.clientHeight, offsets, heights) };
      setState((current) =>
        current.index === next.index && current.progress === next.progress && current.entry === next.entry ? current : next,
      );
    };
    measureRef.current = measure;
    const onScroll = (): void => {
      if (programmatic.current) {
        // Keep the settle window open while the programmatic scroll is still moving.
        armSettle();
        return;
      }
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        measure();
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    measure();
    return () => {
      el.removeEventListener('scroll', onScroll);
      // Fix round 2 (item 10): reset every ref, not just the listener. A
      // teardown mid-programmatic-scroll (the stage closing while a dot jump
      // is still settling) used to leave `programmatic.current` true and the
      // timer/frame ids dangling — the next open then silently dropped the
      // reader's first scrolls until some later scroll happened to re-arm
      // the settle timer.
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      if (settle.current) clearTimeout(settle.current);
      settle.current = null;
      programmatic.current = false;
    };
  }, [containerRef, panelRefs, stepCount, enabled, armSettle]);

  return { ...state, beginProgrammatic, isProgrammatic };
}
