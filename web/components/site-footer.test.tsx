// web/components/site-footer.test.tsx
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FOOTER_ATTRIBUTION, SiteFooter } from './site-footer.tsx';

vi.mock('next/navigation', () => ({ usePathname: () => '/chat' }));

afterEach(cleanup);

describe('SiteFooter', () => {
  // Session 88 (#211) appended the chat's pre-send pricing hint here through
  // a PricingHintContext; session 90 moved that line back into the composer
  // (directly under the input, owner request) and removed the context, so
  // off the home page the footer is the bare attribution again. The
  // home-page variant (attribution + "Over dit project" anchor) stays pinned
  // byte-for-byte in workspace.test.tsx.
  it('shows only the plain attribution off the home page', () => {
    render(<SiteFooter />);
    expect(document.querySelector('footer')!.textContent).toBe(FOOTER_ATTRIBUTION);
  });
});
