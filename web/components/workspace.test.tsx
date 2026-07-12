// WP135 (ADR 033 D6): the site shell (flag on). Pins the footer's EXACT
// byte-pinned attribution string, the header presence rules (stripped vs full),
// the account menu holding "Log uit" (signOut) + the relocated delete-history
// control, and that the workspace fetches its thread list on mount.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  askQuestion: vi.fn(),
  replyToClarification: vi.fn(),
  submitAnswerFeedback: vi.fn(),
  listMyThreads: vi.fn(),
  loadMyThread: vi.fn(),
  signOut: vi.fn(),
  deleteMyQuestionHistory: vi.fn(),
}));
vi.mock('../app/actions.ts', () => actions);

import type { ThreadSummary } from '../backend/threads/index.ts';
import { FOOTER_ABOUT_LABEL, FOOTER_PREFIX, Workspace } from './workspace.tsx';
import { SiteHeader } from './site-header.tsx';

Element.prototype.scrollIntoView = vi.fn();

const FOOTER_EXACT =
  'Cijfers: CBS StatLine (CC BY 4.0) · Elk getal herleidbaar tot een officiële CBS-tabel · Over dit project';

beforeEach(() => {
  actions.listMyThreads.mockResolvedValue([]);
  actions.loadMyThread.mockResolvedValue({ threadId: null, messages: [], context: null });
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

function renderWorkspace(initialThreads: ThreadSummary[] = []) {
  return render(
    <Workspace initialBalance={100} simplePrice={20} clarificationPrice={10} initialThreads={initialThreads} />,
  );
}

describe('Workspace — WP135 shell (flag on)', () => {
  it('renders the footer with the EXACT byte-pinned attribution string', () => {
    renderWorkspace();
    const footer = document.querySelector('footer');
    expect(footer).not.toBeNull();
    expect(footer!.textContent).toBe(FOOTER_EXACT);
    // The exported constants must not drift from the pinned string.
    expect(FOOTER_PREFIX + FOOTER_ABOUT_LABEL).toBe(FOOTER_EXACT);
  });

  it('has NO privacy link in the footer (until #14(d) exists — no dead links)', () => {
    renderWorkspace();
    const footer = document.querySelector('footer')!;
    expect(footer.textContent).not.toMatch(/privacy/i);
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
    renderWorkspace([{ id: 1, title: 'Inflatie 2024', lastActivityAt: new Date().toISOString() }]);
    expect(screen.getByRole('button', { name: 'Nieuwe chat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inflatie 2024' })).toBeInTheDocument();
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
