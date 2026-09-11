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
  getActivePacks: vi
    .fn()
    .mockResolvedValue([{ id: 'pack-1', label: '100 credits voor €5', credits: 100, priceCents: 500, currency: 'eur' }]),
  getActionClassPrice: vi.fn().mockResolvedValue(20),
  getSignupGrantCredits: vi.fn().mockResolvedValue(100),
}));
vi.mock('../../components/site-header.tsx', () => ({ SiteHeader: () => <div data-testid="site-header" /> }));

const { getLang } = vi.hoisted(() => ({ getLang: vi.fn() }));
vi.mock('../../lib/i18n/server.ts', () => ({ getLang }));

import CreditsPage, { pricePerQuestionLabel, questionsInPack } from './page.tsx';

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

  // R10 (experience-improvement-plan, session 96): the #76 explainer, the
  // never-expire sentence, and the per-pack question count/price — every
  // number read live from the mocked pricing tables above (simple=20,
  // grant=100, pack credits=100/priceCents=500), never hardcoded here.
  it('renders the signup-grant explainer, the never-expire sentence, and the per-pack question count', async () => {
    render(await CreditsPage({ searchParams: emptySearch }));
    expect(
      screen.getByText(
        "Bij aanmelding krijg je eenmalig 100 credits. Een gewone vraag kost 20 credits — 100 credits zijn dus goed voor zo'n 5 vragen.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Credits verlopen nooit. Geen abonnement.')).toBeInTheDocument();
    expect(screen.getByText('≈ 5 gewone vragen (€1 per vraag)')).toBeInTheDocument();
  });
});

describe('questionsInPack / pricePerQuestionLabel (pure helpers)', () => {
  const pack = { id: 'p', label: 'x', credits: 500, priceCents: 1000, currency: 'eur' };

  it('floors rather than rounds, matching account-panel.tsx\'s grantQuestions convention', () => {
    expect(questionsInPack({ ...pack, credits: 45 }, 20)).toBe(2);
  });

  it('questionsInPack returns 0 when simplePrice is 0 — never a division by zero', () => {
    expect(questionsInPack(pack, 0)).toBe(0);
  });

  // Review fix (session 96): pricePerQuestionLabel now takes the
  // already-computed `questions` count directly (the caller — the page's
  // own JSX — calls questionsInPack exactly once and reuses it), rather
  // than re-deriving it from simplePrice a second time.
  it('pricePerQuestionLabel returns null for 0 questions', () => {
    expect(pricePerQuestionLabel(pack, 0)).toBeNull();
  });

  it('formats a fractional result with two decimals', () => {
    // 500 credits / 20 = 25 questions; 1000 cents / 25 = 40 cents = €0.40.
    expect(pricePerQuestionLabel(pack, 25)).toBe('€0.40');
  });

  it('formats a whole-euro result with no decimals', () => {
    // 100 credits / 20 = 5 questions; 2000 cents / 5 = 400 cents = €4.
    expect(pricePerQuestionLabel({ ...pack, credits: 100, priceCents: 2000 }, 5)).toBe('€4');
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
