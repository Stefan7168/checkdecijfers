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
  it('shows the plain attribution + Werkwijze/Privacy links off the home page', () => {
    render(<SiteFooter />);
    expect(document.querySelector('footer')!.textContent).toBe(FOOTER_ATTRIBUTION + ' · Werkwijze · Privacy');
    expect(screen.getByRole('link', { name: 'Werkwijze' })).toHaveAttribute('href', '/werkwijze');
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
  });
});

// WP218 phase 4 (#219): proves the language switch reaches the gear link —
// FOOTER_ATTRIBUTION itself stays byte-pinned Dutch (never translated).
// WP-B (journey programme): the Werkwijze/Privacy labels DO translate.
describe('SiteFooter — en', () => {
  it('translates the gear-link label/title and the trust-page links, but not the attribution', () => {
    render(
      <LangProvider lang="en">
        <SiteFooter />
      </LangProvider>,
    );
    expect(document.querySelector('footer')!.textContent).toBe(FOOTER_ATTRIBUTION + ' · How we work · Privacy');
    expect(screen.getByRole('link', { name: 'System map' })).toHaveAttribute('title', 'System map');
    expect(screen.getByRole('link', { name: 'How we work' })).toHaveAttribute('href', '/werkwijze');
  });
});

// Row 11 (session 110 UX audit, #P2): at 375px the footer wrapped to two
// lines on every screen and had no background colour at all
// (`rgba(0,0,0,0)`), so content at the scroller's bottom edge abutted the
// footer text with only a hairline between them.
describe('SiteFooter — phone layout (row 11)', () => {
  it('has an opaque background', () => {
    render(<SiteFooter />);
    const footer = document.querySelector('footer')!;
    expect(footer.className).toMatch(/\bbg-background\b/);
  });

  it('hides the second attribution clause below sm so the sentence fits one line, while keeping the CBS/CC BY part always visible', () => {
    render(<SiteFooter />);
    const footer = document.querySelector('footer')!;
    // jsdom ignores the CSS `hidden` utility (no layout engine), so the full
    // sentence is still present in textContent — this pins the CSS contract
    // (the wrapping span's classes), not visibility itself.
    expect(footer.textContent).toContain(FOOTER_ATTRIBUTION);
    const hiddenSpans = Array.from(footer.querySelectorAll('span.hidden'));
    const clauseSpan = hiddenSpans.find((el) => el.textContent?.includes('Elk getal herleidbaar'));
    expect(clauseSpan).toBeTruthy();
    expect(clauseSpan!.className).toMatch(/\bsm:inline\b/);
    // The "CBS StatLine (CC BY 4.0)" segment must NOT be inside that hidden
    // wrapper — only the trailing clause collapses below sm.
    expect(clauseSpan!.textContent).not.toContain('CBS StatLine');
  });
});
