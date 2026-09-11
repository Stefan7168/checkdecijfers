// ADR 042: one ResizeObserver width hook for every "explicit height from a
// measured width" rule (chart.tsx's height-follows-width, chart-frame.tsx's
// aspect ratio) — the session-92 battle-test lesson made mechanical: never
// CSS aspect-ratio, always a height set from the measured border-box width.
import { useEffect, useState, type RefObject } from 'react';

/** The element's border-box width, 0 until measured. `enabled: false`, a
 * missing ResizeObserver (SSR, jsdom) or a missing element all yield 0,
 * so callers fall back to their fixed default. Sub-pixel jitter (< 0.5 px)
 * is ignored so a fractional re-layout never loops. */
export function useElementWidth(ref: RefObject<HTMLElement | null>, enabled: boolean): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!enabled || typeof ResizeObserver === 'undefined' || !ref.current) return undefined;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.target.getBoundingClientRect().width ?? 0;
      setWidth((current) => (Math.abs(current - next) < 0.5 ? current : next));
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref, enabled]);
  return enabled ? width : 0;
}
