// WP218 phase 4 (#219): site-header.tsx had no test file before this task
// (i18n-string-inventory.md). Pins: the existing Dutch copy stays
// byte-identical under the default (no-provider) language, the header
// renders English under <LangProvider lang="en">, and both variants (the
// stripped /login+landing header and the workspace header with a balance)
// carry the NL|EN switch next to the account button / wordmark.
import { cleanup, render, screen } from '@testing-library/react';
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
