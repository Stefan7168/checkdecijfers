// WP218 phase 4 (#219), Task 3: Landing is now an async Server Component
// (await getLang()). Rendered via `await Landing()` (the trial.test.tsx /
// ontdek.test.tsx precedent), never `<Landing/>` directly — jsdom's client
// renderer cannot invoke an async function component itself.
//
// gallery.tsx and trial.tsx are mocked out: both mount their OWN async
// Server Component reads (GalleryTeaser / TrialGate), which is exactly the
// "render the pure part" carve-out the brief allows — their own suites
// already cover that subtree in isolation. #237/ADR 046: the landing's old
// Ontdek section (ontdek.tsx) was replaced by the gallery teaser; ontdek.tsx
// itself stays compiling (still used elsewhere) but is no longer mounted
// here, so this suite no longer mocks it.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// WP-LOOK part (c): the landing reads the story set itself (to pick the
// hero and tell the teaser what to skip); HeroStory/GalleryTeaser are
// mocked like before — gallery.test.tsx covers them — but heroStoryFor is
// the real one, since the exclusion is the landing's own logic.
const galleryProps = vi.hoisted(() => ({ teaser: [] as unknown[] }));
vi.mock('./gallery.tsx', async (importOriginal) => {
  const real = await importOriginal<typeof import('./gallery.tsx')>();
  return {
    heroStoryFor: real.heroStoryFor,
    HERO_STORY_SLUG: real.HERO_STORY_SLUG,
    HeroStory: () => <div data-testid="hero-story" />,
    GalleryTeaser: (props: unknown) => {
      galleryProps.teaser.push(props);
      return null;
    },
  };
});
const { getGalleryStories } = vi.hoisted(() => ({ getGalleryStories: vi.fn() }));
vi.mock('../lib/ontdek.ts', () => ({ getGalleryStories }));
vi.mock('./trial.tsx', () => ({ TrialSectie: () => null }));

const { getLang } = vi.hoisted(() => ({ getLang: vi.fn() }));
vi.mock('../lib/i18n/server.ts', () => ({ getLang }));

import { Landing } from './landing.tsx';

beforeEach(() => {
  getGalleryStories.mockResolvedValue([
    { slug: 'consumentenvertrouwen', spec: {} },
    { slug: 'inflatie', spec: {} },
  ]);
});

afterEach(() => {
  cleanup();
  getLang.mockReset();
  getGalleryStories.mockReset();
  galleryProps.teaser.length = 0;
});

describe('Landing — nl (default)', () => {
  it('leads with the chart-first headline and the public claim (ADR 063, WP-LOOK part c)', async () => {
    getLang.mockResolvedValue('nl');
    render(await Landing());
    expect(screen.getByRole('heading', { name: 'Stel een vraag. Deel de grafiek.', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Begin met vragen' })).toBeInTheDocument();
    expect(screen.getByText(/herleidbaar tot een officiële tabel van CBS of Eurostat/)).toBeInTheDocument();
  });

  it('shows a REAL chart above the fold (HeroStory) and no frozen text example any more', async () => {
    getLang.mockResolvedValue('nl');
    render(await Landing());
    expect(screen.getByTestId('hero-story')).toBeInTheDocument();
    expect(screen.queryByText(/Het consumentenvertrouwen in Nederland was in juni 2026/)).not.toBeInTheDocument();
  });

  it('tells the teaser to skip the hero story so no chart shows twice', async () => {
    getLang.mockResolvedValue('nl');
    render(await Landing());
    expect(galleryProps.teaser).toEqual([{ excludeSlug: 'inflatie' }]);
  });

  it('falls back to the first built story for the teaser exclusion when inflation did not build', async () => {
    getLang.mockResolvedValue('nl');
    getGalleryStories.mockResolvedValue([{ slug: 'huizenprijzen', spec: {} }]);
    render(await Landing());
    expect(galleryProps.teaser).toEqual([{ excludeSlug: 'huizenprijzen' }]);
  });

  it('passes no exclusion when nothing is built yet (the hero shows its placeholder)', async () => {
    getLang.mockResolvedValue('nl');
    getGalleryStories.mockResolvedValue([]);
    render(await Landing());
    expect(galleryProps.teaser).toEqual([{ excludeSlug: undefined }]);
  });

  it('renders the fourth "Publiceer" step', async () => {
    getLang.mockResolvedValue('nl');
    render(await Landing());
    expect(screen.getByRole('heading', { name: 'Publiceer' })).toBeInTheDocument();
    expect(screen.getByText('Kies een sjabloon, download of embed — bron en datum reizen mee.')).toBeInTheDocument();
  });
});

describe('Landing — en', () => {
  it('renders the English chrome via getLang() -> "en"', async () => {
    getLang.mockResolvedValue('en');
    render(await Landing());
    expect(screen.getByRole('heading', { name: 'Ask a question. Share the chart.', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start asking' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See the gallery' })).toBeInTheDocument();
    expect(screen.getByText('No guesswork, just computation')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a free account' })).toBeInTheDocument();
  });

  it('shows the real hero chart on the English page too', async () => {
    getLang.mockResolvedValue('en');
    render(await Landing());
    expect(screen.getByTestId('hero-story')).toBeInTheDocument();
    expect(screen.getByText('A real answer, live from our database')).toBeInTheDocument();
  });

  // WP-B (journey programme phase 3 R5.4): the fourth "Publish" step joins
  // the original three how-it-works steps.
  it('renders the fourth "Publish" step alongside the original three', async () => {
    getLang.mockResolvedValue('en');
    render(await Landing());
    expect(screen.getByRole('heading', { name: 'Publish' })).toBeInTheDocument();
    expect(screen.getByText('Pick a template, download or embed — source and date travel with it.')).toBeInTheDocument();
  });

});

describe('Landing — coverage disclosure (WP-E, R4)', () => {
  it('renders the "Dit weten we nu" section with the example as plain text (no composer to fill)', async () => {
    getLang.mockResolvedValue('nl');
    render(
      await Landing({
        coverage: {
          tables: [
            {
              id: '86141NED',
              title: 'Consumentenprijzen; prijsindex 2015=100',
              sourceDisplayName: 'CBS',
              syncedOn: '2026-07-03',
              concepts: ['inflatie (CPI)'],
              example: 'Wat was de inflatie in 2025?',
            },
          ],
        },
      }),
    );
    expect(screen.getByRole('heading', { name: 'Dit weten we nu' })).toBeInTheDocument();
    expect(screen.getByText('Welke bronnen zijn ingebouwd?')).toBeInTheDocument();
    expect(screen.getByText('bijvoorbeeld: Wat was de inflatie in 2025?')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /inflatie/ })).toBeNull();
  });

  it('renders no coverage section when coverage is null', async () => {
    getLang.mockResolvedValue('nl');
    render(await Landing());
    expect(screen.queryByText('Welke bronnen zijn ingebouwd?')).toBeNull();
  });
});

