// WP218 phase 4 (#219): site-header.tsx had no test file before this task
// (i18n-string-inventory.md). Pins: the existing Dutch copy stays
// byte-identical under the default (no-provider) language, the header
// renders English under <LangProvider lang="en">, and both variants (the
// stripped /login+landing header and the workspace header with a balance)
// carry the NL|EN switch next to the account button / wordmark.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LangProvider } from '../lib/i18n/lang-provider.tsx';
import { SiteHeader } from './site-header.tsx';

vi.mock('../app/actions.ts', () => ({ signOut: vi.fn() }));
vi.mock('../app/lang-actions.ts', () => ({ setLanguage: vi.fn().mockResolvedValue(undefined) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(cleanup);

describe('SiteHeader — Dutch by default', () => {
  it('renders the workspace variant in Dutch with no provider', () => {
    render(<SiteHeader balance={42} />);
    expect(screen.getByText('42 credits')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Credits kopen' })).toHaveAttribute('href', '/credits');
    expect(screen.getByRole('link', { name: 'Geschiedenis' })).toHaveAttribute('href', '/geschiedenis');
    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
  });

  it('renders the stripped variant with just the wordmark and the switch', () => {
    render(<SiteHeader stripped />);
    expect(screen.getByRole('link', { name: 'Check de Cijfers' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('group', { name: 'Taal' })).toBeInTheDocument();
  });
});

describe('SiteHeader — phone layout (R9.1, #238)', () => {
  // Browser-only regression: at 375px the wordmark used to wrap onto two
  // lines and blow out the header's fixed h-12 height, clipping the row
  // below it (verified with a real Chromium screenshot, not reproducible in
  // jsdom since it has no layout engine). This pins the CSS contract that
  // prevents the wrap — a real browser check that the classes are present.
  it('keeps the wordmark and balance chip from wrapping', () => {
    render(<SiteHeader balance={42} />);
    const wordmark = screen.getByRole('link', { name: 'Check de Cijfers' });
    expect(wordmark.className).toContain('whitespace-nowrap');
    expect(wordmark.className).toContain('shrink-0');
    expect(screen.getByText('42 credits').className).toContain('whitespace-nowrap');
  });
});

describe('SiteHeader — English under LangProvider', () => {
  it('renders the workspace variant in English', () => {
    render(
      <LangProvider lang="en">
        <SiteHeader balance={42} />
      </LangProvider>,
    );
    expect(screen.getByText('42 credits')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Buy credits' })).toHaveAttribute('href', '/credits');
    expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute('href', '/geschiedenis');
    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
  });

  it('renders the stripped variant with the switch labelled in English', () => {
    render(
      <LangProvider lang="en">
        <SiteHeader stripped />
      </LangProvider>,
    );
    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument();
  });
});

describe('SiteHeader — the NL|EN switch sits next to the account button', () => {
  it('renders the switch alongside the account menu on the workspace variant', () => {
    render(<SiteHeader balance={10} />);
    expect(screen.getByRole('group', { name: 'Taal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
  });
});

// R9.2 (#214, journey WP-C): below `sm` the bar's "Credits kopen"/"Geschiedenis"
// links hide (a Tailwind class only — jsdom applies no layout, so the pin here
// is the className itself) and reappear as the account menu's first two items.
describe('SiteHeader — R9.2 phone header (#214)', () => {
  it('the bar links carry the phone-hidden classes; the account menu, once opened, lists them first with the same hrefs', () => {
    render(<SiteHeader balance={10} />);
    const barCredits = screen.getByRole('link', { name: 'Credits kopen' });
    const barHistory = screen.getByRole('link', { name: 'Geschiedenis' });
    expect(barCredits.className).toMatch(/\bhidden\b/);
    expect(barCredits.className).toMatch(/\bsm:inline\b/);
    expect(barHistory.className).toMatch(/\bhidden\b/);
    expect(barHistory.className).toMatch(/\bsm:inline\b/);

    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    const menu = screen.getByRole('menu');
    const menuLinks = within(menu).getAllByRole('link');
    expect(menuLinks[0]).toHaveAttribute('href', '/credits');
    expect(menuLinks[0]).toHaveTextContent('Credits kopen');
    expect(menuLinks[0].className).toMatch(/\bsm:hidden\b/);
    expect(menuLinks[1]).toHaveAttribute('href', '/geschiedenis');
    expect(menuLinks[1]).toHaveTextContent('Geschiedenis');
    expect(menuLinks[1].className).toMatch(/\bsm:hidden\b/);
  });

  it('wordmark, balance badge and the NL|EN switch stay unconditionally visible (no phone-hidden class)', () => {
    render(<SiteHeader balance={10} />);
    expect(screen.getByRole('link', { name: 'Check de Cijfers' }).className.split(/\s+/)).not.toContain('hidden');
    expect(screen.getByText('10 credits').className.split(/\s+/)).not.toContain('hidden');
    expect(screen.getByRole('group', { name: 'Taal' })).toBeInTheDocument();
  });

  // R9.1 (#238): "Log uit" measured 20px tall at 375px — under the 44px
  // minimum tap target — while 1280px had to stay pixel-identical. Pinned as
  // a CSS-contract test (jsdom has no layout engine to measure real pixels).
  it('gives "Log uit" a 44px tap target only below sm', () => {
    render(<SiteHeader balance={10} />);
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    const logout = screen.getByRole('button', { name: 'Log uit' });
    expect(logout.className).toContain('min-h-11');
    expect(logout.className).toContain('sm:min-h-0');
  });
});
