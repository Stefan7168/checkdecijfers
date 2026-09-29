// Server-side data feed for the public gallery (#237/ADR 046). Wraps
// src/chart/curated.ts — the deterministic, LLM-free curated pipeline — with
// the two things a PUBLIC route needs that chat answers don't:
//
//   1. A small in-process TTL cache. '/' and '/galerij' are anonymous-
//      reachable, so an uncached read would put every drive-by request on
//      the database. Charts change only when a sync lands (at most daily),
//      so a short TTL loses nothing: each spec carries its own syncedAt in
//      the R4 line, and what a visitor sees is at worst TTL minutes behind
//      the database — never behind CBS reality by more than we honestly
//      state.
//   2. The fail-safe (#53 posture: the site NEVER breaks on the public
//      surface): any failure — no DATABASE_URL (local dev), pool down, a
//      thrown query — degrades to the last good chart set if one exists,
//      else to an empty list, which renders as "no section"/"no stories".
//      Skipped series are logged server-side, never guessed at (principle c).
//
// #240: this used to also serve the landing's "Ontdek Nederland in
// grafieken" section through a second feed sharing this same
// makeCuratedFeed() factory (ADR 035); that section was replaced by the
// gallery teaser (#237) and the feed removed once nothing mounted it any
// more. The factory stayed generic (parameterised by definition list and
// cache slot) rather than being collapsed into one hardcoded function, since
// a second public curated surface has needed it once already.
import { unstable_cache } from 'next/cache';
import { buildCuratedCharts, GALLERY_STORIES } from '../backend/chart/index.ts';
import type { CuratedChart, CuratedChartsOutcome } from '../backend/chart/index.ts';
import { getDb } from './db.ts';
import { ANONYMOUS_READ_DEADLINE_MS, withDeadline } from './deadline.ts';

const TTL_MS = 30 * 60 * 1000;
const TTL_S = TTL_MS / 1000;

// #347 (WP-LOOK part c, session 144): the in-process cache above is cold on
// EVERY new serverless instance, and a cold build of the twelve stories runs
// ~30 queries through a two-client pool (src/db/client.ts) — measured 5.6 s
// on production on 2026-09-29, past the 5 s anonymous deadline, so the
// first visitor on a fresh instance saw the loading placeholder. This second
// layer stores the built outcome in Next's Data Cache (Vercel's shared,
// cross-instance store; the file-system cache under `.next/cache` locally)
// for the same 30 minutes, stale-while-revalidate: a fresh instance fetches
// the last built set in tens of milliseconds instead of rebuilding it, and
// an expired entry is served once more while the rebuild runs behind it.
// The page stays `force-dynamic` (the language cookie); only this read is
// cached. The outcome is plain JSON (specs, slugs, reasons) — the store
// requires that. Outside a Next runtime (vitest, the CLI) `NEXT_RUNTIME` is
// unset and `unstable_cache` would throw for want of an incremental cache,
// so the build runs uncached there — the mechanism tests below pin the
// in-process layer, which is unchanged.
// An outcome with ZERO charts is never persisted (code-review finding,
// session 144): buildCuratedCharts does not throw on a saturated pooler, it
// resolves with every story in `skipped` — and a cached empty set would have
// emptied the gallery on every instance for the full 30 minutes, where the
// in-process cache only ever poisoned the one instance. The wrapper throws
// instead (the store keeps nothing on a throw) and rebuild() unwraps the
// outcome so the skip reasons are still logged exactly as before.
type Build = () => Promise<CuratedChartsOutcome>;
class EmptyOutcome extends Error {
  constructor(readonly outcome: CuratedChartsOutcome) {
    super('curated feed built zero charts — not persisting');
  }
}
function persisted(label: string, build: Build): Build {
  if (!process.env.NEXT_RUNTIME) return build;
  const guarded = async (): Promise<CuratedChartsOutcome> => {
    const outcome = await build();
    if (outcome.charts.length === 0) throw new EmptyOutcome(outcome);
    return outcome;
  };
  const cached = unstable_cache(guarded, ['curated-feed', label], {
    revalidate: TTL_S,
    tags: [`curated-feed:${label}`],
  });
  return () => cached().catch((err: unknown) => (err instanceof EmptyOutcome ? err.outcome : Promise.reject(err)));
}

