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
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { stageProgress, type StageProgress } from './chart-stage.ts';

export interface StageScroll extends StageProgress {
  beginProgrammatic(): void;
}

const SETTLE_MS = 150;

export function useStageScroll(
  containerRef: RefObject<HTMLElement | null>,
  panelRefs: RefObject<(HTMLElement | null)[]>,
  stepCount: number,
  enabled: boolean,
): StageScroll {
  const [state, setState] = useState<StageProgress>({ index: 0, progress: 0 });
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
      const next = stageProgress(el.scrollTop, el.clientHeight, offsets, heights);
      setState((current) => (current.index === next.index && current.progress === next.progress ? current : next));
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
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      if (settle.current) clearTimeout(settle.current);
    };
  }, [containerRef, panelRefs, stepCount, enabled, armSettle]);

  return { ...state, beginProgrammatic };
}
