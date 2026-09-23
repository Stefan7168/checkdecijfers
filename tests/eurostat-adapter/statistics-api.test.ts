// WP30c/E1 — StatisticsApiSource is written and unit-tested with a
// DEPENDENCY-INJECTED fetch stub only (Constraint 0: no live HTTP call to
// the real Eurostat API happens this session). Every test here proves the
// class's own plumbing (URL construction, caching, error handling) against
// a hand-built synthetic response — never a network call.
import { describe, expect, it, vi } from 'vitest';
import type { CbsSlice } from '../../src/cbs-adapter/types.ts';
import { StatisticsApiSource } from '../../src/eurostat-adapter/statistics-api.ts';
import { EU_EFTA_STAND_IN_GEO_CODES } from '../../src/eurostat-adapter/jsonstat.ts';

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

// E2a step-5 prerequisite: server-side slice filtering (ADR 048 D6's
// "server-side filtered per CbsSlice", not actually built until now — see
// docs/superpowers/specs/2026-09-23-eurostat-e2a-step5-sibling-datasets.md).
describe('StatisticsApiSource — server-side CbsSlice filtering in the request URL', () => {
  const SORTED_GEO_CODES = [...EU_EFTA_STAND_IN_GEO_CODES].sort();

  it('no slice — the request URL is BYTE-IDENTICAL to the pre-fix shape (tipsbd30, the one registered table)', async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(SAMPLE_DATASET));
    const source = new StatisticsApiSource(fetchFn as unknown as typeof fetch);

    // tipsbd30 is registered with NO slice (tests/ingestion/ingestion.test.ts,
    // e.g. `{ id: 'eurostat:tipsbd30', updateCadence: 'twice daily',
    // servesTasks: [] }` — no `.slice` field at all), so this is exactly the
    // real call shape that must not change.
    for await (const _page of source.fetchObservations('eurostat:tipsbd30')) {
      // draining the iterable
    }

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const calledUrl = fetchFn.mock.calls[0]![0] as string;
    expect(calledUrl).toBe(
      'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/tipsbd30?format=JSON&lang=EN',
    );
  });

  it('dimensionEquals entries each become one <dim>=<code> query param', async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(SAMPLE_DATASET));
    const source = new StatisticsApiSource(fetchFn as unknown as typeof fetch);
    const slice: CbsSlice = { dimensionEquals: { s_adj: 'SA', age: 'Y15-74', sex: 'T', unit: 'PC_ACT' } };

    for await (const _page of source.fetchObservations('eurostat:une_rt_q', slice)) {
      // draining
    }

    const calledUrl = fetchFn.mock.calls[0]![0] as string;
    expect(calledUrl).toContain('s_adj=SA');
    expect(calledUrl).toContain('age=Y15-74');
    expect(calledUrl).toContain('sex=T');
    expect(calledUrl).toContain('unit=PC_ACT');
  });

  it('the D6 structural geo restriction is ALWAYS present (as repeated geo=<code> params) whenever a slice is given', async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(SAMPLE_DATASET));
    const source = new StatisticsApiSource(fetchFn as unknown as typeof fetch);
    // A slice with no dimensionEquals/periodFloor at all — geo restriction
    // must still show up, because it's structural, not slice-derived.
    const slice: CbsSlice = { dimensionPrefixes: { irrelevant: ['x'] } };

    for await (const _page of source.fetchObservations('eurostat:demo_pjan', slice)) {
      // draining
    }

    const calledUrl = fetchFn.mock.calls[0]![0] as string;
    const geoParams = [...calledUrl.matchAll(/geo=([^&]+)/g)].map((m) => m[1]);
    expect(geoParams).toEqual(SORTED_GEO_CODES); // sorted, deterministic order
    expect(geoParams.length).toBe(EU_EFTA_STAND_IN_GEO_CODES.size);
    // dimensionPrefixes itself never appears — no server equivalent (client-side only).
    expect(calledUrl).not.toContain('irrelevant');
  });

  it('periodFloor converts annual/quarterly/monthly CBS codes to Eurostat sinceTimePeriod format', async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(SAMPLE_DATASET));
    const source = new StatisticsApiSource(fetchFn as unknown as typeof fetch);

    const cases: Array<[string, string]> = [
      ['2015JJ00', 'sinceTimePeriod=2015'],
      ['2015KW01', 'sinceTimePeriod=2015-Q1'],
      ['2015MM01', 'sinceTimePeriod=2015-01'],
    ];
    for (const [periodFloor, expectedParam] of cases) {
      fetchFn.mockClear();
      const slice: CbsSlice = { periodFloor };
      for await (const _page of source.fetchObservations(`eurostat:demo_${periodFloor}`, slice)) {
        // draining
      }
      const calledUrl = fetchFn.mock.calls[0]![0] as string;
      expect(calledUrl).toContain(expectedParam);
    }
  });

  it('an unconvertible periodFloor throws (refusal, never a silent drop)', async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(SAMPLE_DATASET));
    const source = new StatisticsApiSource(fetchFn as unknown as typeof fetch);
    const slice: CbsSlice = { periodFloor: 'not-a-real-period' };

    await expect(async () => {
      for await (const _page of source.fetchObservations('eurostat:demo_pjan', slice)) {
        // should never get here
      }
    }).rejects.toThrow(/not a valid CBS period code/);
    expect(fetchFn).not.toHaveBeenCalled(); // refused before ever hitting the wire
  });

  it('param order is deterministic (sorted) — same slice, same URL, every time', async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(SAMPLE_DATASET));
    const source1 = new StatisticsApiSource(fetchFn as unknown as typeof fetch);
    const source2 = new StatisticsApiSource(fetchFn as unknown as typeof fetch);
    const slice: CbsSlice = { dimensionEquals: { sex: 'T', age: 'Y15-74' }, periodFloor: '2015JJ00' };

    for await (const _page of source1.fetchObservations('eurostat:demo_pjan', slice)) {
      // draining
    }
    for await (const _page of source2.fetchObservations('eurostat:demo_pjan', slice)) {
      // draining
    }

    expect(fetchFn.mock.calls[0]![0]).toBe(fetchFn.mock.calls[1]![0]);
  });

  it('a dimensionEquals pinning "geo" is REFUSED — it would silently coexist with the structural geo sweep', async () => {
    // code-review finding (LOW effort, this branch): dimensionEquals.geo
    // would otherwise sit alongside the ~34-code structural sweep rather
    // than replacing it, producing a request with both the caller's single
    // geo=<code> AND every structural geo code — never what a caller
    // pinning one country would want. Refuse loudly instead.
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(SAMPLE_DATASET));
    const source = new StatisticsApiSource(fetchFn as unknown as typeof fetch);
    const slice: CbsSlice = { dimensionEquals: { geo: 'DE' } };

    await expect(async () => {
      for await (const _page of source.fetchObservations('eurostat:demo_pjan', slice)) {
        // should never get here
      }
    }).rejects.toThrow(/must never pin 'geo'/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('a stubbed unfiltered ("no slice") request over the cap throws, but the SAME table with a slice — whose URL the ' +
    'server would filter on — resolves to a small response: the threshold now judges the (server-)filtered size',
    async () => {
      // Cheap stand-in for a real "over cap" response: only `size`'s product
      // matters for AsyncApiRequiredError (jsonstat.ts throws on `total`
      // BEFORE examining `dimension`/`value` at all), so this needs no giant
      // arrays.
      const OVER_CAP_DATASET = { id: ['unit', 'geo', 'time'], size: [1, 1000, 1000], dimension: {}, value: {} };

      const fetchFn = vi.fn(async (url: string, _init?: RequestInit) => {
        // A real Eurostat server would shrink `size` once the request
        // carries filter params (verified live — see the sibling-datasets
        // research doc); the stub simulates exactly that server behaviour so
        // this test proves the ADAPTER's URL now carries those params, not
        // that this project's fetch stub can filter real data.
        return url.includes('geo=') ? jsonResponse(SAMPLE_DATASET) : jsonResponse(OVER_CAP_DATASET);
      });
      const source = new StatisticsApiSource(fetchFn as unknown as typeof fetch);

      // No slice -> unfiltered URL -> the stubbed "still huge" response -> refused.
      await expect(async () => {
        for await (const _page of source.fetchObservations('eurostat:demo_pjan')) {
          // should never get here
        }
      }).rejects.toThrow(/500000-cell synchronous/);

      // A slice -> filtered URL (contains geo=) -> the stubbed "now small" response -> succeeds.
      const slice: CbsSlice = { dimensionEquals: { unit: 'NR' } };
      const rows: number[] = [];
      for await (const page of source.fetchObservations('eurostat:demo_pjan_sliced', slice)) {
        rows.push(page.length);
      }
      expect(rows).toEqual([1]);
    },
  );
});
