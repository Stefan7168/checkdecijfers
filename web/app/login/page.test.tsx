// WP135 cosmetic residual (open-questions #135): /login's stripped header
// only renders when WORKSPACE_ENABLED is readable AT REQUEST TIME. The page
// was statically prerendered, freezing the flag read at build time (unset
// there) — so prod never showed the header. Two pins: the page opts out of
// prerendering, and the flag actually toggles the header.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import LoginPage, { dynamic } from './page.tsx';

afterEach(() => {
  cleanup();
  delete process.env.WORKSPACE_ENABLED;
});

describe('/login stripped header (#135 residual)', () => {
  it('opts out of static prerendering so the flag is read per request', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('renders the stripped header when the workspace flag is on', () => {
    process.env.WORKSPACE_ENABLED = '1';
    render(<LoginPage />);
    expect(screen.getByRole('link', { name: 'Check de Cijfers' })).toBeInTheDocument();
    expect(screen.getByText('Inloggen — Check de Cijfers')).toBeInTheDocument();
  });

  it('stays header-less with the flag off (ADR 033 ⟨A5⟩: byte-identical)', () => {
    delete process.env.WORKSPACE_ENABLED;
    render(<LoginPage />);
    expect(screen.queryByRole('link', { name: 'Check de Cijfers' })).toBeNull();
    expect(screen.getByText('Inloggen — Check de Cijfers')).toBeInTheDocument();
  });
});
