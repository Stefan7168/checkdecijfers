// WP135 (ADR 033 D6): the site shell (flag on). Pins the footer's EXACT
// byte-pinned attribution string, the header presence rules (stripped vs full),
// the account menu holding "Log uit" (signOut) + the relocated delete-history
// control, and that the workspace fetches its thread list on mount.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  deleteMyThread: vi.fn(),
}));
vi.mock('../app/actions.ts', () => actions);

// ADR 037 D10: DatasetChat (mounted for a dataset-kind Handoff) imports its
// own Server Action module — mocked here too so a mixed CBS/dataset thread
// list can be exercised through Workspace without ever really calling out.
const datasetActions = vi.hoisted(() => ({ askDataset: vi.fn(), decideDatasetFormat: vi.fn(), ingestFile: vi.fn() }));
vi.mock('../app/dataset-actions.ts', () => datasetActions);

import type { ThreadSummary } from '../backend/threads/index.ts';
import { Workspace } from './workspace.tsx';
import { LangProvider } from '../lib/i18n/lang-provider.tsx';
import { SiteHeader } from './site-header.tsx';
import { FOOTER_ABOUT_LABEL, FOOTER_ATTRIBUTION, FOOTER_PREFIX, SiteFooter } from './site-footer.tsx';
import { Landing } from './landing.tsx';

// The site footer reads the pathname AND checks that the "Over dit project"
// anchor target actually exists in the document before rendering the link
// (session 87: the logged-in chat screen dropped the section; the logged-out
// Landing still has it — same '/' pathname, so the pathname alone can't tell).
const pathname = vi.hoisted(() => ({ current: '/' }));
// WP218 phase 4 (#219): SiteHeader now renders <LanguageSwitch/>, which calls
// useRouter() (router.refresh() after the language cookie is set) — added
// here alongside the pre-existing usePathname mock the site footer needs.
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current, useRouter: () => ({ refresh: vi.fn() }) }));
// Landing embeds OntdekCharts, an ASYNC Server Component inside a Suspense
// boundary. jsdom renders client-side, where React cannot resolve an async
// component — the boundary never settles and the root's passive effects
// (incl. the footer's anchor-target probe) never run. In production Landing
// is server-rendered HTML, so the probe simply finds the section. Stub the
// section here; the Landing assertions that matter (the anchor target, the
// copy) live outside it.
vi.mock('./ontdek.tsx', () => ({ OntdekSectie: () => null }));
// WP218 phase 4 (#219): Landing is now an async Server Component (await
// getLang()) — jsdom has no Next.js request context for the real
// cookies()/headers() reads, so it's mocked here the way every other
// server-action test in this repo mocks its next/headers-touching seam.
vi.mock('../lib/i18n/server.ts', () => ({ getLang: vi.fn().mockResolvedValue('nl') }));

Element.prototype.scrollIntoView = vi.fn();

// #211 (chat interaction polish, session 88) code-review fix: the resizable
// panel group is now ALWAYS mounted (see workspace.tsx), so every test in
// this file needs ResizeObserver -- jsdom doesn't implement it, and
// react-resizable-panels' Group uses it internally. Same stub shape/scoping
// choice chart.test.tsx already makes for the same reason, just global here
// since it's now unconditional rather than isolated to a few tests.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

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

