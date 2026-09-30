// Time limit for outbound source fetches, plus a readable summary of an
// upstream error body. Used by the CBS adapter (#357): a hung connection must
// fail the attempt (and be retried by the caller), never block forever.

/**
 * Runs `fetchFn(url, init)` and hands the response to `read`, all under ONE
 * deadline of `timeoutMs`. The deadline covers reading the body too: a server
 * that sends headers and then stalls is cut off the same as one that never
 * answers. On timeout this rejects with an Error naming the URL. The abort
 * signal is also passed to `fetchFn`, so a real fetch drops the connection; the
 * race below is what guarantees the cut-off for a fetch that ignores the signal.
 */
export async function fetchAndRead<T>(
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number,
  read: (res: Response) => Promise<T>,
  fetchFn: typeof fetch = fetch,
): Promise<T> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  const timeoutError = () =>
    new Error(`Request timed out after ${timeoutMs / 1000} seconds for ${shortUrl(url)}`);

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(timeoutSignal.aborted ? timeoutError() : signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([
      (async () => read(await fetchFn(url, { ...init, signal })))(),
      aborted,
    ]);
  } catch (err) {
    // A signal-honouring fetch rejects with its own AbortError/TimeoutError;
    // report it as our timeout so the message is the same either way.
    if (timeoutSignal.aborted) throw timeoutError();
    throw err;
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

/** The phrase in the error of a request cut (or refused to start) because the run's time budget was
 * spent (`ODataV4SourceOptions.stopAt`). The message survives into failure summaries, so the warm job
 * recognises a budget cut by this phrase and records the request as not done (remaining), not as a
 * source failure. Nothing else may use it. */
export const BUDGET_ENDED_PHRASE = "the run's time budget ran out";

/** Like `fetch`, but rejects with a timeout error after `timeoutMs`. Covers the
 * headers phase (and, for a real fetch, the body via the attached signal); use
 * `fetchAndRead` when the body read must be bounded regardless of the fetch. */
export function fetchWithTimeout(
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  return fetchAndRead(url, init, timeoutMs, async (res) => res, fetchFn);
}

const URL_MAX_CHARS = 300;

/** A request address for an error message: whole when short, otherwise its start plus how much
 * was cut (a filter can run to thousands of characters, and a message may name it twice). */
export function shortUrl(url: string): string {
  return url.length <= URL_MAX_CHARS ? url : `${url.slice(0, URL_MAX_CHARS)}… (+${url.length - URL_MAX_CHARS} characters)`;
}

const SUMMARY_MAX_CHARS = 200;
// Error pages are small; bounding the input keeps the scans below linear-ish
// even for a huge or hostile body.
const SUMMARY_INPUT_MAX_CHARS = 20_000;

/**
 * One short plain-text line describing an upstream error body: the OData
 * `error.message` when the body is JSON of that shape, otherwise the body with
 * script/style blocks and tags stripped and whitespace collapsed. At most 200
 * characters; never throws (returns '' when nothing readable is there).
 */
export function summarizeErrorBody(body: string): string {
  try {
    if (typeof body !== 'string') return '';
    const bounded = body.slice(0, SUMMARY_INPUT_MAX_CHARS);
    let text = bounded;
    if (bounded.trimStart().startsWith('{')) {
      try {
        const message = (JSON.parse(bounded) as { error?: { message?: unknown } })?.error?.message;
        if (typeof message === 'string' && message.trim() !== '') text = message;
      } catch {
        // not JSON (or truncated): summarise the raw text
      }
    }
    const plain = text
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<[^<>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return plain.length > SUMMARY_MAX_CHARS ? `${plain.slice(0, SUMMARY_MAX_CHARS - 1)}…` : plain;
  } catch {
    return '';
  }
}
