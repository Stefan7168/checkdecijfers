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

// Session 110 a11y audit (#Fix-now 4): captures the props this page passes
// to GalleryGrid, so the headingLevel={2} wiring is pinned here rather than
// only exercised inside components/gallery.test.tsx's own render.
const galleryGridProps = vi.hoisted(() => ({ current: undefined as { headingLevel?: number } | undefined }));
vi.mock('../../components/gallery.tsx', () => ({
  GalleryGrid: (props: { headingLevel?: number }) => {
    galleryGridProps.current = props;
    return null;
  },
}));

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
        'Elke kaart hieronder is gebouwd uit officiële CBS-cijfers, met bron en datum erbij — door dezelfde deterministische motor die ook antwoorden geeft in de chat. Klik op Inzichten om te zien wat erin opvalt.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Zelf inline insluiten komt binnenkort.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Begin met vragen' })).toHaveAttribute('href', '/login');
  });

  // Session 110 a11y audit (#Fix-now 4): this page's <h1> has no <h2> before
  // the cards, so GalleryGrid must render its card titles as <h2>, not the
  // default <h3> (axe-core heading-order, moderate).
  it('passes headingLevel={2} to GalleryGrid', async () => {
    getLang.mockResolvedValue('nl');
    render(await GaleryPage());
    expect(galleryGridProps.current).toEqual({ headingLevel: 2 });
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
