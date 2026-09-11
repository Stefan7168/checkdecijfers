// WP-B (journey programme phase 3 R5.1): /privacy renders in both
// languages, states retention terms and the draft note. Pattern mirrors
// app/credits/page.test.tsx.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../components/site-header.tsx', () => ({ SiteHeader: () => <div data-testid="site-header" /> }));

const { getLang } = vi.hoisted(() => ({ getLang: vi.fn() }));
vi.mock('../../lib/i18n/server.ts', () => ({ getLang }));

import PrivacyPage, { generateMetadata } from './page.tsx';

beforeEach(() => {
  getLang.mockResolvedValue('nl');
});

afterEach(() => {
  cleanup();
  getLang.mockReset();
});

describe('PrivacyPage — nl (default)', () => {
  it('renders the heading, retention terms and the draft note', async () => {
    render(await PrivacyPage());
    expect(screen.getByRole('heading', { name: 'Privacy', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/2 jaar/)).toBeInTheDocument();
    // Two sections now say "90 dagen": retention, and the cookies/abuse-limit
    // disclosure (strong-tier review HIGH-2).
    expect(screen.getAllByText(/90 dagen/).length).toBeGreaterThan(0);
    expect(screen.getByText('Concept — wordt nog nagekeken.')).toBeInTheDocument();
  });

  it('names Anthropic (the LLM provider) and Stripe (the payment processor)', async () => {
    render(await PrivacyPage());
    expect(screen.getByText(/Anthropic/)).toBeInTheDocument();
    expect(screen.getByText(/Stripe/)).toBeInTheDocument();
  });

  it('never names Eurostat or another source as available', async () => {
    render(await PrivacyPage());
    expect(document.body.textContent?.toLowerCase()).not.toContain('eurostat');
  });
});

// Strong-tier review HIGH-2: the cookies section must describe what the build
// actually does — the session cookie, the anonymous trial's visitor cookie +
// hashed IP kept 90 days for abuse limits, and aggregate non-identifying usage
// counts — and must NOT claim there is no data collection beyond a session
// cookie.
describe('PrivacyPage — cookies/usage disclosure', () => {
  it('discloses the trial visitor cookie, the hashed IP and the aggregate counts (nl)', async () => {
    render(await PrivacyPage());
    const body = document.body.textContent ?? '';
    expect(body).toContain('sessiecookie');
    expect(body).toContain('bezoekersnummer');
    expect(body).toMatch(/gehashte/);
    expect(body).toMatch(/misbruik van de gratis proef/);
    expect(body).toMatch(/niet herleidbaar naar een persoon/);
    expect(body).not.toMatch(/geen trackingcookies of analytics — alleen/);
  });

  it('discloses the same in English', async () => {
    getLang.mockResolvedValue('en');
    render(await PrivacyPage());
    const body = document.body.textContent ?? '';
    expect(body).toContain('session cookie');
    expect(body).toContain('visitor number');
    expect(body).toMatch(/hashed/);
    expect(body).toMatch(/limit abuse of the free trial/);
    expect(body).toMatch(/no third-party analytics/);
  });
});

describe('PrivacyPage — metadata', () => {
  it('titles the page from the catalogue in each language', async () => {
    expect((await generateMetadata()).title).toBe('Privacy — Check de Cijfers');
    getLang.mockResolvedValue('en');
    expect((await generateMetadata()).title).toBe('Privacy — Check de Cijfers');
  });
});

describe('PrivacyPage — en', () => {
  it('renders the English heading and retention terms', async () => {
    getLang.mockResolvedValue('en');
    render(await PrivacyPage());
    expect(screen.getByRole('heading', { name: 'Privacy', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/2 years/)).toBeInTheDocument();
    expect(screen.getAllByText(/90 days/).length).toBeGreaterThan(0);
    expect(screen.getByText('Draft — under review.')).toBeInTheDocument();
  });
});
