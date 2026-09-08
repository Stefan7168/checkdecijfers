// WP218 phase 4 (#219): CreditsPage's own copy (balance line, purchase
// banners) through the catalogue via getLang(). The surface-level pins
// (header presence, the page heading) live in app/dormancy.test.tsx; this
// file covers the strings that changed in this sweep.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { currentUserId } = vi.hoisted(() => ({ currentUserId: vi.fn() }));
vi.mock('../../lib/current-user.ts', () => ({ currentUserId }));
vi.mock('../../lib/db.ts', () => ({ getDb: vi.fn(() => ({})) }));
vi.mock('../../backend/billing/index.ts', () => ({
  getBalance: vi.fn().mockResolvedValue(80),
  getActivePacks: vi.fn().mockResolvedValue([{ id: 'pack-1', label: '100 credits voor €5' }]),
}));
vi.mock('../../components/site-header.tsx', () => ({ SiteHeader: () => <div data-testid="site-header" /> }));

const { getLang } = vi.hoisted(() => ({ getLang: vi.fn() }));
vi.mock('../../lib/i18n/server.ts', () => ({ getLang }));

import CreditsPage from './page.tsx';

const emptySearch = Promise.resolve({});

beforeEach(() => {
  currentUserId.mockResolvedValue('user-1');
  getLang.mockResolvedValue('nl');
});

afterEach(() => {
  cleanup();
  currentUserId.mockReset();
  getLang.mockReset();
});

describe('CreditsPage — nl (default)', () => {
  it('renders the balance line and the success/cancelled banners', async () => {
    render(await CreditsPage({ searchParams: Promise.resolve({ purchase: 'success' }) }));
    expect(screen.getByText(/Je huidige saldo:/)).toHaveTextContent('Je huidige saldo: 80 credits.');
    expect(
      screen.getByText('Betaling gelukt — je credits worden bijgeschreven zodra Stripe de betaling bevestigt.'),
    ).toBeInTheDocument();
  });

  it('renders the cancelled banner', async () => {
    render(await CreditsPage({ searchParams: Promise.resolve({ purchase: 'cancelled' }) }));
    expect(screen.getByText('Betaling geannuleerd.')).toBeInTheDocument();
  });
});

describe('CreditsPage — en', () => {
  it('renders the English balance line and heading', async () => {
    getLang.mockResolvedValue('en');
    render(await CreditsPage({ searchParams: emptySearch }));
    expect(screen.getByText('Credits — Check de Cijfers')).toBeInTheDocument();
    expect(screen.getByText(/Your current balance:/)).toHaveTextContent('Your current balance: 80 credits.');
  });
});
