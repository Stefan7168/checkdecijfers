// WP30c/E1 — StatisticsApiSource is written and unit-tested with a
// DEPENDENCY-INJECTED fetch stub only (Constraint 0: no live HTTP call to
// the real Eurostat API happens this session). Every test here proves the
// class's own plumbing (URL construction, caching, error handling) against
// a hand-built synthetic response — never a network call.
import { describe, expect, it, vi } from 'vitest';
import { StatisticsApiSource } from '../../src/eurostat-adapter/statistics-api.ts';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
  } as unknown as Response;
}

function textResponse(body: string, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    text: async () => body,
  } as unknown as Response;
}

const SAMPLE_DATASET = {
  version: '2.0',
  class: 'dataset',
  label: 'Population on 1 January',
  id: ['unit', 'geo', 'time'],
  size: [1, 1, 1],
  dimension: {
    unit: { category: { index: { NR: 0 }, label: { NR: 'Number' } } },
    geo: { category: { index: { NL: 0 }, label: { NL: 'Netherlands' } } },
    time: { category: { index: { 2024: 0 }, label: { 2024: '2024' } } },
  },
  value: [17_811_291],
};

describe('StatisticsApiSource — dependency-injected fetch only, never a live URL', () => {
  it('fetchTableSchema/fetchCodeList/fetchObservations/fetchObservationCount all derive from ONE fetch', async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(SAMPLE_DATASET));
    const source = new StatisticsApiSource(fetchFn as unknown as typeof fetch);

    const schema = await source.fetchTableSchema('eurostat:demo_pjan');
    expect(schema.title).toBe('Population on 1 January');
    expect(schema.measures.map((m) => m.code)).toEqual(['demo_pjan|NR']);

    const geoCodes = await source.fetchCodeList('eurostat:demo_pjan', 'geo');
    expect(geoCodes.map((c) => c.code)).toEqual(['NL']);

    const count = await source.fetchObservationCount('eurostat:demo_pjan');
    expect(count).toBe(1);

    const pages: number[] = [];
    for await (const page of source.fetchObservations('eurostat:demo_pjan')) pages.push(page.length);
    expect(pages).toEqual([1]);

    // Same (tableId, no slice) request twice — the dataset is cached, not
    // re-fetched, so only ONE underlying fetch call happened for all four
    // reads above.
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const calledUrl = fetchFn.mock.calls[0]![0] as string;
    expect(calledUrl).toContain('demo_pjan');
    expect(calledUrl).not.toContain('eurostat:'); // the prefix is stripped before hitting the wire
  });

  it('never invokes the real global fetch — the default parameter is never exercised by any test', async () => {
    // This test documents Constraint 0 rather than proving a negative: every
    // test in this file (and the whole suite) always passes its own stub.
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(SAMPLE_DATASET));
    const source = new StatisticsApiSource(fetchFn as unknown as typeof fetch);
    await source.fetchTableSchema('eurostat:demo_pjan');
    expect(fetchFn).toHaveBeenCalled();
  });

  it('retries on a non-ok response and eventually throws a descriptive error', async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({}, false, 500));
    const source = new StatisticsApiSource(fetchFn as unknown as typeof fetch);
    await expect(source.fetchTableSchema('eurostat:broken')).rejects.toThrow(/Eurostat request failed/);
    expect(fetchFn).toHaveBeenCalledTimes(3); // FETCH_ATTEMPTS
  }, 15_000);

  it('fetchCatalog parses the REAL, verified Catalogue "table of contents" TEXT shape via the injected stub', async () => {
    const toc = [
      '"title"\t"code"\t"type"\t"last update of data"\t"last table structure change"\t"data start"\t"data end"\t"values"',
      '"    Population on 1 January"\t"demo_pjan"\t"dataset"\t"14.08.2026"\t"13.02.2026"\t"1960"\t"2025"\t742730',
    ].join('\n');
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => textResponse(toc));
    const source = new StatisticsApiSource(fetchFn as unknown as typeof fetch);
    const entries = await source.fetchCatalog();
    expect(entries).toEqual([
      {
        tableId: 'eurostat:demo_pjan',
        title: 'Population on 1 January',
        summary: '',
        status: null,
        datasetType: 'dataset',
        language: 'en',
        modified: '2026-08-14',
      },
    ]);
    // No Accept:application/json header — the real endpoint 406s on that.
    const [, init] = fetchFn.mock.calls[0]!;
    expect((init?.headers as Record<string, string> | undefined)?.Accept).toBeUndefined();
  });
});
