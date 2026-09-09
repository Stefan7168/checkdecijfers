'use client';
// Task 6 (chart frame plan): one Style panel open per page. Each ChartView
// claims this shared "owner" slot (its own `domId`) the moment its Style
// panel opens; a chart whose panel is open but is no longer the owner
// closes itself (chart.tsx's own effect) rather than this module ever
// reaching into another chart's state directly — the owner value is the
// only thing shared, closing is each chart's own business.
//
// The no-provider default below always allows every chart to be its own
// owner (an `owner` that's never anything but the caller's own id, since
// `claim`/`release` are no-ops) — every existing test that renders
// `ChartView`/`ChartConfigPanel` without `StylePanelOwnerProvider` in the
// tree keeps passing unchanged; only a real page (app/layout.tsx) and tests
// that explicitly exercise the "one panel per page" behaviour need the
// provider.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export interface StylePanelOwnerValue {
  owner: string | null;
  claim: (id: string) => void;
  release: (id: string) => void;
}

const NOOP_VALUE: StylePanelOwnerValue = {
  owner: null,
  claim: () => {},
  release: () => {},
};

const StylePanelOwnerContext = createContext<StylePanelOwnerValue | null>(null);

export function StylePanelOwnerProvider({ children }: { children: ReactNode }): ReactNode {
  const [owner, setOwner] = useState<string | null>(null);
  const claim = useCallback((id: string) => {
    setOwner(id);
  }, []);
  const release = useCallback((id: string) => {
    setOwner((current) => (current === id ? null : current));
  }, []);
  const value = useMemo<StylePanelOwnerValue>(() => ({ owner, claim, release }), [owner, claim, release]);
  return <StylePanelOwnerContext.Provider value={value}>{children}</StylePanelOwnerContext.Provider>;
}

/** No-provider default: `owner` stays `null` forever and `claim`/`release`
 * do nothing, so a chart rendered outside `StylePanelOwnerProvider` never
 * sees `owner !== domId` and never has its panel closed out from under it. */
export function useStylePanelOwner(): StylePanelOwnerValue {
  return useContext(StylePanelOwnerContext) ?? NOOP_VALUE;
}
