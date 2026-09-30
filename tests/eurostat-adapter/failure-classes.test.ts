// #357, study step 0 defects 1 and 2: Eurostat failures are classified into transient (retried) and permanent
// (never retried, a short specific summary), and every call runs under ONE total deadline inside the run budget.
// Hermetic: a stubbed fetch replays the recorded response shapes in tests/fixtures/eurostat-errors/ (hand-built to
// the study's shapes, not captured live); no network.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { CbsSlice } from '../../src/cbs-adapter/types.ts';
import {
  classifyFailedResponse,
  classifyOkBody,
  EurostatPermanentError,
  isRetryableStatus,
} from '../../src/eurostat-adapter/errors.ts';
import { CALL_LIMITS, StatisticsApiSource } from '../../src/eurostat-adapter/statistics-api.ts';
import { BUDGET_ENDED_PHRASE } from '../../src/sources/fetch-with-timeout.ts';

interface RecordedError {
  httpStatus: number;
  body: unknown;
}
const BODIES = JSON.parse(
  readFileSync(new URL('../fixtures/eurostat-errors/error-bodies.json', import.meta.url), 'utf8'),
) as Record<string, RecordedError>;

function replay(rec: RecordedError): Response {
  const ok = rec.httpStatus >= 200 && rec.httpStatus < 300;
  return {
    ok,
    status: rec.httpStatus,
    statusText: ok ? 'OK' : 'Error',
    json: async () => rec.body,
    text: async () => JSON.stringify(rec.body),
  } as unknown as Response;
}

