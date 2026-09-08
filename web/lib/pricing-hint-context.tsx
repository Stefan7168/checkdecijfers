// #211 chat interaction polish, session 88: SiteFooter (mounted in
// app/layout.tsx as a SIBLING of the page content, never a descendant of
// Workspace/Chat) has no prop-drilling path to a live, per-chat value like
// the pre-send pricing line. This context bridges the two. The default
// value's setter is a DELIBERATE no-op: any component rendered without a
// PricingHintProvider ancestor (every existing test that doesn't opt in)
// gets pricingHint: null and a setter that does nothing -- which is exactly
// today's "no pricing line" behavior, unchanged.
'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

interface PricingHintValue {
  pricingHint: string | null;
  setPricingHint: (hint: string | null) => void;
}

export const PricingHintContext = createContext<PricingHintValue>({
  pricingHint: null,
  setPricingHint: () => {},
});

export function usePricingHint(): PricingHintValue {
  return useContext(PricingHintContext);
}

export function PricingHintProvider({ children }: { children: ReactNode }) {
  const [pricingHint, setPricingHint] = useState<string | null>(null);
  return (
    <PricingHintContext.Provider value={{ pricingHint, setPricingHint }}>
      {children}
    </PricingHintContext.Provider>
  );
}
