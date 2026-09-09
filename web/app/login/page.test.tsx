// WP135 cosmetic residual (open-questions #135): /login's stripped header
// only renders when WORKSPACE_ENABLED is readable AT REQUEST TIME. The page
// was statically prerendered, freezing the flag read at build time (unset
// there) — so prod never showed the header. Two pins: the page opts out of
// prerendering, and the flag actually toggles the header.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LoginPage, { dynamic } from './page.tsx';

// WP218 phase 4 (#219): the stripped SiteHeader now renders
// <LanguageSwitch/>, which calls useRouter().
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// WP218 phase 4 (#219): LoginPage is now an async Server Component (await
// getLang()) -- jsdom has no Next.js request context for the real
// cookies()/headers() reads.
const { getLang } = vi.hoisted(() => ({ getLang: vi.fn() }));
vi.mock('../../lib/i18n/server.ts', () => ({ getLang }));

afterEach(() => {
  cleanup();
  delete process.env.WORKSPACE_ENABLED;
  getLang.mockReset();
});

describe('/login stripped header (#135 residual)', () => {
  it('opts out of static prerendering so the flag is read per request', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('renders the stripped header when the workspace flag is on', async () => {
    getLang.mockResolvedValue('nl');
    process.env.WORKSPACE_ENABLED = '1';
    render(await LoginPage());
    expect(screen.getByRole('link', { name: 'Check de Cijfers' })).toBeInTheDocument();
    expect(screen.getByText('Inloggen — Check de Cijfers')).toBeInTheDocument();
  });

  it('stays header-less with the flag off (ADR 033 ⟨A5⟩: byte-identical)', async () => {
    getLang.mockResolvedValue('nl');
    delete process.env.WORKSPACE_ENABLED;
    render(await LoginPage());
    expect(screen.queryByRole('link', { name: 'Check de Cijfers' })).toBeNull();
    expect(screen.getByText('Inloggen — Check de Cijfers')).toBeInTheDocument();
  });
});

// WP218 phase 4 (#219): proves the language switch reaches this server page.
describe('/login — en', () => {
  it('renders the English heading and body under getLang() -> "en"', async () => {
    getLang.mockResolvedValue('en');
    render(await LoginPage());
    expect(screen.getByText('Log in — Check de Cijfers')).toBeInTheDocument();
    expect(
      screen.getByText('Enter your email address; you will get a login link. No password needed.'),
    ).toBeInTheDocument();
  });
});