function renderWorkspace(
  initialThreads: ThreadSummary[] = [],
  opts: { attachments?: { enabled: true }; chartStyle?: unknown } = {},
) {
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
  it('renders English under the language provider (WP218 phase 4): the purchase banner dismiss reads Close', () => {
    render(
      <LangProvider lang="en">
        <Workspace initialBalance={100} simplePrice={20} clarificationPrice={10} initialThreads={[]} purchaseSuccess />
      </LangProvider>,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.queryByText('Sluiten')).toBeNull();
  });

  it('renders NO footer of its own — the site footer is the only one (owner report 2026-09-03)', () => {
    renderWorkspace();
    expect(document.querySelector('footer')).toBeNull();
    // Session 87 visual redesign (owner decision): the "Over dit project"
    // explainer is gone from the logged-in chat screen — a bare LLM chat.
    expect(document.getElementById('over-dit-project')).toBeNull();
    expect(screen.queryByText('Over dit project')).toBeNull();
  });

  it('site footer on the logged-in home (no anchor target): attribution only, NO dead "Over dit project" link', () => {
    pathname.current = '/';
    render(
      <>
        <Workspace initialBalance={100} simplePrice={20} clarificationPrice={10} initialThreads={[]} />
        <SiteFooter />
      </>,
    );
    const footer = document.querySelector('footer')!;
    expect(footer.textContent).toBe(FOOTER_ATTRIBUTION);
    expect(footer.querySelector('a[href="#over-dit-project"]')).toBeNull();
  });

  it('site footer on the home page WITH the section (Landing): the EXACT byte-pinned attribution string + the gear link', async () => {
    pathname.current = '/';
    render(
      <>
        {await Landing()}
        <SiteFooter />
      </>,
    );
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

  it('the home-page anchor target exists on the logged-OUT home too (Landing) — no dead link for visitors', async () => {
    render(await Landing());
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

// WP218 phase 2 (owner C): Workspace ALWAYS wraps its tree in
// ChartStyleProvider (chart-style-context.tsx) — the provider's own
// presence is what "signed in" means to every ChartView underneath, not the
// `chartStyle` value it was mounted with. These tests are the workspace-level
// smoke check that the prop's absence/null/valid/garbage shapes all render
// without incident; ChartStyleProvider's own sanitising and ChartView's
// actual use of the account default as `resolvePresentation`'s base are
// covered directly in chart-style-context.test.tsx and chart.test.tsx.
describe('Workspace — WP218 phase 2: chartStyle prop (account default provider)', () => {
  it('renders normally when chartStyle is absent (no prop passed)', () => {
    renderWorkspace();
    expect(screen.getByRole('button', { name: 'Nieuwe chat' })).toBeInTheDocument();
  });

  it('renders normally when chartStyle is null (no saved default)', () => {
    renderWorkspace([], { chartStyle: null });
    expect(screen.getByRole('button', { name: 'Nieuwe chat' })).toBeInTheDocument();
  });

  it('renders normally when chartStyle is a valid saved default', () => {
    renderWorkspace([], { chartStyle: { lineWidth: 'thick' } });
    expect(screen.getByRole('button', { name: 'Nieuwe chat' })).toBeInTheDocument();
  });

  it('renders normally when chartStyle is garbage (sanitised away, never throws)', () => {
    renderWorkspace([], { chartStyle: { bogus: 1, lineWidth: 'huge' } });
    expect(screen.getByRole('button', { name: 'Nieuwe chat' })).toBeInTheDocument();
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
    expect(screen.queryByPlaceholderText('Stel een vraag over je data…')).not.toBeInTheDocument();
  });

  it('shows a skeleton message list while a clicked thread is loading, then the real messages', async () => {
    let resolveLoad!: (value: LoadedThread) => void;
    actions.loadMyThread.mockImplementation(
      () => new Promise<LoadedThread>((resolve) => { resolveLoad = resolve; }),
    );
    renderWorkspace(MIXED_THREADS);
    fireEvent.click(screen.getByRole('button', { name: 'Inflatie 2024' }));
    await waitFor(() => {
      expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    });
    resolveLoad({ kind: 'cbs', threadId: 1, messages: [], context: null });
    await screen.findByPlaceholderText('Stel een vraag…');
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBe(0);
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
    expect(await screen.findByPlaceholderText('Stel een vraag over je data…')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Stel een vraag…')).not.toBeInTheDocument();
  });
});

describe('Workspace — handleUploadFile (ADR 037 D10/D14, attachments prop)', () => {
  it('without the attachments prop, upload stays collapsed into the disabled "Eigen data" chip and ingestFile is never wired', () => {
    renderWorkspace();
    expect(screen.getByRole('button', { name: 'Eigen data (binnenkort)' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Bestand uploaden' })).not.toBeInTheDocument();
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
    expect(screen.queryByPlaceholderText('Stel een vraag over je data…')).not.toBeInTheDocument();
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

describe('Workspace — resizable chart panel (session 88)', () => {
  // Code-review finding (session 88): the panel group is ALWAYS mounted now
  // (not swapped for a plain <div> based on showDock) specifically so the
  // chat panel's identity/position never changes -- Chat/DatasetChat must
  // not remount just because a chart appears or the dock panel toggles.
  it('always mounts the resizable panel group, but only mounts the dock panel once a visual exists', () => {
    renderWorkspace();
    expect(document.querySelector('[data-slot="resizable-panel-group"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-slot="resizable-panel"]').length).toBe(1);
    expect(document.querySelector('[data-slot="resizable-handle"]')).toBeNull();
  });
});

describe('Workspace — session 90: deleting a chat from the sidebar', () => {
  it('confirmed delete calls deleteMyThread(id), re-lists the threads, and the row is gone', async () => {
    actions.deleteMyThread.mockResolvedValue({ ok: true });
    actions.listMyThreads.mockResolvedValue([]);
    renderWorkspace([{ id: 11, title: 'Inflatie 2024', lastActivityAt: new Date().toISOString(), kind: 'cbs' }]);
    expect(screen.getByRole('button', { name: 'Inflatie 2024' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Chatopties' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Chat verwijderen' }));
    const confirm = await screen.findByRole('group', { name: 'Chat verwijderen?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Verwijder' }));
    await waitFor(() => expect(actions.deleteMyThread).toHaveBeenCalledWith(11));
    await waitFor(() => expect(actions.listMyThreads).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Inflatie 2024' })).toBeNull());
  });

  it('a failed delete keeps the row and shows the error line — nothing is re-listed', async () => {
    actions.deleteMyThread.mockResolvedValue({ ok: false });
    renderWorkspace([{ id: 12, title: 'Werkloosheid', lastActivityAt: new Date().toISOString(), kind: 'cbs' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Chatopties' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Chat verwijderen' }));
    const confirm = await screen.findByRole('group', { name: 'Chat verwijderen?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Verwijder' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Kon deze chat niet verwijderen');
    expect(screen.getByRole('button', { name: 'Werkloosheid' })).toBeInTheDocument();
    expect(actions.listMyThreads).not.toHaveBeenCalled();
  });
});
