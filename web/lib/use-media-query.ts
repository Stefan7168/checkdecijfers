// WP135 chat workspace (ADR 033 D4): the right-pane dock exists only at the
// `lg` breakpoint and up — a CLIENT decision (no server knows the viewport).
// Implemented with useSyncExternalStore (React's blessed subscribe pattern, no
// setState-in-effect): SSR-safe via a `false` server snapshot (single-column,
// visuals inline exactly as today), so there is never a hydration mismatch and
// mobile has zero regression.
'use client';

import { useCallback, useSyncExternalStore } from 'react';

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return () => {};
      }
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  const getSnapshot = (): boolean =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false;
  const getServerSnapshot = (): boolean => false;
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
