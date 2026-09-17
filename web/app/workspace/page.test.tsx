// Session 110 route split (ADR 033 D8): `/` serves the public landing to
// everyone, and web/proxy.ts rewrites it to THIS route segment for a request
// with a valid session — the URL never changes. Two things need pinning, and
// neither is visible to the proxy's own tests:
//
//  1. The perf guarantee the split exists for: `app/page.tsx` must not import
//     the signed-in tree again. Next builds a route's client bundle from its
//     static import graph, not from which runtime branch renders, so a single
//     re-added import silently puts the whole chat workspace back into every
//     anonymous visitor's first load (measured before the split: the anonymous
//     and the signed-in response shipped the exact same 15 script tags /
//     1,503,395 bytes — docs/session-briefs/2026-09-13-build-performance-
//     diagnosis.md). A source-text pin is the honest cheap layer here, the same
//     judgment app/bevolking-3d-demo/isolation.test.ts already made for the
//     three.js route: vitest loads both files as plain modules, so the bundling
//     boundary that actually breaks does not exist in jsdom at all.
//  2. That the move was faithful: the props this route hands Workspace/Dashboard
//     are the ones the pre-split page handed them, including the ones a
//     mechanical copy is most likely to drop (the purchase flag off
//     `searchParams`, the render-time Brandfetch availability check).
//
// The flag-gated "which surface renders" pins live in app/dormancy.test.tsx
// (they moved with the branches); the redirect-when-signed-out pin lives there
// too, next to the landing assertions it is the mirror of.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

const { currentUserId } = vi.hoisted(() => ({ currentUserId: vi.fn() }));
vi.mock('../../lib/current-user.ts', () => ({ currentUserId }));
vi.mock('../../lib/db.ts', () => ({ getDb: vi.fn(() => ({})) }));
vi.mock('../../backend/billing/index.ts', () => ({
  getBalance: vi.fn().mockResolvedValue(100),
  getActionClassPrice: vi.fn().mockResolvedValue(20),
  getSignupGrantCredits: vi.fn().mockResolvedValue(100),
  getQuestionHistory: vi.fn().mockResolvedValue([]),
  getActivePacks: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../backend/threads/index.ts', () => ({ listThreads: vi.fn().mockResolvedValue([]) }));
vi.mock('../../backend/chart/user-styles.ts', () => ({ getUserChartStyle: vi.fn().mockResolvedValue(null) }));
vi.mock('../../lib/coverage-disclosure.ts', () => ({ loadCoverageDisclosure: vi.fn().mockResolvedValue(null) }));

// Marker stubs that echo the props under test — these assertions are about what
// this route PASSES, not about how Workspace/Dashboard render it.
vi.mock('../../components/workspace.tsx', () => ({
  Workspace: (props: { purchaseSuccess: boolean; brandLookupAvailable: boolean }) => (
    <div
      data-testid="workspace"
      data-purchase={String(props.purchaseSuccess)}
      data-brand={String(props.brandLookupAvailable)}
    />
  ),
}));
vi.mock('../../components/dashboard.tsx', () => ({
  Dashboard: (props: { purchaseSuccess: boolean }) => (
    <div data-testid="dashboard" data-purchase={String(props.purchaseSuccess)} />
  ),
}));
vi.mock('../../components/question-history.tsx', () => ({ QuestionHistory: () => <div data-testid="history" /> }));

import WorkspaceRoute from './page.tsx';

beforeEach(() => {
  currentUserId.mockResolvedValue('user-1');
  vi.stubEnv('WORKSPACE_ENABLED', '1');
  vi.stubEnv('WEBSEARCH_ENABLED', '0');
  vi.stubEnv('ONBOARDING_ENABLED', '0');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const read = (rel: string): string => readFileSync(join(__dirname, '..', rel), 'utf-8');

describe('the anonymous landing never imports the signed-in tree (the split IS the fix)', () => {
  const page = read('page.tsx');

  it('app/page.tsx imports neither Workspace nor Dashboard', () => {
    // Any static import — named, default or type-only — pulls the whole module
    // graph into `/`'s client bundle, which is exactly the leak the split
    // closed. Matching on the module specifier catches every import form.
    expect(page).not.toContain('components/workspace.tsx');
    expect(page).not.toContain('components/dashboard.tsx');
    expect(page).not.toContain('components/question-history.tsx');
    // The signed-in data reads went with them.
    expect(page).not.toContain('backend/threads/index.ts');
    expect(page).not.toContain('backend/billing/index.ts');
  });

  it('app/page.tsx still renders the Landing and stays dynamic', () => {
    expect(page).toContain('components/landing.tsx');
    // Without the session read that used to force it, only this export keeps
    // the landing's cached-but-request-time reads (ADR 035/046) out of the
    // build output.
    expect(page).toContain("export const dynamic = 'force-dynamic';");
  });

  it('this route is the one that reads the session and the signed-in data', () => {
    const workspace = read('workspace/page.tsx');
    expect(workspace).toContain('currentUserId');
    expect(workspace).toContain('components/workspace.tsx');
    expect(workspace).toContain('components/dashboard.tsx');
  });
});

describe('the props survived the move intact', () => {
  it('threads the Stripe purchase flag off searchParams into the Workspace', async () => {
    render(await WorkspaceRoute({ searchParams: Promise.resolve({ purchase: 'success' }) }));
    expect(screen.getByTestId('workspace')).toHaveAttribute('data-purchase', 'true');
  });

  it('threads it into the Dashboard too (WORKSPACE_ENABLED off)', async () => {
    vi.stubEnv('WORKSPACE_ENABLED', '0');
    render(await WorkspaceRoute({ searchParams: Promise.resolve({ purchase: 'success' }) }));
    expect(screen.getByTestId('dashboard')).toHaveAttribute('data-purchase', 'true');
  });

  it('leaves the purchase flag false for an ordinary visit', async () => {
    render(await WorkspaceRoute({ searchParams: Promise.resolve({}) }));
    expect(screen.getByTestId('workspace')).toHaveAttribute('data-purchase', 'false');
  });

  it('reports Brandfetch availability from the env at render time (row 11)', async () => {
    vi.stubEnv('BRANDFETCH_API_KEY', '');
    render(await WorkspaceRoute({ searchParams: Promise.resolve({}) }));
    expect(screen.getByTestId('workspace')).toHaveAttribute('data-brand', 'false');
    cleanup();
    vi.stubEnv('BRANDFETCH_API_KEY', 'a-key');
    render(await WorkspaceRoute({ searchParams: Promise.resolve({}) }));
    expect(screen.getByTestId('workspace')).toHaveAttribute('data-brand', 'true');
  });

  it('keeps the ⟨W2⟩ 90s Server Action budget on the segment the actions post to', () => {
    // A Server Action posts to the URL the browser is on — `/` — which the
    // proxy resolves to THIS segment, so this export is the one that governs
    // askQuestion's ceiling now.
    expect(read('workspace/page.tsx')).toContain('export const maxDuration = 90;');
  });
});
