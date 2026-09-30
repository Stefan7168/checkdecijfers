// Time limit on outbound fetches + readable upstream-error summaries (#357).
// No network: every case injects a stub fetch.
import { describe, expect, it } from 'vitest';
import {
  fetchAndRead,
  fetchWithTimeout,
  summarizeErrorBody,
} from '../../src/sources/fetch-with-timeout.ts';

const URL_ = 'https://example.test/odata/Thing';

// A stub fetch that resolves headers at once but whose body never completes,
// and that ignores the abort signal (the worst case: only our own race can
// cut it off).
function stalledBodyFetch(): typeof fetch {
  return (async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => new Promise(() => {}),
    text: () => new Promise(() => {}),
  })) as unknown as typeof fetch;
}

describe('fetchWithTimeout', () => {
  it('returns the response when the server answers in time', async () => {
    const res = { ok: true, status: 200 } as Response;
    const fetchFn = (async () => res) as unknown as typeof fetch;
    await expect(fetchWithTimeout(URL_, undefined, 1000, fetchFn)).resolves.toBe(res);
  });

  it('passes the init through and attaches an abort signal', async () => {
    let seen: RequestInit | undefined;
    const fetchFn = (async (_u: string, init?: RequestInit) => {
      seen = init;
      return { ok: true } as Response;
    }) as unknown as typeof fetch;
    await fetchWithTimeout(URL_, { headers: { Accept: 'application/json' } }, 1000, fetchFn);
    expect(seen?.headers).toEqual({ Accept: 'application/json' });
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects with a timeout error naming the URL when the server never answers', async () => {
    const fetchFn = (async () => new Promise(() => {})) as unknown as typeof fetch;
    await expect(fetchWithTimeout(URL_, undefined, 20, fetchFn)).rejects.toThrow(
      /timed out after 0\.02 seconds.*example\.test\/odata\/Thing/,
    );
  });

  it('rejects with the timeout error when a signal-honouring fetch aborts', async () => {
    const fetchFn = ((_u: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      })) as unknown as typeof fetch;
    await expect(fetchWithTimeout(URL_, undefined, 20, fetchFn)).rejects.toThrow(/timed out after/);
  });

  it('does not swallow a caller abort: it rejects with the caller reason, not a timeout', async () => {
    const controller = new AbortController();
    const fetchFn = (async () => new Promise(() => {})) as unknown as typeof fetch;
    const p = fetchWithTimeout(URL_, { signal: controller.signal }, 5000, fetchFn);
    controller.abort(new Error('caller gave up'));
    await expect(p).rejects.toThrow('caller gave up');
  });

  it('propagates an ordinary fetch failure unchanged', async () => {
    const fetchFn = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    await expect(fetchWithTimeout(URL_, undefined, 1000, fetchFn)).rejects.toThrow('ECONNRESET');
  });
});

describe('fetchAndRead — the time limit also covers the body', () => {
  it('returns the value read from the response', async () => {
    const fetchFn = (async () => ({ ok: true, json: async () => ({ a: 1 }) })) as unknown as typeof fetch;
    const value = await fetchAndRead(URL_, undefined, 1000, (res) => res.json(), fetchFn);
    expect(value).toEqual({ a: 1 });
  });

  it('cuts off a server that sends headers and then stalls the body', async () => {
    await expect(
      fetchAndRead(URL_, undefined, 20, (res) => res.json(), stalledBodyFetch()),
    ).rejects.toThrow(/timed out after 0\.02 seconds.*example\.test\/odata\/Thing/);
  });

  it('cuts off a stalled body read with text() too', async () => {
    await expect(
      fetchAndRead(URL_, undefined, 20, (res) => res.text(), stalledBodyFetch()),
    ).rejects.toThrow(/timed out after/);
  });

  it('propagates an error thrown by the reader (e.g. malformed JSON)', async () => {
    const fetchFn = (async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    })) as unknown as typeof fetch;
    await expect(fetchAndRead(URL_, undefined, 1000, (res) => res.json(), fetchFn)).rejects.toThrow(
      'Unexpected token',
    );
  });
});

describe('summarizeErrorBody', () => {
  it('uses error.message from an OData JSON error body', () => {
    const body = JSON.stringify({ error: { code: '400', message: 'Invalid filter: unknown property Foo' } });
    expect(summarizeErrorBody(body)).toBe('Invalid filter: unknown property Foo');
  });

  it('strips HTML tags and collapses whitespace', () => {
    const body = '<html>\n  <body>\n <h1>Service   Unavailable</h1>\n\n<p>Try again later.</p></body></html>';
    expect(summarizeErrorBody(body)).toBe('Service Unavailable Try again later.');
  });

  it('strips XML tags', () => {
    expect(summarizeErrorBody('<?xml version="1.0"?><error><message>Bad request</message></error>')).toBe(
      'Bad request',
    );
  });

  it('drops script and style content, not just the tags', () => {
    const body = '<style>body{color:red}</style><script>alert(1)</script><p>Gateway timeout</p>';
    expect(summarizeErrorBody(body)).toBe('Gateway timeout');
  });

  it('caps the summary at 200 characters', () => {
    const out = summarizeErrorBody('x'.repeat(5000));
    expect(out.length).toBe(200);
    expect(out.endsWith('…')).toBe(true);
  });

  it('caps a long JSON error.message at 200 characters too', () => {
    const out = summarizeErrorBody(JSON.stringify({ error: { message: 'm'.repeat(999) } }));
    expect(out.length).toBe(200);
  });

  it('leaves a short plain-text body as is', () => {
    expect(summarizeErrorBody('Not found')).toBe('Not found');
  });

  it('falls back to the stripped text when JSON has no error.message', () => {
    expect(summarizeErrorBody('{"detail":"nope"}')).toBe('{"detail":"nope"}');
  });

  it('falls back to the stripped text when JSON is malformed', () => {
    expect(summarizeErrorBody('{"error": {"message": ')).toBe('{"error": {"message":');
  });

  it('returns an empty string for an empty or whitespace-only body', () => {
    expect(summarizeErrorBody('')).toBe('');
    expect(summarizeErrorBody('  \n\t ')).toBe('');
  });

  it('never throws on non-string input', () => {
    expect(summarizeErrorBody(undefined as unknown as string)).toBe('');
    expect(summarizeErrorBody(null as unknown as string)).toBe('');
    expect(summarizeErrorBody(42 as unknown as string)).toBe('');
  });

  it('stays fast on a large hostile body', () => {
    const t0 = Date.now();
    summarizeErrorBody('<'.repeat(2_000_000));
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
