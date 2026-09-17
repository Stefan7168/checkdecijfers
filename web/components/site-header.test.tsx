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
    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
    // Owner punch-list item 5 (session 102): Geschiedenis is reachable ONLY
    // from the account dropdown now — nothing to find before it's opened.
    expect(screen.queryByRole('link', { name: 'Geschiedenis' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    expect(screen.getByRole('link', { name: 'Geschiedenis' })).toHaveAttribute('href', '/geschiedenis');
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
    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'History' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute('href', '/geschiedenis');
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

// R9.2 (#214, journey WP-C): below `sm` the bar's "Credits kopen" link hides
// (a Tailwind class only — jsdom applies no layout, so the pin here is the
// className itself) and reappears as the account menu's first item.
// Owner punch-list item 5 (session 102): "Geschiedenis" no longer has a bar
// copy at all — it lives in the account menu at every width now, so it
// carries no `sm:hidden` class of its own (contrast Credits, which still
// does, since its bar copy exists at `sm` and up).
describe('SiteHeader — R9.2 phone header (#214)', () => {
  it('the Credits bar link carries the phone-hidden classes; the account menu, once opened, lists Credits then Geschiedenis with the same hrefs', () => {
    render(<SiteHeader balance={10} />);
    const barCredits = screen.getByRole('link', { name: 'Credits kopen' });
    expect(barCredits.className).toMatch(/\bhidden\b/);
    expect(barCredits.className).toMatch(/\bsm:inline\b/);
    // No bar copy of Geschiedenis exists anywhere outside the menu.
    expect(screen.queryByRole('link', { name: 'Geschiedenis' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    const menu = screen.getByRole('menu');
    const menuLinks = within(menu).getAllByRole('link');
    expect(menuLinks[0]).toHaveAttribute('href', '/credits');
    expect(menuLinks[0]).toHaveTextContent('Credits kopen');
    expect(menuLinks[0].className).toMatch(/\bsm:hidden\b/);
    expect(menuLinks[1]).toHaveAttribute('href', '/geschiedenis');
    expect(menuLinks[1]).toHaveTextContent('Geschiedenis');
    expect(menuLinks[1].className).not.toMatch(/\bsm:hidden\b/);
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

// Owner punch-list item 4 (session 102): the light/dark/system toggle moved
// from the chat card's header row (workspace.tsx) into this account menu —
// ThemeToggle's own accessible contract (role="group" named "Thema", three
// aria-pressed buttons) is unchanged, just relocated. The Account trigger
// also grows a decorative chevron; its accessible name must stay exactly
// "Account" (the icon is aria-hidden, so it contributes no name of its own).
describe('SiteHeader — theme toggle inside the account menu, and the Account chevron (owner punch-list item 4)', () => {
  it('shows the theme toggle inside the opened account menu', () => {
    render(<SiteHeader balance={10} />);
    expect(screen.queryByRole('group', { name: 'Thema' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    const menu = screen.getByRole('menu');
    const themeGroup = within(menu).getByRole('group', { name: 'Thema' });
    expect(themeGroup).toBeInTheDocument();
    expect(within(themeGroup).getAllByRole('button', { name: /thema/i })).toHaveLength(3);
  });

  it('the Account trigger carries a decorative chevron without changing its accessible name', () => {
    render(<SiteHeader balance={10} />);
    const trigger = screen.getByRole('button', { name: 'Account' });
    expect(trigger).toHaveAccessibleName('Account');
    expect(trigger.querySelector('svg')).not.toBeNull();
    expect(trigger.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});

// Owner punch-list item 6 (session 102): the account dropdown is becoming
// the general nav hub (it already grew Geschiedenis and the theme toggle in
// items 4/5 above) — a link to the new /about page belongs there too.
describe('SiteHeader — link to /about in the account menu (owner punch-list item 6)', () => {
  it('lists a link to /about inside the opened account menu', () => {
    render(<SiteHeader balance={10} />);
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    const menu = screen.getByRole('menu');
    const aboutLinks = within(menu).getAllByRole('link', { name: /over/i });
    expect(aboutLinks.some((link) => link.getAttribute('href') === '/about')).toBe(true);
  });
});

// Row 8 (session 110 UX audit, #P2): at 375px the Account button's right
// edge measured 4px past the viewport edge (right: 379 on a 375-wide
// screen) — the header's own px-3 right padding plus the gap before the
// button left no room. jsdom has no layout engine, so this pins the
// CSS-contract fix the same way the wordmark/logout tap-target tests above
// do: a narrower right-side gutter below `sm`.
describe('SiteHeader — phone right-edge gutter (row 8)', () => {
  it('uses a narrower horizontal padding below sm than at sm and up', () => {
    render(<SiteHeader balance={10} />);
    const header = document.querySelector('header')!;
    expect(header.className).toMatch(/\bpx-2\b/);
    expect(header.className).toMatch(/\bsm:px-4\b/);
    expect(header.className).not.toMatch(/\bpx-3\b/);
  });
});

// Row 8 recheck (session 110 UX audit pass 5, #P2): the pass-1 padding fix
// above did not hold — every item in the right cluster (this balance badge,
// the language switch, the Account button, which inherits `shrink-0` from
// the shared Button component's own base variant class) refused to shrink,
// so the cluster's min-content width still pushed the Account button 8px
// past a 375px viewport regardless of padding. The real fix lets the least
// important item — the balance badge — give up its width first.
describe('SiteHeader — right cluster can shrink before the Account button clips (row 8, pass 5)', () => {
  it('lets the balance badge shrink and truncate instead of forcing its full content width', () => {
    render(<SiteHeader balance={12345} />);
    const badge = screen.getByText(/12[.,]345|12345/).closest('span, div') ?? screen.getByText(/12[.,]345|12345/);
    expect(badge.className).toMatch(/\bmin-w-0\b/);
    expect(badge.className).toMatch(/\btruncate\b/);
    expect(badge.className).not.toMatch(/\bshrink-0\b/);
  });

  it('keeps the Account button legible (not the item forced to shrink)', () => {
    render(<SiteHeader balance={10} />);
    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
  });
});
