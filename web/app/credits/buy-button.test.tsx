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
