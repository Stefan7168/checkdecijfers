// The warm job's own logic (ADR 065 step 8): chain counter parsing, the decision to chain, the
// per-invocation time budget, the hard stop on every CBS call, the JSON summary and the run flow —
// all hermetic, with injected dependencies. The route itself is pinned in app/warm-job-route.test.ts.
import { describe, expect, it, vi } from 'vitest';
import type { WarmTableResult } from '../backend/ingestion/warm-job.ts';
import {
  ADAPTER_ATTEMPTS,
  ADAPTER_BACKOFF_MS,
  KICK_WAIT_MS,
  WARM_HARD_STOP_MS,
  WARM_MAX_CHAIN,
  WARM_METADATA_TIMEOUT_MS,
  WARM_OBSERVATIONS_TIMEOUT_MS,
  WARM_SOFT_DEADLINE_MS,
  kickWarmJob,
  parseChain,
  runWarmJob,
  shouldChainWarmJob,
  summarizeWarmResults,
  withHardStop,
  type WarmJobDeps,
} from './warm-job.ts';

const base = { planned: 4, fetched: 0, confirmed: 0, remaining: 0 };
const complete = (tableId = 'A', over: Partial<WarmTableResult> = {}): WarmTableResult => ({
  tableId,
  outcome: 'complete',
  ...base,
  fetched: 4,
  ...over,
});
const partial = (tableId = 'B', over: Partial<WarmTableResult> = {}): WarmTableResult => ({
  tableId,
  outcome: 'partial',
  ...base,
  fetched: 1,
  remaining: 3,
  ...over,
});
const skippedDeadline = (tableId = 'C'): WarmTableResult => ({
  tableId,
  outcome: 'skipped',
  planned: 0,
  fetched: 0,
  confirmed: 0,
  remaining: 0,
  skippedReason: 'deadline',
});
const failed = (tableId = 'D', quarantined = false): WarmTableResult => ({
  tableId,
  outcome: 'failed',
  ...base,
  remaining: 4,
  failure: { stage: 'fetch', summary: 'timed out', quarantined },
});

describe('parseChain', () => {
  it('reads a small non-negative integer', () => {
    expect(parseChain('0')).toBe(0);
    expect(parseChain('7')).toBe(7);
    expect(parseChain(String(WARM_MAX_CHAIN))).toBe(WARM_MAX_CHAIN);
  });
  it('treats anything else as 0', () => {
    for (const raw of [null, '', ' ', '-1', '1.5', '1e1', 'abc', '07x', '  3', '3 ', '+3', '0x10', '21', '99', '100', '99999999999999999999', 'NaN']) {
      expect(parseChain(raw)).toBe(0);
    }
  });
  it('the maximum is the documented 20', () => {
    expect(WARM_MAX_CHAIN).toBe(20);
  });
});

describe('shouldChainWarmJob', () => {
  it('chains when a table is partial and the run made progress', () => {
    expect(shouldChainWarmJob([partial()], 0)).toBe(true);
  });
  it('chains when a table was skipped for the deadline and the run made progress', () => {
    expect(shouldChainWarmJob([complete(), skippedDeadline()], 0)).toBe(true);
  });
  it('counts confirmed requests as progress too', () => {
    expect(shouldChainWarmJob([partial('B', { fetched: 0, confirmed: 2 })], 3)).toBe(true);
  });
  it('never chains when nothing was fetched or confirmed', () => {
    expect(shouldChainWarmJob([partial('B', { fetched: 0, confirmed: 0 }), skippedDeadline()], 0)).toBe(false);
  });
  it('never chains when every unfinished table failed (no retry storm against a failing source)', () => {
    expect(shouldChainWarmJob([complete(), failed('X'), failed('Y')], 0)).toBe(false);
    expect(shouldChainWarmJob([failed('X', true)], 0)).toBe(false);
  });
  it('never chains when every table is complete', () => {
    expect(shouldChainWarmJob([complete('A'), complete('B')], 0)).toBe(false);
    expect(shouldChainWarmJob([], 0)).toBe(false);
  });
  it('a skip for another reason is not unfinished work', () => {
    const notPinned: WarmTableResult = { ...skippedDeadline(), skippedReason: 'not pinned (an on-demand slice table is filled per question)' };
    expect(shouldChainWarmJob([complete(), notPinned], 0)).toBe(false);
  });
  it('chains alongside a failed table as long as another table is still unfinished and progressing', () => {
    expect(shouldChainWarmJob([failed('X'), partial('B')], 0)).toBe(true);
  });
  it('stops at the maximum: the invocation numbered WARM_MAX_CHAIN kicks nothing', () => {
    expect(shouldChainWarmJob([partial()], WARM_MAX_CHAIN - 1)).toBe(true);
    expect(shouldChainWarmJob([partial()], WARM_MAX_CHAIN)).toBe(false);
  });
});

