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
  getActivePacks: vi.fn().mockResolvedValue([
    { id: 'pack-1', label: '100 credits voor €5', priceCents: 500, currency: 'eur', credits: 100 },
    // Row 7 (session 110 UX audit): the exact numbers the audit flagged —
    // "€30 — 2.000 credits" with an inconsistent "≈ 1250" (no separator) —
    // came from the real €250/25000-credit pack, reproduced here so the
    // assertions below exercise the same missing-thousands-separator bug.
    { id: 'pack-2', label: '25000 credits voor €250', priceCents: 25000, currency: 'eur', credits: 25000 },
  ]),
  getActionClassPrice: vi.fn().mockResolvedValue(20),
  getSignupGrantCredits: vi.fn().mockResolvedValue(100),
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
    expect(screen.getByText('Bedankt! Je saldo verschijnt hier zodra Stripe de betaling bevestigt.')).toBeInTheDocument();
  });

  it('renders the cancelled banner', async () => {
    render(await CreditsPage({ searchParams: Promise.resolve({ purchase: 'cancelled' }) }));
    expect(screen.getByText('Betaling geannuleerd.')).toBeInTheDocument();
  });

  // R10 (journey WP-C): per-pack "≈ N gewone vragen" + €/vraag, computed
  // from THIS pack's priceCents/credits (500 cents, 100 credits) and the
  // live simple price (20) — never hardcoded, never client-recomputed.
  // 100 credits / 20 per question = 5 questions; €5.00 / 5 = €1.00/vraag.
  it('shows each pack\'s ≈N questions and €/question, computed from its own priceCents/credits and the live simple price', async () => {
    render(await CreditsPage({ searchParams: emptySearch }));
    expect(screen.getByText('≈ 5 gewone vragen · € 1,00 per vraag')).toBeInTheDocument();
  });

  // Row 7 (session 110 UX audit): every number on the page — the pack's own
  // price/credits line AND the "≈N questions" line — goes through the same
  // nl-NL Intl.NumberFormat, so a 4/5-digit count gets its thousands
  // separator instead of reading as one long digit run.
  it('formats the pack price/credits line and the ≈N questions count with nl-NL thousands separators', async () => {
    render(await CreditsPage({ searchParams: emptySearch }));
    expect(screen.getByText('€ 250,00 — 25.000 credits')).toBeInTheDocument();
    expect(screen.getByText('≈ 1.250 gewone vragen · € 0,20 per vraag')).toBeInTheDocument();
  });

  it('gives each Buy button an accessible name that includes its own pack (price + credits)', async () => {
    render(await CreditsPage({ searchParams: emptySearch }));
    // nl-NL's Intl.NumberFormat currency output uses a NON-BREAKING space
    // (U+00A0) between "€" and the amount — getByRole's accessible-name
    // match is exact (unlike getByText's whitespace-normalizing default),
    // so the expectation has to use the real character, not a plain space.
    expect(screen.getByRole('button', { name: 'Koop € 5,00 — 100 credits' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Koop € 250,00 — 25.000 credits' })).toBeInTheDocument();
  });

  it('shows the "credits never expire" line and the #76 explainer under the balance', async () => {
    render(await CreditsPage({ searchParams: emptySearch }));
    expect(screen.getByText('Credits verlopen nooit. Geen abonnement.')).toBeInTheDocument();
    expect(screen.getByText(/Bij aanmelding krijg je eenmalig 100 credits/)).toBeInTheDocument();
  });

  // Task 11 (#205): the Pro subscription Checkout's own success/cancel pair
  // — a SEPARATE `pro` query param from the pack flow's `purchase` above, so
  // the two banners can never both show for the same redirect.
  it('renders the Pro success banner for ?pro=success, distinct from the pack purchase banner', async () => {
    render(await CreditsPage({ searchParams: Promise.resolve({ pro: 'success' }) }));
    expect(screen.getByText('Bedankt! Je Pro-abonnement verschijnt hier zodra Stripe de betaling bevestigt.')).toBeInTheDocument();
    expect(screen.queryByText('Bedankt! Je saldo verschijnt hier zodra Stripe de betaling bevestigt.')).toBeNull();
  });

  it('renders the Pro cancelled banner for ?pro=cancelled', async () => {
    render(await CreditsPage({ searchParams: Promise.resolve({ pro: 'cancelled' }) }));
    expect(screen.getByText('Pro-abonnement geannuleerd.')).toBeInTheDocument();
  });
});

describe('CreditsPage — en', () => {
  it('renders the English balance line and heading', async () => {
    getLang.mockResolvedValue('en');
    render(await CreditsPage({ searchParams: emptySearch }));
    // Row 14 (session 110 UX audit): the h1 is just "Credits", not "Credits
    // — Check de Cijfers" (the site name isn't repeated in the heading).
    expect(screen.getByRole('heading', { level: 1, name: 'Credits' })).toBeInTheDocument();
    expect(screen.getByText(/Your current balance:/)).toHaveTextContent('Your current balance: 80 credits.');
  });

  // The euro amount is formatted with the PAGE language's locale (en-GB here,
  // nl-NL above) — same price, reader's own decimal/grouping convention.
  it('shows each pack\'s ≈N questions and €/question in English, formatted en-GB', async () => {
    getLang.mockResolvedValue('en');
    render(await CreditsPage({ searchParams: emptySearch }));
    expect(screen.getByText('≈ 5 simple questions · €1.00 per question')).toBeInTheDocument();
  });

  // Row 7: the same consistency fix, en-GB grouping (comma, not a dot).
  it('formats the pack price/credits line and the ≈N questions count with en-GB thousands separators', async () => {
    getLang.mockResolvedValue('en');
    render(await CreditsPage({ searchParams: emptySearch }));
    expect(screen.getByText('€250.00 — 25,000 credits')).toBeInTheDocument();
    expect(screen.getByText('≈ 1,250 simple questions · €0.20 per question')).toBeInTheDocument();
  });

  // Row 13: the accessible name in English too ("Buy", not just "Kopen").
  it('gives each Buy button an English accessible name that includes its own pack', async () => {
    getLang.mockResolvedValue('en');
    render(await CreditsPage({ searchParams: emptySearch }));
    expect(screen.getByRole('button', { name: 'Buy €5.00 — 100 credits' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buy €250.00 — 25,000 credits' })).toBeInTheDocument();
  });
});
