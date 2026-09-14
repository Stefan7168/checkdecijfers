// WP30c/E1 Task 7 (ADR 048, Amendment B3): the internal Eurostat explorer's
// flag-gating. Amendment B3's whole point — this codebase already had a real
// regression of exactly this shape (a route whose flag-gate silently never
// fired, #135/`/login`) — is that a flag-ON test proving the route renders is
// NOT enough on its own; a flag-OFF test proving the route actually redirects
// is required too. Mirrors web/app/dormancy.test.tsx's own
// mocked-redirect-throws pattern for /geschiedenis (the page this route's
// flag mechanism is copied from verbatim).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  // Real redirect() throws to abort rendering; mirror that so a redirect is
  // observable (and the function body provably never runs past it).
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock('../../lib/db.ts', () => ({ getDb: vi.fn(() => ({})) }));

const { listRegisteredEurostatTables, listMeasuresForTable, runExplorerQuery } = vi.hoisted(() => ({
  listRegisteredEurostatTables: vi.fn(),
  listMeasuresForTable: vi.fn(),
  runExplorerQuery: vi.fn(),
}));
vi.mock('../../lib/eurostat-explorer.ts', () => ({
  listRegisteredEurostatTables,
  listMeasuresForTable,
  runExplorerQuery,
}));

import { redirect } from 'next/navigation';
import EurostatExplorerPage, { dynamic, runtime } from './page.tsx';

const emptySearch = Promise.resolve({});

afterEach(() => {
  cleanup();
  delete process.env.EUROSTAT_EXPLORER_ENABLED;
  vi.mocked(redirect).mockClear();
  listRegisteredEurostatTables.mockReset();
  listMeasuresForTable.mockReset();
  runExplorerQuery.mockReset();
});

describe('EurostatExplorerPage — flag mechanism (Amendment B3)', () => {
  it('opts out of static prerendering (nodejs runtime) so the flag is read per request, matching /geschiedenis', () => {
    expect(dynamic).toBe('force-dynamic');
    expect(runtime).toBe('nodejs');
  });

  it('flag OFF (unset): redirects to / and never reaches the DB/list-tables read', async () => {
    delete process.env.EUROSTAT_EXPLORER_ENABLED;
    await expect(EurostatExplorerPage({ searchParams: emptySearch })).rejects.toThrow('REDIRECT:/');
    expect(redirect).toHaveBeenCalledWith('/');
    expect(listRegisteredEurostatTables).not.toHaveBeenCalled();
  });

  it('flag OFF ("0", not "1"): still redirects — only the literal "1" opens the route', async () => {
    process.env.EUROSTAT_EXPLORER_ENABLED = '0';
    await expect(EurostatExplorerPage({ searchParams: emptySearch })).rejects.toThrow('REDIRECT:/');
  });

  it('flag ON: does not redirect', async () => {
    process.env.EUROSTAT_EXPLORER_ENABLED = '1';
    listRegisteredEurostatTables.mockResolvedValue([]);
    await EurostatExplorerPage({ searchParams: emptySearch });
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe('EurostatExplorerPage — noindex (D3(a))', () => {
  it('sets noindex metadata regardless of flag state', async () => {
    const { metadata } = await import('./page.tsx');
    expect(metadata).toMatchObject({ robots: { index: false, follow: false } });
  });
});

describe('EurostatExplorerPage — honest empty state (flag ON, zero registered tables)', () => {
  beforeEach(() => {
    process.env.EUROSTAT_EXPLORER_ENABLED = '1';
    listRegisteredEurostatTables.mockResolvedValue([]);
  });

  it('says plainly that no Eurostat tables are registered yet — no picker, no query', async () => {
    render(await EurostatExplorerPage({ searchParams: emptySearch }));
    expect(screen.getByTestId('empty-state')).toHaveTextContent(/no eurostat tables are registered yet/i);
    expect(screen.queryByLabelText('Table')).toBeNull();
    expect(runExplorerQuery).not.toHaveBeenCalled();
    expect(listMeasuresForTable).not.toHaveBeenCalled();
  });
});

describe('EurostatExplorerPage — table picker (flag ON, tables registered)', () => {
  beforeEach(() => {
    process.env.EUROSTAT_EXPLORER_ENABLED = '1';
    listRegisteredEurostatTables.mockResolvedValue([{ id: 'eurostat:demo_pjan', title: 'Population' }]);
  });

  it('renders the table picker instead of the empty state', async () => {
    render(await EurostatExplorerPage({ searchParams: emptySearch }));
    expect(screen.queryByTestId('empty-state')).toBeNull();
    expect(screen.getByLabelText('Table')).toBeInTheDocument();
    expect(screen.getByText(/eurostat:demo_pjan/)).toBeInTheDocument();
  });

  it('does not run a query until a table, measure AND both years are all present', async () => {
    listMeasuresForTable.mockResolvedValue([{ code: 'demo_pjan|NR', title: 'Population — Number' }]);
    render(
      await EurostatExplorerPage({
        searchParams: Promise.resolve({ tableId: 'eurostat:demo_pjan' }),
      }),
    );
    expect(runExplorerQuery).not.toHaveBeenCalled();
  });
});
