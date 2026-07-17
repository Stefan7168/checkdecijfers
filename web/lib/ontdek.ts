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
  } finally {
    inflight = null;
  }
}

export function getOntdekCharts(): Promise<CuratedChart[]> {
  if (cache !== null && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.charts);
  inflight ??= rebuild();
  return inflight;
}
