// WP218 phase 4 (#219): BuyButton's own label + error surface through the
// catalogue via useT().
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LangProvider } from '../../lib/i18n/lang-provider.tsx';
import { BuyButton } from './buy-button.tsx';

const { createCheckoutSession } = vi.hoisted(() => ({ createCheckoutSession: vi.fn() }));
vi.mock('./actions.ts', () => ({ createCheckoutSession }));

afterEach(() => {
  cleanup();
  createCheckoutSession.mockReset();
});

describe('BuyButton — nl (default)', () => {
  it('renders "Kopen" and shows a returned error inline', async () => {
    createCheckoutSession.mockResolvedValue({ error: 'Onbekend of niet meer beschikbaar pakket.' });
    render(<BuyButton packId="pack-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Kopen' }));
    expect(await screen.findByText('Onbekend of niet meer beschikbaar pakket.')).toBeInTheDocument();
  });
});

describe('BuyButton — en', () => {
  it('renders "Buy" under LangProvider lang="en"', () => {
    createCheckoutSession.mockResolvedValue(undefined);
    render(
      <LangProvider lang="en">
        <BuyButton packId="pack-1" />
      </LangProvider>,
    );
    expect(screen.getByRole('button', { name: 'Buy' })).toBeInTheDocument();
  });
});

// Row 13 (session 110 UX audit): four packs' Buy buttons all shared the
// SAME accessible name ("Buy" / "Kopen"), unusable by a screen-reader user.
describe('BuyButton — packDescription (row 13)', () => {
  it('uses packDescription as the accessible name when given', () => {
    render(<BuyButton packId="pack-1" packDescription="Koop €5,00 — 100 credits" />);
    expect(screen.getByRole('button', { name: 'Koop €5,00 — 100 credits' })).toBeInTheDocument();
    // Still renders the plain visible "Kopen" text — only the accessible
    // name changes, not what's on screen.
    expect(screen.getByText('Kopen')).toBeInTheDocument();
  });

  it('falls back to the plain "Kopen" accessible name when packDescription is absent', () => {
    render(<BuyButton packId="pack-1" />);
    expect(screen.getByRole('button', { name: 'Kopen' })).toBeInTheDocument();
  });
});
