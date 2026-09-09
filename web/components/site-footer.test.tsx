// web/components/site-footer.test.tsx
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LangProvider } from '../lib/i18n/lang-provider.tsx';
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

// WP218 phase 4 (#219): proves the language switch reaches the gear link —
// FOOTER_ATTRIBUTION itself stays byte-pinned Dutch (never translated).
describe('SiteFooter — en', () => {
  it('translates the gear-link label/title but not the attribution', () => {
    render(
      <LangProvider lang="en">
        <SiteFooter />
      </LangProvider>,
    );
    expect(document.querySelector('footer')!.textContent).toBe(FOOTER_ATTRIBUTION);
    expect(screen.getByRole('link', { name: 'System map' })).toHaveAttribute('title', 'System map');
  });
});