const OK_DATASET = {
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
const SLICE: CbsSlice = { dimensionEquals: { unit: 'NR' } };
const FAST = { retryBackoffMs: 1 };

async function failure(source: StatisticsApiSource, tableId = 'eurostat:demo_pjan', slice: CbsSlice | null = SLICE) {
  return (await source.fetchTableSchema(tableId, slice ?? undefined).catch((e: unknown) => e)) as Error;
}

describe('permanent Eurostat failures are classified, worded briefly and never retried', () => {
  const cases: Array<[string, keyof typeof BODIES, string, RegExp]> = [
    ['404 -> not_found', 'notFound404', 'not_found', /unknown dataset, 404, not retried/],
    ['400 id 150 -> invalid_dimension', 'unknownCode400', 'invalid_dimension', /unknown dimension or code in the filter, 400/],
    ['400 id 140 -> invalid_period', 'badPeriod400', 'invalid_period', /period not usable, 400/],
    ['other 400 -> conflicting_params', 'other400', 'conflicting_params', /inconsistent, 400/],
    ['413 status -> too_large', 'tooLarge413', 'too_large', /too large.*413/],
    ['HTTP 200 + warning 413 -> too_large', 'tooLargeWarning200', 'too_large', /too large.*413/],
    ['HTTP 200 + error id 100 -> no_results', 'noResults200', 'no_results', /no data for this selection/],
  ];
  for (const [name, key, kind, text] of cases) {
    it(`${name}: one request, a typed error, the reason in the message`, async () => {
      const fetchFn = vi.fn(async () => replay(BODIES[key]!));
      const source = new StatisticsApiSource(fetchFn as unknown as typeof fetch, FAST);
      const err = await failure(source);
      expect(err).toBeInstanceOf(EurostatPermanentError);
      expect((err as EurostatPermanentError).kind).toBe(kind);
      expect(err.message).toMatch(text);
      expect(err.message).toContain('demo_pjan');
      // never a budget cut, never "after 3 attempts": it was not retried
      expect(err.message).not.toContain(BUDGET_ENDED_PHRASE);
      expect(err.message).not.toMatch(/after \d attempts/);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
  }

  it('the label Eurostat gave is carried into the summary, bounded to 200 characters', async () => {
    const rec: RecordedError = { httpStatus: 400, body: { error: [{ status: 400, id: 150, label: 'x'.repeat(500) }] } };
    const err = classifyFailedResponse(rec.httpStatus, JSON.stringify(rec.body), 'https://example.test/d')!;
    expect(err.message.length).toBeLessThan(400);
    expect(err.message).toContain('…');
  });

  it('a 4xx whose body is not JSON (an HTML error page) is still permanent, summarised from the page text', () => {
    const err = classifyFailedResponse(403, '<html><body><h1>Forbidden</h1></body></html>', 'https://example.test/d')!;
    expect(err.kind).toBe('rejected');
    expect(err.message).toContain('Forbidden');
    expect(err.message).not.toContain('<h1>');
  });

  it('the catalogue call classifies too (a 404 is not retried)', async () => {
    const fetchFn = vi.fn(async () => replay(BODIES.notFound404!));
    const source = new StatisticsApiSource(fetchFn as unknown as typeof fetch, FAST);
    await expect(source.fetchCatalog()).rejects.toBeInstanceOf(EurostatPermanentError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('a permanent failure ends the call even with budget left, and is not reported as a budget cut', async () => {
    const fetchFn = vi.fn(async () => replay(BODIES.tooLarge413!));
    const source = new StatisticsApiSource(fetchFn as unknown as typeof fetch, { ...FAST, stopAt: Date.now() + 60_000 });
    const err = await failure(source);
    expect(err).toBeInstanceOf(EurostatPermanentError);
    expect(err.message).not.toContain(BUDGET_ENDED_PHRASE);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('never turns an error into data: an HTTP 200 error body yields a rejection, no rows', async () => {
    const fetchFn = vi.fn(async () => replay(BODIES.tooLargeWarning200!));
    const source = new StatisticsApiSource(fetchFn as unknown as typeof fetch, FAST);
    await expect(
      (async () => {
        for await (const _page of source.fetchObservations('eurostat:demo_pjan', SLICE)) {
          // never reached
        }
      })(),
    ).rejects.toBeInstanceOf(EurostatPermanentError);
  });
});

describe('transient failures are still retried', () => {
  it('the retryable statuses are 408, 429 and every 5xx; every other non-2xx is permanent', () => {
    for (const s of [408, 429, 500, 502, 503, 504]) expect(isRetryableStatus(s)).toBe(true);
    for (const s of [400, 401, 403, 404, 405, 410, 413, 414, 422]) expect(isRetryableStatus(s)).toBe(false);
    expect(classifyFailedResponse(503, '', 'https://example.test/d')).toBeNull();
  });

  it('a 503 then a good reply succeeds on the second attempt', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' })
      .mockResolvedValueOnce(replay({ httpStatus: 200, body: OK_DATASET }));
    const source = new StatisticsApiSource(fetchFn as unknown as typeof fetch, FAST);
    expect((await source.fetchTableSchema('eurostat:demo_pjan', SLICE)).measures.length).toBe(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('a 429 is retried up to 3 attempts, then fails as an ordinary (non-permanent) error', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 429, statusText: 'Too Many Requests' }) as unknown as Response);
    const source = new StatisticsApiSource(fetchFn as unknown as typeof fetch, FAST);
    const err = await failure(source);
    expect(err).not.toBeInstanceOf(EurostatPermanentError);
    expect(err.message).toMatch(/failed after 3 attempts/);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('an HTML page where JSON was expected (a rate-limit page) is retried, not classified as permanent', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    }));
    const source = new StatisticsApiSource(fetchFn as unknown as typeof fetch, FAST);
    const err = await failure(source);
    expect(err).not.toBeInstanceOf(EurostatPermanentError);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('a real dataset body is never mistaken for an error body', () => {
    expect(classifyOkBody(OK_DATASET, 'https://example.test/d')).toBeNull();
    expect(classifyOkBody({ class: 'dataset', id: [], size: [], error: [{ status: 400 }] }, 'https://example.test/d')).toBeNull();
  });
});

describe('one total deadline per call, inside the run budget', () => {
  it('defaults: a data call is limited to 30 s per attempt and 60 s per call, bulk to 120 s / 240 s', () => {
    expect(CALL_LIMITS.data).toEqual({ attemptMs: 30_000, totalMs: 60_000 });
    expect(CALL_LIMITS.bulk).toEqual({ attemptMs: 120_000, totalMs: 240_000 });
    // a data call stays well inside the table-lane job budget (240 s, ADR 062)
    expect(CALL_LIMITS.data.totalMs).toBeLessThanOrEqual(240_000 / 2);
  });

  it('a slice-bounded request is a data call; an unsliced whole-dataset read and the catalogue are bulk calls', async () => {
    const serverDown = vi.fn(async () => ({ ok: false, status: 500, statusText: 'Server Error' }) as unknown as Response);
    const source = new StatisticsApiSource(serverDown as unknown as typeof fetch, FAST);
    expect((await failure(source, 'eurostat:demo_pjan', SLICE)).message).toContain('limit for one call: 60 s');
    expect((await failure(source, 'eurostat:demo_pjan', null)).message).toContain('limit for one call: 240 s');
    expect(((await source.fetchCatalog().catch((e: unknown) => e)) as Error).message).toContain('limit for one call: 240 s');
  });

  it('retries share ONE deadline: a hung call gives up when the total is spent, not after 3 full attempts', async () => {
    const fetchFn = vi.fn(() => new Promise<never>(() => {}));
    // per attempt 60 ms, total 100 ms: attempt 1 uses 60, attempt 2 only the ~40 left, no third attempt
    const source = new StatisticsApiSource(fetchFn as unknown as typeof fetch, { timeoutMs: 60, totalMs: 100, retryBackoffMs: 1 });
    const started = Date.now();
    const err = await failure(source);
    const elapsed = Date.now() - started;
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(err.message).toMatch(/failed after 2 attempts \(limit for one call: 0\.1 s\)/);
    expect(err.message).toMatch(/timed out after/);
    expect(err.message).not.toContain(BUDGET_ENDED_PHRASE); // its own limit, a real source failure
    expect(elapsed).toBeLessThan(400);
  });

  it('the run budget wins: a call is cut at stopAt, once, with the phrase the warm job reads', async () => {
    const fetchFn = vi.fn(() => new Promise<never>(() => {}));
    const source = new StatisticsApiSource(fetchFn as unknown as typeof fetch, { retryBackoffMs: 1, stopAt: Date.now() + 60 });
    const started = Date.now();
    const err = await failure(source);
    expect(err.message).toContain(BUDGET_ENDED_PHRASE);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeLessThan(400);
  });

  it('a call never starts once the budget is spent', async () => {
    const fetchFn = vi.fn();
    const source = new StatisticsApiSource(fetchFn as unknown as typeof fetch, { stopAt: Date.now() - 1 });
    expect((await failure(source)).message).toContain(BUDGET_ENDED_PHRASE);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
