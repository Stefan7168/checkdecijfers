// WP30c/E1 Task 7 (ADR 048, Amendment B3): the internal Eurostat explorer's
// flag-gating. Amendment B3's whole point — this codebase already had a real
// regression of exactly this shape (a route whose flag-gate silently never
// fired, #135/`/login`) — is that a flag-ON test proving the route renders is
// NOT enough on its own; a flag-OFF test proving the route actually redirects
// is required too. Mirrors web/app/dormancy.test.tsx's own
// mocked-redirect-throws pattern for /geschiedenis (the page this route's
// flag mechanism is copied from verbatim).
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  // Real redirect() throws to abort rendering; mirror that so a redirect is
  // observable (and the function body provably never runs past it).
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock('../../lib/db.ts', () => ({ getDb: vi.fn(() => ({})) }));

const { listRegisteredEurostatTables, listMeasuresForTable, runExplorerQuery, geoDimensionForTable } = vi.hoisted(
  () => ({
    listRegisteredEurostatTables: vi.fn(),
    listMeasuresForTable: vi.fn(),
    runExplorerQuery: vi.fn(),
    // Session 110 UX audit pass 3, row 5: defaults to null (no geo
    // dimension) so every EXISTING test below — none of which know this
    // function exists — keeps exercising the exact pre-fix shape (no
    // region field, no region gate) unless a test explicitly opts in.
    geoDimensionForTable: vi.fn(),
  }),
);
vi.mock('../../lib/eurostat-explorer.ts', () => ({
  listRegisteredEurostatTables,
  listMeasuresForTable,
  runExplorerQuery,
  geoDimensionForTable,
}));
// Set once at module load (not only in afterEach) so the FIRST test in the
// file — which runs before any afterEach fires — also gets the "no geo
// dimension" default rather than an unmocked `undefined`.
geoDimensionForTable.mockResolvedValue(null);

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
  geoDimensionForTable.mockReset();
  geoDimensionForTable.mockResolvedValue(null);
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

// Session 110 UX audit pass 3, row 5: demo_pjan is a geo dataset — before
// this fix, the form had no dimension picker at all, so every query on it
// ended at "Kun je aangeven voor welke regio?" with no field to answer it
// (the table, chart, CSV and proof panel were all unreachable). Pins the
// region `<select>` and the readiness gate that now waits for it.
//
// Infra note: MeasureAndFilterForm and Results are ASYNC Server Components
// nested inside EurostatExplorerPage's own returned tree. React's plain
// client renderer (what `render()` from @testing-library/react drives, the
// only renderer available under jsdom) cannot execute an async function
// component at all — it warns "<X> is an async Client Component" and never
// even CALLS the function (confirmed empirically: a spy inside such a
// component sees zero invocations after `render()` + a flushed microtask
// queue). Every EXISTING test above this block is written around that
// limitation already: it only asserts on EurostatExplorerPage's own
// synchronous, already-awaited top-level output, or on mock call COUNTS
// that happen to be correct without the nested component ever running (a
// query that should NOT run, where the gate lives in the synchronous outer
// component). A positive assertion — "the nested form renders a working
// region field", "the query DOES run with these arguments" — needs the
// nested component's body to actually execute, so these tests find the
// element in the (un-rendered) tree EurostatExplorerPage returns and call
// its `.type` (the real, plain async function) directly with its own
// `.props` — exactly what a Server Component runtime would do — then
// render or inspect the PLAIN JSX that call resolves to, no experimental/
// async rendering involved from that point on.
interface FoundElement {
  type: (props: unknown) => Promise<ReactElement>;
  props: Record<string, unknown>;
}

function findElementByTypeName(node: unknown, name: string): FoundElement | null {
  if (node == null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElementByTypeName(child, name);
      if (found) return found;
    }
    return null;
  }
  const el = node as { $$typeof?: unknown; type?: unknown; props?: { children?: unknown } };
  if (el.$$typeof) {
    if (typeof el.type === 'function' && el.type.name === name) {
      return el as unknown as FoundElement;
    }
    return findElementByTypeName(el.props?.children, name);
  }
  return null;
}

