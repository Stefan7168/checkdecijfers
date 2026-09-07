// WP135 (ADR 033 D6): the site shell (flag on). Pins the footer's EXACT
// byte-pinned attribution string, the header presence rules (stripped vs full),
// the account menu holding "Log uit" (signOut) + the relocated delete-history
// control, and that the workspace fetches its thread list on mount.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedThread } from '../app/actions.ts';

// loadMyThread is typed explicitly against the real LoadedThread union
// (the chat.test.tsx precedent, same reason: an untyped vi.fn()'s
// mockResolvedValue argument is never checked against the real return type,
// so a stale shape — e.g. the pre-ADR-037 `{ threadId, messages, context }`
// — would pass typecheck AND this suite forever, even after LoadedThread
// became a discriminated union with `kind`).
const actions = vi.hoisted(() => ({
  askQuestion: vi.fn(),
  replyToClarification: vi.fn(),
  submitAnswerFeedback: vi.fn(),
  listMyThreads: vi.fn(),
  loadMyThread: vi.fn<() => Promise<LoadedThread>>(),
  signOut: vi.fn(),
  deleteMyQuestionHistory: vi.fn(),
}));
vi.mock('../app/actions.ts', () => actions);

// ADR 037 D10: DatasetChat (mounted for a dataset-kind Handoff) imports its
// own Server Action module — mocked here too so a mixed CBS/dataset thread
// list can be exercised through Workspace without ever really calling out.
const datasetActions = vi.hoisted(() => ({ askDataset: vi.fn(), decideDatasetFormat: vi.fn(), ingestFile: vi.fn() }));
vi.mock('../app/dataset-actions.ts', () => datasetActions);

import type { ThreadSummary } from '../backend/threads/index.ts';
import { Workspace } from './workspace.tsx';
import { SiteHeader } from './site-header.tsx';
import { FOOTER_ABOUT_LABEL, FOOTER_ATTRIBUTION, FOOTER_PREFIX, SiteFooter } from './site-footer.tsx';
import { Landing } from './landing.tsx';

