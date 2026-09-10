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

  return { ...state, beginProgrammatic };
}
