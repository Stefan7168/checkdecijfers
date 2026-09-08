'use client';
// WP218 phase 2 (#218 chart styling, owner decision C): the account default
// for chart styling, held once per signed-in session and read by every
// mounted ChartView (chart.tsx) via `useChartStyle()` as the `base` argument
// to `resolvePresentation` (see chart-presentation.ts's `withAccountDefault`).
//
// The PROVIDER's presence — not its value — is what "signed in" means here:
// page.tsx's WORKSPACE branch reads the account's saved style (or null, on a
// throw or an absent table) and Workspace ALWAYS wraps its tree in
// `<ChartStyleProvider>`, even when nothing was found. A logged-out surface
// (Landing, Ontdek) never mounts the provider at all, so `useChartStyle()`
// there falls back to the no-provider default below — stock look, no
// "Bewaar als mijn standaard" row (chart.tsx only offers `account` to the
// panel when `signedIn` is true).
import { createContext, useContext, useState, type ReactNode } from 'react';
import { sanitizeOverrides, type PresentationOverrides } from './chart-presentation.ts';

export interface ChartStyleContextValue {
  /** The sanitised account default, or null when nothing valid was stored
   * (never had one, a purged/absent table, or garbage in the row). */
  accountStyle: PresentationOverrides | null;
  setAccountStyle: (next: PresentationOverrides | null) => void;
  /** True only inside a mounted ChartStyleProvider — see the module header. */
  signedIn: boolean;
}

const ChartStyleContext = createContext<ChartStyleContextValue | null>(null);

const NO_PROVIDER_DEFAULT: ChartStyleContextValue = {
  accountStyle: null,
  setAccountStyle: () => {},
  signedIn: false,
};

/** Sanitised once, at the initial render (a lazy useState initializer runs
 * exactly once, even across the provider's own re-renders) — `initial` is a
 * raw `user_chart_styles.style` jsonb value (or null), so it goes through
 * the same allow-list as any other untrusted overrides input. An object
 * with no valid keys left after sanitising is treated the same as "no
 * default" (null), so `hasDefault` (chart.tsx) never lies about there being
 * a real, currently-applied account default. */
function sanitizeInitial(initial: unknown): PresentationOverrides | null {
  const clean = sanitizeOverrides(initial);
  return Object.keys(clean).length === 0 ? null : clean;
}

export function ChartStyleProvider({ initial, children }: { initial: unknown; children: ReactNode }) {
  const [accountStyle, setAccountStyle] = useState<PresentationOverrides | null>(() => sanitizeInitial(initial));
  return (
    <ChartStyleContext.Provider value={{ accountStyle, setAccountStyle, signedIn: true }}>
      {children}
    </ChartStyleContext.Provider>
  );
}

export function useChartStyle(): ChartStyleContextValue {
  return useContext(ChartStyleContext) ?? NO_PROVIDER_DEFAULT;
}
