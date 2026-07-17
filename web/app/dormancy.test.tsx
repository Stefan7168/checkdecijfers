// WP135 (ADR 033 D7/⟨A5⟩): the WORKSPACE_ENABLED flag gates EVERY WP135 surface.
// Flag OFF → `/` renders today's <Dashboard> (never <Workspace>), and neither
// `/credits` nor `/login` renders the site header, and `/geschiedenis` redirects
// to `/` (the route ships dark). Flag ON → the workspace + the header. The shell
// components are stubbed to markers so these pins are about WHICH surface
// renders, not its internals.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  // Real redirect throws to abort rendering; mirror that so a redirect is
  // observable and the function body does not run on past it.
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

const { currentUserId } = vi.hoisted(() => ({ currentUserId: vi.fn() }));
vi.mock('../lib/current-user.ts', () => ({ currentUserId }));
vi.mock('../lib/db.ts', () => ({ getDb: vi.fn(() => ({})) }));

vi.mock('../backend/billing/index.ts', () => ({
  getBalance: vi.fn().mockResolvedValue(100),
  getActionClassPrice: vi.fn().mockResolvedValue(20),
  getSignupGrantCredits: vi.fn().mockResolvedValue(100),
  getQuestionHistory: vi.fn().mockResolvedValue([]),
  getActivePacks: vi.fn().mockResolvedValue([]),
}));

// page.tsx's workspace branch reads the thread list server-side.
vi.mock('../backend/threads/index.ts', () => ({ listThreads: vi.fn().mockResolvedValue([]) }));

// Marker stubs — the tests assert which surface renders, not its content.
vi.mock('../components/dashboard.tsx', () => ({ Dashboard: () => <div data-testid="dashboard" /> }));
vi.mock('../components/workspace.tsx', () => ({ Workspace: () => <div data-testid="workspace" /> }));
vi.mock('../components/question-history.tsx', () => ({ QuestionHistory: () => <div data-testid="history" /> }));
vi.mock('../components/site-header.tsx', () => ({ SiteHeader: () => <div data-testid="site-header" /> }));
vi.mock('../components/landing.tsx', () => ({ Landing: () => <div data-testid="landing" /> }));
vi.mock('./login/login-form.tsx', () => ({ LoginForm: () => <div data-testid="login-form" /> }));

import { redirect } from 'next/navigation';
import Home from './page.tsx';
import CreditsPage from './credits/page.tsx';
import LoginPage from './login/page.tsx';
import GeschiedenisPage from './geschiedenis/page.tsx';

beforeEach(() => {
  currentUserId.mockResolvedValue('user-1');
  vi.stubEnv('WEBSEARCH_ENABLED', '0');
  vi.stubEnv('ONBOARDING_ENABLED', '0');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const emptySearch = Promise.resolve({});

describe('WP135 dormancy — flag OFF renders today, byte-identical (⟨A5⟩)', () => {
  beforeEach(() => vi.stubEnv('WORKSPACE_ENABLED', '0'));

  it('/ renders the Dashboard, never the Workspace', async () => {
    render(await Home({ searchParams: emptySearch }));
    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace')).toBeNull();
  });

  it('/credits renders NO site header', async () => {
    render(await CreditsPage({ searchParams: emptySearch }));
    expect(screen.queryByTestId('site-header')).toBeNull();
    expect(screen.getByText(/Credits — Check de Cijfers/)).toBeInTheDocument();
  });

  it('/login renders NO site header', () => {
    render(LoginPage());
    expect(screen.queryByTestId('site-header')).toBeNull();
    expect(screen.getByText(/Inloggen — Check de Cijfers/)).toBeInTheDocument();
  });

  it('/geschiedenis redirects to /', async () => {
    await expect(GeschiedenisPage()).rejects.toThrow('REDIRECT:/');
    expect(redirect).toHaveBeenCalledWith('/');
  });
});

describe('public landing (session 51/52 — #98 resolved + ADR 035)', () => {
  it('/ renders the Landing for a logged-out visitor, flag-independent, no dashboard reads', async () => {
    currentUserId.mockResolvedValue(null);
    for (const flag of ['0', '1']) {
      vi.stubEnv('WORKSPACE_ENABLED', flag);
      render(await Home({ searchParams: emptySearch }));
      expect(screen.getByTestId('landing')).toBeInTheDocument();
      expect(screen.queryByTestId('dashboard')).toBeNull();
      expect(screen.queryByTestId('workspace')).toBeNull();
      cleanup();
    }
  });
});

describe('WP135 dormancy — flag ON renders the workspace + shell', () => {
  beforeEach(() => vi.stubEnv('WORKSPACE_ENABLED', '1'));

  it('/ renders the Workspace, never the Dashboard', async () => {
    render(await Home({ searchParams: emptySearch }));
    expect(screen.getByTestId('workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard')).toBeNull();
  });

  it('/credits renders the site header', async () => {
    render(await CreditsPage({ searchParams: emptySearch }));
    expect(screen.getByTestId('site-header')).toBeInTheDocument();
  });

  it('/login renders the (stripped) site header', () => {
    render(LoginPage());
    expect(screen.getByTestId('site-header')).toBeInTheDocument();
  });

  it('/geschiedenis renders (no redirect) with the header and history', async () => {
    render(await GeschiedenisPage());
    expect(redirect).not.toHaveBeenCalledWith('/');
    expect(screen.getByTestId('site-header')).toBeInTheDocument();
    expect(screen.getByTestId('history')).toBeInTheDocument();
  });
});
