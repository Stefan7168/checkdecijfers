// Owner punch-list item 6 (session 102): /about — same shell as /privacy
// (app/privacy/page.test.tsx is the direct model). Pins: the page renders in
// both languages, has an h1, and links the real contact address as a mailto
// link (not a placeholder like privacy.contactBody's TODO).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../components/site-header.tsx', () => ({ SiteHeader: () => <div data-testid="site-header" /> }));

const { getLang } = vi.hoisted(() => ({ getLang: vi.fn() }));
vi.mock('../../lib/i18n/server.ts', () => ({ getLang }));

import AboutPage, { generateMetadata } from './page.tsx';

beforeEach(() => {
  getLang.mockResolvedValue('nl');
});

afterEach(() => {
  cleanup();
  getLang.mockReset();
});

describe('AboutPage — nl (default)', () => {
  it('renders an h1 heading and the about copy', async () => {
    render(await AboutPage());
    expect(screen.getByRole('heading', { name: 'Over ons', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/officiële CBS-statistieken/)).toBeInTheDocument();
  });

  it('links the real contact address as a mailto link', async () => {
    render(await AboutPage());
    const link = screen.getByRole('link', { name: 'hi@checkdecijfers.nl' });
    expect(link).toHaveAttribute('href', 'mailto:hi@checkdecijfers.nl');
  });
});

describe('AboutPage — en', () => {
  it('renders the English heading and copy', async () => {
    getLang.mockResolvedValue('en');
    render(await AboutPage());
    expect(screen.getByRole('heading', { name: 'About us', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/official CBS statistics/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'hi@checkdecijfers.nl' })).toHaveAttribute(
      'href',
      'mailto:hi@checkdecijfers.nl',
    );
  });
});

describe('AboutPage — metadata', () => {
  it('titles the page from the catalogue in each language', async () => {
    expect((await generateMetadata()).title).toBe('Over ons — Check de Cijfers');
    getLang.mockResolvedValue('en');
    expect((await generateMetadata()).title).toBe('About us — Check de Cijfers');
  });
});
