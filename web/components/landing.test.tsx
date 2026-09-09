// WP218 phase 4 (#219), Task 3: Landing is now an async Server Component
// (await getLang()). Rendered via `await Landing()` (the trial.test.tsx /
// ontdek.test.tsx precedent), never `<Landing/>` directly — jsdom's client
// renderer cannot invoke an async function component itself.
//
// ontdek.tsx and trial.tsx are mocked out: both mount their OWN async
// Server Component behind a Suspense boundary (OntdekCharts / TrialGate),
// which is exactly the "render the pure part" carve-out the brief allows —
// their own suites already cover that subtree in isolation.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./ontdek.tsx', () => ({ OntdekSectie: () => null }));
vi.mock('./trial.tsx', () => ({ TrialSectie: () => null }));

const { getLang } = vi.hoisted(() => ({ getLang: vi.fn() }));
vi.mock('../lib/i18n/server.ts', () => ({ getLang }));

import { Landing } from './landing.tsx';

afterEach(() => {
  cleanup();
  getLang.mockReset();
});

describe('Landing — nl (default)', () => {
  it('keeps the owner-pinned Dutch headline verbatim', async () => {
    getLang.mockResolvedValue('nl');
    render(await Landing());
    expect(
      screen.getByRole('heading', { name: 'Chat met de officiële cijfers van Nederland', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Begin met vragen' })).toBeInTheDocument();
  });

  it('renders the frozen example answer in Dutch (mirrors the Dutch-only answer pipeline)', async () => {
    getLang.mockResolvedValue('nl');
    render(await Landing());
    expect(screen.getByText(/Het consumentenvertrouwen in Nederland was in juni 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Bron: CBS StatLine, tabel 83693NED/)).toBeInTheDocument();
  });
});

describe('Landing — en', () => {
  it('renders the English chrome via getLang() -> "en"', async () => {
    getLang.mockResolvedValue('en');
    render(await Landing());
    expect(
      screen.getByRole('heading', { name: "Chat with the Netherlands' official statistics", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start asking' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'How it works' })).toBeInTheDocument();
    expect(screen.getByText('No guesswork, just computation')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a free account' })).toBeInTheDocument();
  });

  // The demo answer block deliberately stays Dutch on the English page too
  // (see landing.tsx's file-header note) — a leftover worth pinning so it
  // never gets "helpfully" translated by a later session.
  it('still renders the frozen example answer in Dutch on the English page', async () => {
    getLang.mockResolvedValue('en');
    render(await Landing());
    expect(screen.getByText(/Het consumentenvertrouwen in Nederland was in juni 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/Consumer confidence/)).toBeNull();
  });
});