interface CuratedFeed {
  get: () => Promise<CuratedChart[]>;
  reset: () => void;
}

function makeCuratedFeed(label: string, definitions: () => Parameters<typeof buildCuratedCharts>[1]): CuratedFeed {
  let cache: { at: number; charts: CuratedChart[] } | null = null;
  // In-flight coalescing (adversarial-review finding, session 52): without it,
  // every request arriving during a cold start or just after TTL expiry would
  // trigger its OWN build — the exact per-drive-by DB load the cache exists to
  // prevent — and concurrent builds would race last-writer-wins into `cache`.
  // One build per instance at a time; everyone else awaits the same promise.
  let inflight: Promise<CuratedChart[]> | null = null;
  // `getDb()` is evaluated INSIDE the persisted build so a cached outcome
  // never needs a database at all; its synchronous throw (no DATABASE_URL)
  // surfaces as this promise's rejection, which the catch below degrades.
  const build = persisted(label, () => buildCuratedCharts(getDb(), definitions()));

  async function rebuild(): Promise<CuratedChart[]> {
    try {
      // toggleSkipped defaults to [] defensively: the real buildCuratedCharts
      // always sets it, but this keeps the destructure safe against any test
      // double that only supplies { charts, skipped }.
      const { charts, skipped, toggleSkipped = [] } = await build();
      for (const skip of skipped) {
        console.warn(`[${label}] chart '${skip.slug}' skipped: ${skip.reason}`);
      }
      // #170(4): a chart still SERVES here (it is in `charts`); only its
      // optional definition toggle degraded — logged the same way a whole-
      // chart skip is, never silently dropped.
      for (const skip of toggleSkipped) {
        console.warn(`[${label}] chart '${skip.slug}' toggle skipped: ${skip.reason}`);
      }
      cache = { at: Date.now(), charts };
      return charts;
    } catch (err) {
      console.warn(`[${label}] charts unavailable, serving previous set if any:`, err);
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

  function get(): Promise<CuratedChart[]> {
    if (cache !== null && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.charts);
    if (inflight === null) {
      const build = rebuild();
      inflight = build;
      // Cleared HERE, not inside rebuild()'s own `finally` — see the trap
      // trial.ts's readPotCached already documents, found in this module by
      // a review of the combined session diff. `buildCuratedCharts(getDb())`
      // evaluates `getDb()` as a plain argument before any await, and
      // getDb() throws SYNCHRONOUSLY when DATABASE_URL is missing or the CA
      // cert will not load — the exact "no DATABASE_URL (local dev)" case
      // this module's header names as a degrade it handles. rebuild() then
      // ran to completion synchronously, its in-body finally set
      // inflight = null BEFORE `inflight ??= rebuild()` assigned it, and the
      // assignment latched a settled promise forever: cache was never
      // populated, so the TTL check never short-circuited, and no further
      // build was ever attempted for the life of that warm instance. A
      // `.finally()` attached from out here is always deferred to a
      // microtask, so it cannot run before the assignment; the identity
      // check stops a slow build clearing a newer one.
      void build.finally(() => {
        if (inflight === build) inflight = null;
      });
    }
    // #190(b): rebuild() degrades on a THROWN error but not on a WAIT — under
    // pool saturation it simply blocks, and the page blocks with it. The
    // fallback is the same stale-over-nothing this module already chose: the
    // last good set if there is one, else an empty list. A bounded-out build
    // keeps running and populates the cache for a later request.
    return withDeadline(inflight, cache?.charts ?? [], label, ANONYMOUS_READ_DEADLINE_MS);
  }

  function reset(): void {
    cache = null;
    inflight = null;
  }

  return { get, reset };
}

const galleryFeed = makeCuratedFeed('galerij', () => GALLERY_STORIES);

/** #237/ADR 046: the public gallery's story set, over GALLERY_STORIES. */
export function getGalleryStories(): Promise<CuratedChart[]> {
  return galleryFeed.get();
}

/** Test seam: reset the module-scope cache between cases. */
export function resetOntdekCache(): void {
  galleryFeed.reset();
}