describe('EurostatExplorerPage — region picker (session 110 UX audit pass 3, row 5)', () => {
  beforeEach(() => {
    process.env.EUROSTAT_EXPLORER_ENABLED = '1';
    listRegisteredEurostatTables.mockResolvedValue([{ id: 'eurostat:demo_pjan', title: 'Population' }]);
    listMeasuresForTable.mockResolvedValue([{ code: 'demo_pjan|NR', title: 'Population — Number' }]);
  });

  it('renders no region field for a table with no geo dimension — the untouched pre-fix shape', async () => {
    geoDimensionForTable.mockResolvedValue(null);
    const pageEl = await EurostatExplorerPage({ searchParams: Promise.resolve({ tableId: 'eurostat:demo_pjan' }) });
    const formEl = findElementByTypeName(pageEl, 'MeasureAndFilterForm')!;
    expect(formEl).not.toBeNull();
    render(await formEl.type(formEl.props));
    expect(screen.queryByLabelText(/^Region/)).toBeNull();
  });

  it('renders a region select built from the table\'s own roster, for a table with a geo dimension', async () => {
    geoDimensionForTable.mockResolvedValue({
      dimension: 'geo',
      options: [
        { code: 'NL', label: 'Netherlands' },
        { code: 'BE', label: 'Belgium' },
      ],
      defaultCode: null,
    });
    const pageEl = await EurostatExplorerPage({ searchParams: Promise.resolve({ tableId: 'eurostat:demo_pjan' }) });
    const formEl = findElementByTypeName(pageEl, 'MeasureAndFilterForm')!;
    render(await formEl.type(formEl.props));
    const select = screen.getByLabelText(/^Region \(geo\)/);
    expect(select).toBeInTheDocument();
    expect(screen.getByText(/NL — Netherlands/)).toBeInTheDocument();
    expect(screen.getByText(/BE — Belgium/)).toBeInTheDocument();
  });

  it('defaults the select to the table\'s own defaultCode when no region is chosen yet', async () => {
    geoDimensionForTable.mockResolvedValue({
      dimension: 'geo',
      options: [
        { code: 'NL', label: 'Netherlands' },
        { code: 'EU27_2020', label: 'European Union - 27 countries' },
      ],
      defaultCode: 'EU27_2020',
    });
    const pageEl = await EurostatExplorerPage({ searchParams: Promise.resolve({ tableId: 'eurostat:demo_pjan' }) });
    const formEl = findElementByTypeName(pageEl, 'MeasureAndFilterForm')!;
    render(await formEl.type(formEl.props));
    const select = screen.getByLabelText(/^Region \(geo\)/) as HTMLSelectElement;
    expect(select.value).toBe('EU27_2020');
  });

  it('the readiness gate (EurostatExplorerPage\'s own synchronous output) omits Results when the table has a geo dimension but no region is chosen yet, even with measure/from/to all present', async () => {
    geoDimensionForTable.mockResolvedValue({
      dimension: 'geo',
      options: [{ code: 'NL', label: 'Netherlands' }],
      defaultCode: null,
    });
    const pageEl = await EurostatExplorerPage({
      searchParams: Promise.resolve({
        tableId: 'eurostat:demo_pjan',
        measure: 'demo_pjan|NR',
        from: '2020',
        to: '2024',
      }),
    });
    expect(findElementByTypeName(pageEl, 'Results')).toBeNull();
    expect(runExplorerQuery).not.toHaveBeenCalled();
  });

  it('runs the query, passing the chosen region through, once table/measure/from/to/region are all present', async () => {
    geoDimensionForTable.mockResolvedValue({
      dimension: 'geo',
      options: [{ code: 'NL', label: 'Netherlands' }],
      defaultCode: null,
    });
    runExplorerQuery.mockResolvedValue({ kind: 'refusal', text: 'n/a' });
    const pageEl = await EurostatExplorerPage({
      searchParams: Promise.resolve({
        tableId: 'eurostat:demo_pjan',
        measure: 'demo_pjan|NR',
        from: '2020',
        to: '2024',
        region: 'NL',
      }),
    });
    const resultsEl = findElementByTypeName(pageEl, 'Results')!;
    expect(resultsEl).not.toBeNull();
    expect(resultsEl.props).toMatchObject({ tableId: 'eurostat:demo_pjan', measure: 'demo_pjan|NR', region: 'NL' });
    await resultsEl.type(resultsEl.props); // the real function body: actually calls runExplorerQuery
    expect(runExplorerQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tableId: 'eurostat:demo_pjan', measure: 'demo_pjan|NR', region: 'NL' }),
    );
  });
});