describe('time budget (a serverless invocation is killed at 300 s)', () => {
  const LIMIT_MS = 300_000;
  // One CBS call at worst: every attempt runs to its own limit, with the adapter's linear backoff
  // (attempt n waits n x base) between attempts — no wait after the last one.
  const worstCall = (perAttemptMs: number): number =>
    ADAPTER_ATTEMPTS * perAttemptMs + (ADAPTER_BACKOFF_MS * (ADAPTER_ATTEMPTS * (ADAPTER_ATTEMPTS - 1))) / 2;

  it('the arithmetic the route comment shows', () => {
    expect(worstCall(WARM_OBSERVATIONS_TIMEOUT_MS)).toBe(139_500);
    expect(worstCall(WARM_METADATA_TIMEOUT_MS)).toBe(64_500);
  });
  it('a data request that starts just before the soft deadline ends before 300 s, with the end-of-run work included', () => {
    expect(WARM_SOFT_DEADLINE_MS + worstCall(WARM_OBSERVATIONS_TIMEOUT_MS) + KICK_WAIT_MS).toBeLessThan(LIMIT_MS - 20_000);
  });
  it('the hard stop leaves room for the last backoff, the database and the end-of-run work', () => {
    expect(WARM_HARD_STOP_MS + worstCall(0) + KICK_WAIT_MS + 5_000).toBeLessThan(LIMIT_MS - 20_000);
    expect(WARM_HARD_STOP_MS).toBeGreaterThan(WARM_SOFT_DEADLINE_MS);
  });
});

describe('withHardStop', () => {
  it('cuts a call that would outlive the stop, whatever its own limit says', async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    const guarded = withHardStop(hanging, 1_050, () => 1_000);
    const started = Date.now();
    await expect(guarded('https://cbs.example/x', { signal: AbortSignal.timeout(60_000) })).rejects.toThrow('aborted');
    expect(Date.now() - started).toBeLessThan(2_000);
  });
  it('a call made after the stop is aborted straight away', async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        if (init?.signal?.aborted) reject(new Error('aborted'));
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    const guarded = withHardStop(hanging, 1_000, () => 9_000);
    await expect(guarded('https://cbs.example/x')).rejects.toThrow('aborted');
  });
  it('before the stop it passes the call through and keeps the caller\'s own signal working', async () => {
    const seen: RequestInit[] = [];
    const inner: typeof fetch = async (_input, init) => {
      seen.push(init ?? {});
      return new Response('{}');
    };
    const guarded = withHardStop(inner, Date.now() + 60_000);
    const own = new AbortController();
    const res = await guarded('https://cbs.example/x', { signal: own.signal, headers: { Accept: 'application/json' } });
    expect(res.status).toBe(200);
    expect(seen[0]!.headers).toEqual({ Accept: 'application/json' });
    own.abort();
    expect(seen[0]!.signal!.aborted).toBe(true);
  });
});

describe('summarizeWarmResults', () => {
  it('carries outcome, the counters and the failure stage — never the failure text or anything row-shaped', () => {
    const smuggled = { ...failed('D', true), rows: [{ Value: 123456789 }], values: [1, 2, 3] } as WarmTableResult;
    const summary = summarizeWarmResults([complete('A'), partial('B'), skippedDeadline('C'), smuggled]);
    expect(summary).toEqual([
      { tableId: 'A', outcome: 'complete', planned: 4, fetched: 4, confirmed: 0, remaining: 0 },
      { tableId: 'B', outcome: 'partial', planned: 4, fetched: 1, confirmed: 0, remaining: 3 },
      { tableId: 'C', outcome: 'skipped', planned: 0, fetched: 0, confirmed: 0, remaining: 0 },
      {
        tableId: 'D',
        outcome: 'failed',
        planned: 4,
        fetched: 0,
        confirmed: 0,
        remaining: 4,
        failureStage: 'fetch',
        quarantined: true,
      },
    ]);
    expect(JSON.stringify(summary)).not.toContain('123456789');
    expect(JSON.stringify(summary)).not.toContain('timed out');
  });
});

