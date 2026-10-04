// #353: the Netherlands SEO landing page's shell — heading, two intro
// paragraphs, the "what we hold" list (open by default), the CTA, in both
// languages; metadata follows the SEO switch. The gallery grid and the
// coverage list are mocked here (their own tests cover them), as
// app/galerij/page.test.tsx does.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_URL } from '../../lib/app-url.ts';

vi.mock('../../components/site-header.tsx', () => ({ SiteHeader: () => <div data-testid="site-header" /> }));

const galleryGridProps = vi.hoisted(() => ({ current: undefined as { headingLevel?: number } | undefined }));
vi.mock('../../components/gallery.tsx', () => ({
  GalleryGrid: (props: { headingLevel?: number }) => {
    galleryGridProps.current = props;
    return null;
  },
}));

const coverageProps = vi.hoisted(() => ({ current: undefined as Record<string, unknown> | undefined }));
vi.mock('../../components/coverage-disclosure.tsx', () => ({
  CoverageDisclosureView: (props: Record<string, unknown>) => {
    coverageProps.current = props;
    return <div data-testid="coverage" />;
  },
}));

const { loadCoverageDisclosure } = vi.hoisted(() => ({ loadCoverageDisclosure: vi.fn() }));
vi.mock('../../lib/coverage-disclosure.ts', () => ({ loadCoverageDisclosure }));

const { getLang } = vi.hoisted(() => ({ getLang: vi.fn() }));
vi.mock('../../lib/i18n/server.ts', () => ({ getLang }));

const flag = vi.hoisted(() => ({ on: false }));
vi.mock('../../lib/seo-pages.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/seo-pages.ts')>();
  return {
    ...real,
    get SEO_PAGES_INDEXABLE() {
      return flag.on;
    },
  };
});

import NetherlandsCbsDataPage, { generateMetadata } from './page.tsx';

const COVERAGE = { tables: [{ id: '86141NED', title: 'CPI', sourceDisplayName: 'CBS', syncedOn: '2026-08-26', concepts: ['inflatie'], example: null }] };

afterEach(() => {
  cleanup();
  getLang.mockReset();
  loadCoverageDisclosure.mockReset();
  galleryGridProps.current = undefined;
  coverageProps.current = undefined;
});

describe('NetherlandsCbsDataPage — en', () => {
  it('renders the heading, the two intro paragraphs, the holdings heading, the grid and the CTA', async () => {
    getLang.mockResolvedValue('en');
    loadCoverageDisclosure.mockResolvedValue(COVERAGE);
    render(await NetherlandsCbsDataPage());
    expect(screen.getByRole('heading', { name: 'Netherlands statistics from CBS, as charts', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/official statistics of the Netherlands/)).toBeInTheDocument();
    expect(screen.getByText(/traceable to a CBS table cell/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What we hold today', level: 2 })).toBeInTheDocument();
    expect(galleryGridProps.current).toEqual({ headingLevel: 3 });
    expect(coverageProps.current).toMatchObject({ coverage: COVERAGE, defaultOpen: true });
    expect(screen.getByRole('link', { name: 'Start asking' })).toHaveAttribute('href', '/login');
  });

  it('still renders (no holdings list) when the coverage build has never succeeded', async () => {
    getLang.mockResolvedValue('en');
    loadCoverageDisclosure.mockResolvedValue(null);
    render(await NetherlandsCbsDataPage());
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(coverageProps.current).toMatchObject({ coverage: null });
  });
});

describe('NetherlandsCbsDataPage — nl', () => {
  it('renders the Dutch shell', async () => {
    getLang.mockResolvedValue('nl');
    loadCoverageDisclosure.mockResolvedValue(COVERAGE);
    render(await NetherlandsCbsDataPage());
    expect(screen.getByRole('heading', { name: 'Nederlandse statistiek van het CBS, als grafieken', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Wat we vandaag in huis hebben', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Begin met vragen' })).toHaveAttribute('href', '/login');
  });
});

describe('generateMetadata', () => {
  it('OFF: noindex, no canonical, titled per language', async () => {
    flag.on = false;
    getLang.mockResolvedValue('en');
    const meta = await generateMetadata();
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.alternates).toBeUndefined();
    expect(meta.title).toBe('Netherlands CBS data as charts — graphmaker.studio');
    expect(typeof meta.description).toBe('string');
  });

  it('ON: index + canonical under the app URL', async () => {
    flag.on = true;
    getLang.mockResolvedValue('nl');
    const meta = await generateMetadata();
    expect(meta.robots).toEqual({ index: true, follow: true });
    expect(meta.alternates).toEqual({ canonical: `${APP_URL}/netherlands-cbs-data` });
    expect(meta.title).toBe('Nederlandse CBS-data als grafieken — graphmaker.studio');
  });
});
