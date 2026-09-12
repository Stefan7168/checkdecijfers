// #237/ADR 046: /galerij's page shell — heading, intro, CTA and noindex
// metadata, in both languages. The gallery grid itself (real ChartView,
// digit-scan, zero-server-action-calls) is covered directly against
// GalleryGrid in components/gallery.test.tsx (the ontdek.test.tsx precedent
// for testing an async Server Component subtree in isolation) — jsdom's
// client renderer cannot invoke an async component nested as plain JSX the
// way page.tsx does (Next's own RSC pipeline resolves that at request time).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../components/site-header.tsx', () => ({ SiteHeader: () => <div data-testid="site-header" /> }));
vi.mock('../../components/gallery.tsx', () => ({ GalleryGrid: () => null }));

const { getLang } = vi.hoisted(() => ({ getLang: vi.fn() }));
vi.mock('../../lib/i18n/server.ts', () => ({ getLang }));

import GaleryPage, { generateMetadata } from './page.tsx';

afterEach(() => {
  cleanup();
  getLang.mockReset();
});

describe('GaleryPage — nl', () => {
  it('renders the heading, intro, embed note and the CTA', async () => {
    getLang.mockResolvedValue('nl');
    render(await GaleryPage());
    expect(screen.getByRole('heading', { name: 'De galerij', level: 1 })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Elke kaart hieronder is een echte, gesourcete grafiek — gebouwd door dezelfde deterministische motor die ook antwoorden geeft in de chat. Stel de vraag, zie de grafiek, en volg meteen wat erin opvalt.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Zelf inline insluiten komt binnenkort.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Begin met vragen' })).toHaveAttribute('href', '/login');
  });

  it('sets noindex metadata', async () => {
    getLang.mockResolvedValue('nl');
    expect(await generateMetadata()).toMatchObject({
      title: 'Galerij — Check de Cijfers',
      robots: { index: false, follow: false },
    });
  });

  it('never names Eurostat or any other future source (principle c: never claim what is not built)', async () => {
    getLang.mockResolvedValue('nl');
    render(await GaleryPage());
    expect(document.body.textContent?.toLowerCase()).not.toContain('eurostat');
  });
});

describe('GaleryPage — en', () => {
  it('renders the English heading, intro and CTA', async () => {
    getLang.mockResolvedValue('en');
    render(await GaleryPage());
    expect(screen.getByRole('heading', { name: 'The gallery', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start asking' })).toHaveAttribute('href', '/login');
  });

  it('sets noindex metadata', async () => {
    getLang.mockResolvedValue('en');
    expect(await generateMetadata()).toMatchObject({
      title: 'Gallery — Check de Cijfers',
      robots: { index: false, follow: false },
    });
  });
});
