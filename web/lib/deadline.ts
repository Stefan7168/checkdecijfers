// A bounded wait for the ANONYMOUS read paths (#190(b)).
//
// The problem this closes. `src/db/client.ts` deliberately leaves node-pg's
// `connectionTimeoutMillis` unset, so a request waits INDEFINITELY for a free
// pool client. That is the right call on the money path — a bounded wait turns
// pool contention into a thrown error, and one place that error could land is
// between a committed credit debit and its compensating refund (#173). But it
// means the two anonymous entry points on `/` (the trial gate and the Ontdek
// chart build) do not degrade under pool saturation: they WAIT. Both have a
// carefully-designed honest fallback — the login nudge, the omitted section —
// and neither can reach it, because the fail-safe engages on errors and never
// on waits. The visitor gets a page that never finishes, up to the route's 90 s
// `maxDuration`.
//
// ⚠ WHAT THIS DOES NOT DO, stated plainly so nobody reads more into it. A race
// does not CANCEL the query. The pooled client stays checked out until the
// underlying work finishes, so this frees the visitor, not the pooler session —
// it converts a hang into the existing honest degrade, and does nothing for
// #173's connection arithmetic. The session-level fix is transaction-mode
// pooling (#173(b)), which is a supervised change.
//
// Deliberately NOT applied to the paid path or to `takeTrialQuestion`: those are
// exactly the money-path semantics the unset timeout protects.

/** The bound, measured rather than guessed (2026-07-26, `pg_stat_statements`
 * over production since 2026-07-02): every query on the landing path has a
 * worst-observed EXECUTION time under ~17 ms — the pot read's max is 3.28 ms
 * over 151 calls, the Ontdek label/measure reads peak at 16.4 ms. A cold pooler
 * connect adds a few hundred ms of TLS on top. 5 s is therefore ~300x the worst
 * healthy case, and still 18x below the route's 90 s `maxDuration`, which is the
 * ceiling this exists to stay well clear of. Wide enough that a merely SLOW
 * database still serves the real thing; narrow enough that a saturated one
 * degrades while the visitor is still watching. */
export const ANONYMOUS_READ_DEADLINE_MS = 5_000;

/**
 * Resolve `work`, or `fallback` if it has not settled within `ms`.
 *
 * Never rejects on the timeout path and never swallows a real rejection: the
 * race attaches its own handler to `work`, so a rejection arriving AFTER the
 * deadline is already handled and cannot surface as an unhandled rejection —
 * while a rejection arriving BEFORE it still propagates to the caller, whose
 * existing catch is the honest degrade.
 *
 * The timer is always cleared, including on the fast path: an outstanding
 * `setTimeout` keeps the event loop alive, which on a serverless instance is a
 * few seconds of billed wall clock per request for nothing.
 */
export async function withDeadline<T>(
  work: Promise<T>,
  fallback: T,
  label: string,
  ms: number = ANONYMOUS_READ_DEADLINE_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      // Loud, because the whole point of #190(b) is that this state used to be
      // indistinguishable from "the page is just slow".
      console.warn(`[${label}] read exceeded ${String(ms)}ms — degrading instead of waiting (#190)`);
      resolve(fallback);
    }, ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