describe('kickWarmJob', () => {
  const capture = () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), auth: new Headers(init?.headers).get('authorization') });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    return { calls, fetchImpl };
  };
  it('the daily kick calls the bare route', async () => {
    const { calls, fetchImpl } = capture();
    await kickWarmJob(0, { secret: 's', host: 'example.test', fetchImpl });
    expect(calls).toEqual([{ url: 'https://example.test/api/warm-job', auth: 'Bearer s' }]);
  });
  it('a chained kick passes the counter as a query parameter', async () => {
    const { calls, fetchImpl } = capture();
    await kickWarmJob(3, { secret: 's', host: 'example.test', fetchImpl });
    expect(calls[0]!.url).toBe('https://example.test/api/warm-job?chain=3');
  });
  it('is fail-soft: unset config or a throwing fetch never throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(kickWarmJob(0, { secret: undefined, host: undefined, fetchImpl: (async () => new Response('')) as typeof fetch })).resolves.toBeUndefined();
    await expect(
      kickWarmJob(1, {
        secret: 's',
        host: 'h',
        fetchImpl: (async () => {
          throw new Error('dns');
        }) as typeof fetch,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('runWarmJob', () => {
  const makeDeps = (results: WarmTableResult[]) => {
    const warm = vi.fn(async (_opts: { deadline: number }) => results);
    const kickNext = vi.fn(async (_chain: number) => {});
    const alert = vi.fn(async (_results: readonly WarmTableResult[], _dailyRun: boolean) => {});
    const deps: WarmJobDeps = { startedAt: 1_000_000, warm, kickNext, alert };
    return { deps, warm, kickNext, alert };
  };

  it('warms until the soft deadline, measured from the start of the invocation', async () => {
    const { deps, warm } = makeDeps([complete()]);
    await runWarmJob(deps, 0);
    expect(warm).toHaveBeenCalledWith({ deadline: 1_000_000 + WARM_SOFT_DEADLINE_MS });
  });

  it('chains once, with the next counter, when work is left and progress was made', async () => {
    const { deps, kickNext } = makeDeps([partial()]);
    const out = await runWarmJob(deps, 4);
    expect(kickNext).toHaveBeenCalledTimes(1);
    expect(kickNext).toHaveBeenCalledWith(5);
    expect(out.chained).toBe(true);
    expect(out.chain).toBe(4);
  });

  it('does not chain when nothing progressed, when everything failed, or at the maximum', async () => {
    for (const [results, chain] of [
      [[partial('B', { fetched: 0 })], 0],
      [[failed()], 0],
      [[partial()], WARM_MAX_CHAIN],
    ] as const) {
      const { deps, kickNext } = makeDeps([...results]);
      const out = await runWarmJob(deps, chain);
      expect(kickNext).not.toHaveBeenCalled();
      expect(out.chained).toBe(false);
    }
  });

  it('asks for the failure alert on every run, telling it whether this is the daily (first) run', async () => {
    const first = makeDeps([failed()]);
    await runWarmJob(first.deps, 0);
    expect(first.alert).toHaveBeenCalledWith(expect.any(Array), true);
    const later = makeDeps([failed()]);
    await runWarmJob(later.deps, 2);
    expect(later.alert).toHaveBeenCalledWith(expect.any(Array), false);
  });

  it('a failing kick or alert never fails the run', async () => {
    const { deps } = makeDeps([partial()]);
    deps.kickNext = async () => {
      throw new Error('kick exploded');
    };
    deps.alert = async () => {
      throw new Error('alert exploded');
    };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await runWarmJob(deps, 0);
    expect(out.tables).toHaveLength(1);
  });

  it('returns the summary with no row data', async () => {
    const { deps } = makeDeps([complete(), failed()]);
    const out = await runWarmJob(deps, 0);
    expect(Object.keys(out).sort()).toEqual(['chain', 'chained', 'tables']);
    expect(out.tables.map((t) => t.tableId)).toEqual(['A', 'D']);
  });
});
