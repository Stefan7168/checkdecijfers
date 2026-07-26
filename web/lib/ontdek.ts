// Server-side data feed for the "Ontdek Nederland in grafieken" landing
// section (ADR 035). Wraps src/chart/curated.ts — the deterministic, LLM-free
// curated set — with the two things the PUBLIC route needs that chat answers
// don't:
//
//   1. A small in-process TTL cache. '/' is the one anonymous-reachable page,
//      so an uncached read would put every drive-by request on the database.
//      Charts change only when a sync lands (at most daily), so a short TTL
//      loses nothing: each spec carries its own syncedAt in the R4 line, and
//      what a visitor sees is at worst TTL minutes behind the database —
//      never behind CBS reality by more than we honestly state.
//   2. The fail-safe (#53 posture: the site NEVER breaks on the public
//      surface): any failure — no DATABASE_URL (local dev), pool down, a
//      thrown query — degrades to the last good chart set if one exists,
//      else to an empty list, which renders as "no section". Skipped series
//      are logged server-side, never guessed at (principle c).
import { buildCuratedCharts } from '../backend/chart/index.ts';
import type { CuratedChart } from '../backend/chart/index.ts';
import { getDb } from './db.ts';
import { ANONYMOUS_READ_DEADLINE_MS, withDeadline } from './deadline.ts';

const TTL_MS = 30 * 60 * 1000;

let cache: { at: number; charts: CuratedChart[] } | null = null;
// In-flight coalescing (adversarial-review finding, session 52): without it,
// every request arriving during a cold start or just after TTL expiry would
// trigger its OWN build — the exact per-drive-by DB load the cache exists to
// prevent — and concurrent builds would race last-writer-wins into `cache`.
// One build per instance at a time; everyone else awaits the same promise.
let inflight: Promise<CuratedChart[]> | null = null;

/** Test seam: reset the module-scope cache between cases. */
export function resetOntdekCache(): void {
  cache = null;
  inflight = null;
}

async function rebuild(): Promise<CuratedChart[]> {
  try {
    const { charts, skipped } = await buildCuratedCharts(getDb());
    for (const skip of skipped) {
      console.warn(`[ontdek] chart '${skip.slug}' skipped: ${skip.reason}`);
    }
    cache = { at: Date.now(), charts };
    return charts;
  } catch (err) {
    console.warn('[ontdek] charts unavailable, serving previous set if any:', err);
    // Stale-over-nothing: an expired cache still beats an empty section
    // while the database hiccups. Cache untouched so the next request
    // retries immediately.
    return cache?.charts ?? [];
  }
  // NB: `inflight` is deliberately NOT cleared here. An in-body `finally` runs
  // synchronously when this function settles without ever suspending — which
  // `getDb()` throwing does — and that happens BEFORE the caller's assignment,
  // latching the settled promise forever. Cleared by the caller instead.
}

export function getOntdekCharts(): Promise<CuratedChart[]> {
  if (cache !== null && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.charts);
  if (inflight === null) {
    const build = rebuild();
    inflight = build;
    // Cleared HERE, not inside rebuild()'s own `finally` — the trap trial.ts's
    // readPotCached already documents, found in THIS file by a review of the
    // combined session diff. `buildCuratedCharts(getDb())` evaluates `getDb()`
    // as a plain argument before any await, and getDb() throws SYNCHRONOUSLY
    // when DATABASE_URL is missing or the CA cert will not load — the exact
    // "no DATABASE_URL (local dev)" case this module's header names as a
    // degrade it handles. rebuild() then ran to completion synchronously, its
    // in-body finally set inflight = null BEFORE `inflight ??= rebuild()`
    // assigned it, and the assignment latched a settled promise forever: cache
    // was never populated, so the TTL check never short-circuited, and no
    // further build was ever attempted for the life of that warm instance. The
    // Ontdek section stayed empty for every later visitor even after the
    // config was fixed. A `.finally()` attached from out here is always
    // deferred to a microtask, so it cannot run before the assignment; the
    // identity check stops a slow build clearing a newer one.
    void build.finally(() => {
      if (inflight === build) inflight = null;
    });
  }
  // #190(b): rebuild() degrades on a THROWN error but not on a WAIT — under pool
  // saturation it simply blocks, and the landing blocks with it. The fallback is
  // the same stale-over-nothing this module already chose: the last good set if
  // there is one, else an empty list, which renders as no section. A bounded-out
  // build keeps running and populates the cache for a later request.
  return withDeadline(inflight, cache?.charts ?? [], 'ontdek', ANONYMOUS_READ_DEADLINE_MS);
}
