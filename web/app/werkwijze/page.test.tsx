// WP-B (journey programme phase 4 R6): /werkwijze renders in both languages,
// carries the public-claim sentence (never "0% hallucination") and a visible
// draft note. Pattern mirrors app/credits/page.test.tsx.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../components/site-header.tsx', () => ({ SiteHeader: () => <div data-testid="site-header" /> }));

const { getLang } = vi.hoisted(() => ({ getLang: vi.fn() }));
vi.mock('../../lib/i18n/server.ts', () => ({ getLang }));

import WerkwijzePage from './page.tsx';

beforeEach(() => {
  getLang.mockResolvedValue('nl');
});

afterEach(() => {
  cleanup();
  getLang.mockReset();
});

describe('WerkwijzePage — nl (default)', () => {
  it('renders the heading, the public-claim sentence and the draft note', async () => {
    render(await WerkwijzePage());
    expect(screen.getByRole('heading', { name: 'Hoe we werken', level: 1 })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Elk getal dat we tonen is herleidbaar naar een officiële CBS-cel, met bron en datum erbij getoond.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Concept — wordt nog nagekeken.')).toBeInTheDocument();
  });

  it('never claims "0% hallucinatie" anywhere on the page', async () => {
    render(await WerkwijzePage());
    expect(document.body.textContent).not.toMatch(/0%/);
    expect(document.body.textContent?.toLowerCase()).not.toContain('hallucinatie');
  });

  it('explains what the claim does not cover', async () => {
    render(await WerkwijzePage());
    expect(screen.getByText(/eigen geüploade data/)).toBeInTheDocument();
  });
});

describe('WerkwijzePage — en', () => {
  it('renders the English heading and public-claim sentence', async () => {
    getLang.mockResolvedValue('en');
    render(await WerkwijzePage());
    expect(screen.getByRole('heading', { name: 'How we work', level: 1 })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Every number we show is traceable to an official CBS cell, with source and date shown alongside it.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Draft — under review.')).toBeInTheDocument();
  });

  it('never claims "0% hallucination" anywhere on the page', async () => {
    getLang.mockResolvedValue('en');
    render(await WerkwijzePage());
    expect(document.body.textContent?.toLowerCase()).not.toContain('hallucination');
  });
});
