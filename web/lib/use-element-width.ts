// ADR 042: one ResizeObserver width hook for every "explicit height from a
// measured width" rule (chart.tsx's height-follows-width, chart-frame.tsx's
// aspect ratio) — the session-92 battle-test lesson made mechanical: never
// CSS aspect-ratio, always a height set from the measured border-box width.
import { useEffect, useRef, useState, type RefObject } from 'react';

/** The element's border-box width, 0 until measured. `enabled: false`, a
 * missing ResizeObserver (SSR, jsdom) or a missing element all yield 0,
 * so callers fall back to their fixed default. Sub-pixel jitter (< 0.5 px)
 * is ignored so a fractional re-layout never loops.
 *
 * open-questions #234: `ref` (a `useRef` object) never changes IDENTITY
 * across renders even when React swaps in a genuinely different underlying
 * DOM node for it — two real trigger paths found in review: a
 * schema-refusal render followed by a spec swap on the same mounted
 * instance (`ref.current` null → an element), and toggling chart-frame.tsx's
 * Frame Inset with Frame Aspect left at 'Auto' (an inline conditional
 * wrapper div appearing/disappearing reparents the ref'd node one level up
 * or down). A `useEffect` keyed on `[ref, enabled]` alone never re-fires for
 * either, since neither dependency object actually changed — the
 * ResizeObserver keeps watching a now-stale node while `ref.current` points
 * elsewhere.
 *
 * Fixed by re-checking `ref.current` itself on EVERY render (the effect
 * below deliberately carries no dependency array) against `observedRef`, a
 * second ref tracking which node is actually being watched right now — a
 * no-op comparison on every render where nothing changed, and a tear-down +
 * reattach on the rare render where it did. This is the one general
 * mechanism that covers both trigger paths identically, per this row's own
 * instruction not to patch one narrowly. The observer's lifetime is tracked
 * in `observerRef` rather than via this effect's own return value, since a
 * deps-less effect's cleanup runs before EVERY subsequent invocation
 * (including in-effect no-ops) — returning `() => observer.disconnect()`
 * from here would tear the observer down on every single render, not just
 * the one that actually swapped nodes. The final disconnect-on-unmount
 * instead lives in its own effect below, with a stable empty deps array.
 *
 * That unmount effect's cleanup must reset BOTH `observerRef` AND
 * `observedRef`, not just call `.disconnect()` — found by tracing this
 * hook's behavior under React StrictMode (Next.js's own default,
 * development-only): StrictMode mounts every component twice, running each
 * effect, cleaning it up, then running it again. If the cleanup here only
 * disconnected the observer without also clearing `observedRef`, the
 * SIMULATED remount's poll effect would see `element === observedRef.current`
 * (still true — nothing reset it) and skip creating a replacement, leaving
 * the hook permanently stuck on a dead, disconnected observer for the rest
 * of the component's real lifetime. Resetting both refs here makes the
 * following poll-effect run detect "nothing is being watched" correctly and
 * reattach, so StrictMode's double-invoke settles on exactly one live
 * observer — the same StrictMode-safety test in this file's `.test.ts`
 * pins this by rendering under a real `<StrictMode>` wrapper. */
export function useElementWidth(ref: RefObject<HTMLElement | null>, enabled: boolean): number {
  const [width, setWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const observedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!enabled || typeof ResizeObserver === 'undefined') {
      observerRef.current?.disconnect();
      observerRef.current = null;
      observedRef.current = null;
      return;
    }
    const element = ref.current;
    if (element === observedRef.current) return;
    observerRef.current?.disconnect();
    observedRef.current = element;
    if (element === null) {
      observerRef.current = null;
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.target.getBoundingClientRect().width ?? 0;
      setWidth((current) => (Math.abs(current - next) < 0.5 ? current : next));
    });
    observer.observe(element);
    observerRef.current = observer;
  });

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      observedRef.current = null;
    },
    [],
  );

  return enabled ? width : 0;
}
