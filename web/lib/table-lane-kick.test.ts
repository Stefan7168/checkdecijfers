// Breadth step 5, Task 4 (fix round 1, ruling R11): the table-lane kick is a
// thin wrapper over the ONE shared fail-soft kick (web/lib/cron-kick.ts, whose
// every branch is pinned through web/lib/onboarding-kick.test.ts). Here only
// what the wrapper adds: its exact route URL + header, and the fail-soft pin.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kickTableLaneJob } from './table-lane-kick.ts';

const HOST = 'checkdecijfers.vercel.app';
const SECRET = 's3cr3t-cron-value';

describe('kickTableLaneJob (wrapper over the shared cron kick)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fires the table-lane job route exactly once with the exact URL and Bearer header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await kickTableLaneJob({ fetchImpl: fetchImpl as unknown as typeof fetch, secret: SECRET, host: HOST });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://checkdecijfers.vercel.app/api/table-lane-job');
    expect(init.headers).toEqual({ authorization: 'Bearer s3cr3t-cron-value' });
    expect(init.cache).toBe('no-store');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(console.info).toHaveBeenCalledWith('table-lane kick dispatched (job route responded ok)');
  });

  it('resolves without throwing when fetch rejects, and skips with no config', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      kickTableLaneJob({ fetchImpl: failing as unknown as typeof fetch, secret: SECRET, host: HOST }),
    ).resolves.toBeUndefined();

    const unused = vi.fn();
    await expect(kickTableLaneJob({ fetchImpl: unused as unknown as typeof fetch, secret: '', host: HOST })).resolves.toBeUndefined();
    expect(unused).not.toHaveBeenCalled();
  });

  it('session 153: an unreachable production host (DNS) is followed by the vercel.app address; a non-OK reply or timeout is not retried', async () => {
    const dns = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    const fetchImpl = vi.fn().mockRejectedValueOnce(dns).mockResolvedValueOnce({ ok: true, status: 200 });
    await kickTableLaneJob({ fetchImpl: fetchImpl as unknown as typeof fetch, secret: SECRET, host: 'graphmaker.studio' });
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([
      'https://graphmaker.studio/api/table-lane-job',
      'https://checkdecijfers.vercel.app/api/table-lane-job',
    ]);
    expect(console.info).toHaveBeenCalledWith('table-lane kick dispatched (job route responded ok)');

    const notOk = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    await kickTableLaneJob({ fetchImpl: notOk as unknown as typeof fetch, secret: SECRET, host: 'graphmaker.studio' });
    expect(notOk).toHaveBeenCalledTimes(1);

    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const slow = vi.fn().mockRejectedValue(timeout);
    await kickTableLaneJob({ fetchImpl: slow as unknown as typeof fetch, secret: SECRET, host: 'graphmaker.studio' });
    expect(slow).toHaveBeenCalledTimes(1);
  });
});

