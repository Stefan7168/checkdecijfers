// web/components/site-footer.test.tsx
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { PricingHintProvider, usePricingHint } from '../lib/pricing-hint-context.tsx';
import { FOOTER_ATTRIBUTION, SiteFooter } from './site-footer.tsx';

vi.mock('next/navigation', () => ({ usePathname: () => '/chat' }));

afterEach(cleanup);

// NOTE (session 88): the brief's original SetHint called
// `act(() => setPricingHint(hint))` directly in the render body. That
// triggers React's "Cannot update a component while rendering a different
// component" warning and the update never lands before the assertion runs
// (verified in isolation against pricing-hint-context.tsx alone, independent
// of SiteFooter). Setting the hint from a useEffect is the correct pattern —
// render()'s internal act() wrapper flushes effects synchronously, so no
// explicit act() is needed here.
function SetHint({ hint }: { hint: string }) {
  const { setPricingHint } = usePricingHint();
  useEffect(() => {
    setPricingHint(hint);
  }, [hint, setPricingHint]);
  return null;
}

describe('SiteFooter — pricing hint (session 88)', () => {
  it('appends the pricing hint after the attribution when one is set', () => {
    render(
      <PricingHintProvider>
        <SetHint hint="Een vraag kost ~20 credits · saldo: 100 credits." />
        <SiteFooter />
      </PricingHintProvider>,
    );
    const footer = document.querySelector('footer')!;
    expect(footer.textContent).toBe(`${FOOTER_ATTRIBUTION} · Een vraag kost ~20 credits · saldo: 100 credits.`);
  });

  it('shows only the plain attribution when no hint is set', () => {
    render(
      <PricingHintProvider>
        <SiteFooter />
      </PricingHintProvider>,
    );
    expect(document.querySelector('footer')!.textContent).toBe(FOOTER_ATTRIBUTION);
  });
});
