// Breadth step 5, Task 4: the table-lane job KICK — a copy of the onboarding
// kick (#113) pointed at /api/table-lane-job, with the same fail-soft contract:
// a failed kick may never throw (it runs inside the Server Action's after())
// or affect money / the routing turn. Injected fetch and env, no real network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kickTableLaneJob } from './table-lane-kick.ts';

const HOST = 'checkdecijfers.vercel.app';
const SECRET = 's3cr3t-cron-value';

describe('kickTableLaneJob (fail-soft, same contract as the onboarding kick)', () => {
  beforeEach(() => {
    // The kick logs on skip/failure/dispatch; keep the suite output clean while
    // still exercising those branches.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fires the cron route exactly once with the exact URL and Bearer header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await kickTableLaneJob({ fetchImpl: fetchImpl as unknown as typeof fetch, secret: SECRET, host: HOST });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    // Pin the FULL strings (byte-match), not substrings: the URL and the exact
    // header the route checks (`Bearer ${cronSecret}`).
    expect(url).toBe('https://checkdecijfers.vercel.app/api/table-lane-job');
    expect(init.headers).toEqual({ authorization: 'Bearer s3cr3t-cron-value' });
    expect(init.cache).toBe('no-store');
    // A bounded dispatch-wait signal must be attached (see the timeout branch
    // below): the kick must not block for the whole job.
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('stops waiting after the timeout and resolves without throwing (dispatch, not job-completion)', async () => {
    // A fetch that models the real cron route: it never resolves on its own
    // (the job outlives the wait) and only settles when the abort signal fires.
    // This is the long-job path — the request was dispatched, the job runs
    // server-side, and the kick must not throw or block past the timeout.
    const fetchImpl = vi.fn(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal!.reason));
        }),
    );

    await expect(
      kickTableLaneJob({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        secret: SECRET,
        host: HOST,
        timeoutMs: 20,
      }),
    ).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // The timeout is the EXPECTED path: logged as benign dispatch, never as an
    // error (else every long job would look like a failure).
    expect(console.error).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalled();
  });

  it('skips (never calls fetch) and resolves when the secret is missing', async () => {
    const fetchImpl = vi.fn();

    await expect(
      kickTableLaneJob({ fetchImpl: fetchImpl as unknown as typeof fetch, secret: '', host: HOST }),
    ).resolves.toBeUndefined();

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('skips (never calls fetch) and resolves when the host is missing', async () => {
    const fetchImpl = vi.fn();

    await expect(
      kickTableLaneJob({ fetchImpl: fetchImpl as unknown as typeof fetch, secret: SECRET, host: '' }),
    ).resolves.toBeUndefined();

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('resolves without throwing when fetch rejects (THE fail-soft pin)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      kickTableLaneJob({ fetchImpl: fetchImpl as unknown as typeof fetch, secret: SECRET, host: HOST }),
    ).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('resolves without throwing on a non-OK response (e.g. 401)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 });

    await expect(
      kickTableLaneJob({ fetchImpl: fetchImpl as unknown as typeof fetch, secret: SECRET, host: HOST }),
    ).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