// The site footer reads the pathname to decide whether the "Over dit project"
// anchor (a section that only exists on the home page) is rendered.
const pathname = vi.hoisted(() => ({ current: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

Element.prototype.scrollIntoView = vi.fn();

const FOOTER_EXACT =
  'Cijfers: CBS StatLine (CC BY 4.0) · Elk getal herleidbaar tot een officiële CBS-tabel · Over dit project';

beforeEach(() => {
  actions.listMyThreads.mockResolvedValue([]);
  actions.loadMyThread.mockResolvedValue({ kind: 'empty' });
  // jsdom has no matchMedia — the dock's media query needs it (default: not wide).
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWorkspace(initialThreads: ThreadSummary[] = [], opts: { attachments?: { enabled: true } } = {}) {
  return render(
    <Workspace
      initialBalance={100}
      simplePrice={20}
      clarificationPrice={10}
      initialThreads={initialThreads}
      {...opts}
    />,
  );
}

describe('Workspace — WP135 shell (flag on)', () => {
  it('renders NO footer of its own — the site footer is the only one (owner report 2026-09-03)', () => {
    renderWorkspace();
    expect(document.querySelector('footer')).toBeNull();
    // The anchor target the site footer links to still exists on this page.
    expect(document.getElementById('over-dit-project')).not.toBeNull();
  });

  it('site footer on the home page: the EXACT byte-pinned attribution string + the gear link', () => {
    pathname.current = '/';
    render(<SiteFooter />);
    const footers = document.querySelectorAll('footer');
    expect(footers).toHaveLength(1);
    const footer = footers[0]!;
    // textContent ignores the icon (an aria-hidden svg without text), so the
    // owner's sentence is pinned byte-for-byte.
    expect(footer.textContent).toBe(FOOTER_EXACT);
    expect(FOOTER_PREFIX + FOOTER_ABOUT_LABEL).toBe(FOOTER_EXACT);
    expect(footer.querySelector('a[href="#over-dit-project"]')?.textContent).toBe(FOOTER_ABOUT_LABEL);
    const gear = footer.querySelector('a[href="/systeemoverzicht"]');
    expect(gear).not.toBeNull();
    expect(gear!.getAttribute('aria-label')).toBe('Systeemoverzicht');
    expect(footer.textContent).not.toMatch(/privacy/i);
  });

  it('the home-page anchor target exists on the logged-OUT home too (Landing) — no dead link for visitors', () => {
    render(<Landing />);
    expect(document.getElementById('over-dit-project')).not.toBeNull();
  });

  it('site footer elsewhere: attribution + gear, but NO "Over dit project" (the section is not there — no dead links)', () => {
    pathname.current = '/credits';
    render(<SiteFooter />);
    const footer = document.querySelector('footer')!;
    expect(footer.textContent).toBe(FOOTER_ATTRIBUTION);
    expect(footer.querySelector('a[href="#over-dit-project"]')).toBeNull();
    expect(footer.querySelector('a[href="/systeemoverzicht"]')).not.toBeNull();
    pathname.current = '/';
  });

  it('renders the header: wordmark, live balance chip, Credits kopen, Geschiedenis', () => {
    renderWorkspace();
    expect(screen.getAllByRole('link', { name: 'Check de Cijfers' }).length).toBeGreaterThan(0);
    expect(screen.getByText('100 credits')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Credits kopen' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Geschiedenis' })).toBeInTheDocument();
  });

  it('the account menu holds Log uit (signOut) and the delete-history control', () => {
    renderWorkspace();
    expect(screen.queryByRole('button', { name: 'Log uit' })).toBeNull(); // collapsed
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    expect(screen.getByRole('button', { name: 'Log uit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verwijder mijn vraaggeschiedenis' })).toBeInTheDocument();
  });

  it('renders the server-provided threads and the Nieuwe chat button', () => {
    renderWorkspace([{ id: 1, title: 'Inflatie 2024', lastActivityAt: new Date().toISOString(), kind: 'cbs' }]);
    expect(screen.getByRole('button', { name: 'Nieuwe chat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inflatie 2024' })).toBeInTheDocument();
  });
});

describe('Workspace — mixed CBS + dataset thread list (ADR 037 D10 invariant)', () => {
  const MIXED_THREADS: ThreadSummary[] = [
    { id: 1, title: 'Inflatie 2024', lastActivityAt: new Date().toISOString(), kind: 'cbs' },
    { id: 2, title: 'verkoop.csv', lastActivityAt: new Date().toISOString(), kind: 'dataset' },
  ];

  it('renders both kinds side by side, the dataset one prefixed', () => {
    renderWorkspace(MIXED_THREADS);
    expect(screen.getByRole('button', { name: 'Inflatie 2024' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /verkoop\.csv/ }).textContent).toBe('📎verkoop.csv');
  });

  // The explicit invariant D10 calls for: selecting a CBS thread through
  // Workspace behaves IDENTICALLY whether or not dataset threads also exist
  // in the same sidebar — real shared-code surgery (the Handoff union, the
  // render branch), not a bypass that only happens to work when no dataset
  // thread is around.
  it('selecting a CBS thread mounts Chat, unaffected by dataset threads sharing the sidebar', async () => {
    actions.loadMyThread.mockResolvedValue({ kind: 'cbs', threadId: 1, messages: [], context: null });
    renderWorkspace(MIXED_THREADS);
    fireEvent.click(screen.getByRole('button', { name: 'Inflatie 2024' }));
    expect(await screen.findByPlaceholderText('Stel een vraag…')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Ask about your data…')).not.toBeInTheDocument();
  });

  it('switching between two dataset threads resets DatasetChat to the NEW thread\'s messages (the key={threadId} remount)', async () => {
    const DATASETS: ThreadSummary[] = [
      { id: 2, title: 'verkoop.csv', lastActivityAt: new Date().toISOString(), kind: 'dataset' },
      { id: 3, title: 'inkoop.csv', lastActivityAt: new Date().toISOString(), kind: 'dataset' },
    ];
    actions.loadMyThread
      .mockResolvedValueOnce({
        kind: 'dataset',
        threadId: 2,
        datasetId: 5,
        displayName: 'verkoop.csv',
        status: 'ready',
        profile: { columns: [], rowCount: 0 },
        messages: [{ role: 'user', text: 'omzet vorig jaar' }],
        rawState: null,
      })
      .mockResolvedValueOnce({
        kind: 'dataset',
        threadId: 3,
        datasetId: 6,
        displayName: 'inkoop.csv',
        status: 'ready',
        profile: { columns: [], rowCount: 0 },
        messages: [{ role: 'user', text: 'kosten vorig jaar' }],
        rawState: null,
      });
    renderWorkspace(DATASETS);
    fireEvent.click(screen.getByRole('button', { name: /verkoop\.csv/ }));
    expect(await screen.findByText('omzet vorig jaar')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /inkoop\.csv/ }));
    expect(await screen.findByText('kosten vorig jaar')).toBeInTheDocument();
    expect(screen.queryByText('omzet vorig jaar')).not.toBeInTheDocument();
  });

  it('selecting a dataset thread mounts DatasetChat instead of Chat', async () => {
    actions.loadMyThread.mockResolvedValue({
      kind: 'dataset',
      threadId: 2,
      datasetId: 5,
      displayName: 'verkoop.csv',
      status: 'ready',
      profile: { columns: [], rowCount: 0 },
      messages: [],
      rawState: null,
    });
    renderWorkspace(MIXED_THREADS);
    fireEvent.click(screen.getByRole('button', { name: /verkoop\.csv/ }));
    expect(await screen.findByPlaceholderText('Ask about your data…')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Stel een vraag…')).not.toBeInTheDocument();
  });
});

describe('Workspace — handleUploadFile (ADR 037 D10/D14, attachments prop)', () => {
  it('without the attachments prop, "Bestand uploaden" stays disabled and ingestFile is never wired', () => {
    renderWorkspace();
    expect(screen.getByRole('button', { name: 'Bestand uploaden' })).toBeDisabled();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('a successful upload switches straight to the new dataset thread, no loadMyThread round trip', async () => {
    // The mocked displayName deliberately differs from the raw File.name
    // below — proves the handoff uses the SERVER's stored name (code-review
    // finding: the client's raw File.name can differ from what ingestFile
    // actually persisted, e.g. after its trim/cap), never the client's own.
    datasetActions.ingestFile.mockResolvedValue({
      kind: 'ok',
      datasetId: 9,
      threadId: 11,
      displayName: 'verkoop (2).csv',
      status: 'ready',
      profile: { columns: [], rowCount: 0 },
      ambiguousColumnIds: [],
    });
    renderWorkspace([], { attachments: { enabled: true } });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['Year\n2020\n'], 'verkoop.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByRole('heading', { name: 'verkoop (2).csv' })).toBeInTheDocument();
    expect(actions.loadMyThread).not.toHaveBeenCalled();
    expect(datasetActions.ingestFile).toHaveBeenCalledTimes(1);
    const formData = datasetActions.ingestFile.mock.calls[0]![0] as FormData;
    expect(formData.get('file')).toBe(file);
  });

  it('a refused upload shows the message inline and stays on Chat', async () => {
    datasetActions.ingestFile.mockResolvedValue({ kind: 'refused', message: 'This file is too large.' });
    renderWorkspace([], { attachments: { enabled: true } });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'x.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText('This file is too large.')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Ask about your data…')).not.toBeInTheDocument();
  });
});

describe('SiteHeader — WP135 presence rules', () => {
  it('full variant shows the nav; stripped variant is wordmark-only', () => {
    const { rerender } = render(<SiteHeader balance={50} />);
    expect(screen.getByText('50 credits')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Geschiedenis' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();

    rerender(<SiteHeader stripped />);
    expect(screen.getByRole('link', { name: 'Check de Cijfers' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Geschiedenis' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Account' })).toBeNull();
    expect(screen.queryByText(/credits/)).toBeNull();
  });
});
