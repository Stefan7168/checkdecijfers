// web/components/site-footer.test.tsx
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LangProvider } from '../lib/i18n/lang-provider.tsx';
import { MESSAGES } from '../lib/i18n/messages.ts';
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

// WP218 phase 4 (#219): proves the language switch reaches the gear link and
// the trust-page links. Session 110 UX audit row 21 REVERSES this file's
// earlier pin that the attribution itself stayed byte-pinned Dutch under
// EN — an English page showing Dutch attribution copy read as unfinished
// (audit finding #21). It now translates via messages.ts like everything
// else here; "CBS StatLine (CC BY 4.0)" (R4 attribution) is asserted
// verbatim in both languages in messages.test.ts.
describe('SiteFooter — en', () => {
  it('translates the attribution sentence, the gear-link label/title, and the trust-page links', () => {
    render(
      <LangProvider lang="en">
        <SiteFooter />
      </LangProvider>,
    );
    expect(document.querySelector('footer')!.textContent).toBe(
      MESSAGES.en['footer.attribution'] + ' · How we work · Privacy',
    );
    expect(screen.getByRole('link', { name: 'System map' })).toHaveAttribute('title', 'System map');
    expect(screen.getByRole('link', { name: 'How we work' })).toHaveAttribute('href', '/werkwijze');
  });
});

// Session 110 UX audit row 18 (ADR 048 addendum): the Eurostat-explorer page
// is entirely Eurostat data, so its footer must say so instead of the CBS
// wording every other route keeps (pinned above and in the phone-layout
// block below). layout.tsx passes `sourceRoute="eurostat"` only for that one
// route (via proxy.ts's x-source-route header); every other call site keeps
// omitting the prop, which must fall back to the plain CBS attribution.
describe('SiteFooter — sourceRoute="eurostat" (pass-2 row 18)', () => {
  it('renders the Eurostat attribution line instead of the CBS one', () => {
    render(<SiteFooter sourceRoute="eurostat" />);
    const footer = document.querySelector('footer')!;
    expect(footer.textContent).toContain('Eurostat (CC BY 4.0)');
    expect(footer.textContent).not.toContain('CBS StatLine');
  });

  it('translates the Eurostat attribution line under English too', () => {
    render(
      <LangProvider lang="en">
        <SiteFooter sourceRoute="eurostat" />
      </LangProvider>,
    );
    const footer = document.querySelector('footer')!;
    expect(footer.textContent).toContain(MESSAGES.en['footer.attributionEurostat']);
  });

  it('with no sourceRoute prop (every other route), still renders the plain CBS attribution', () => {
    render(<SiteFooter />);
    expect(document.querySelector('footer')!.textContent).toBe(FOOTER_ATTRIBUTION + ' · Werkwijze · Privacy');
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
