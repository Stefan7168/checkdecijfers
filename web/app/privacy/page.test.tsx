// WP-B (journey programme phase 3 R5.1): /privacy renders in both
// languages, states retention terms and the draft note. Pattern mirrors
// app/credits/page.test.tsx.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../components/site-header.tsx', () => ({ SiteHeader: () => <div data-testid="site-header" /> }));

const { getLang } = vi.hoisted(() => ({ getLang: vi.fn() }));
vi.mock('../../lib/i18n/server.ts', () => ({ getLang }));

import PrivacyPage from './page.tsx';

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
    expect(screen.getByText(/90 dagen/)).toBeInTheDocument();
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

describe('PrivacyPage — en', () => {
  it('renders the English heading and retention terms', async () => {
    getLang.mockResolvedValue('en');
    render(await PrivacyPage());
    expect(screen.getByRole('heading', { name: 'Privacy', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/2 years/)).toBeInTheDocument();
    expect(screen.getByText(/90 days/)).toBeInTheDocument();
    expect(screen.getByText('Draft — under review.')).toBeInTheDocument();
  });
});
