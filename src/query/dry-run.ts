// #56 servability dry-run (WP15, ADR 021): "would confirming this suggestion
// actually produce an answer?" — answered by running the REAL query and
// discarding everything but the verdict. A parallel approximation (resolve
// without executing) would drift from the one check that matters, the
// completeness pass in run.ts; V22/V23 measured exactly that gap live.
//
// CONFINEMENT (principle c / R1): the return type carries NO cells and NO
// values by construction. The clarification builders that consume this can
// therefore never see a data value through it — the same structural
// no-numbers guarantee ADR 015 gives the refusal templates. Period CODES and
// years are not data values (the #37 policy already lets refusals name them).
import type { Db } from '../db/types.ts';
import { freshestForCanonical, runQuery } from './run.ts';
import type { RefusalKind, StructuredIntent } from './types.ts';

/** What we CAN honestly say is loaded for the suggestion's measure — names
 * and period bounds only, never a value. Null fields mean "nothing honest to
 * offer on this axis"; the fallback template then degrades gracefully. */
export interface EchoAvailability {
  /** Gap-free loaded year window at the canonical coordinate (the
   * openEndedRangeOptions discipline: min/max alone can hide interior gaps —
   * never name a window we could not actually serve end-to-end). Null when no
   * yearly series exists or the window has holes. */
  yearRange: { fromYear: number; toYear: number } | null;
  /** Freshest period at the canonical coordinate, any grain, with its CBS
   * status (R11 applies to offers too). */
  freshest: { periodCode: string; status: string } | null;
}

export type EchoServability =
  | { servable: true }
  | {
      servable: false;
      kind: RefusalKind;
      /** Unresolved axes when the refusal is a needs_clarification — the
       * fallback question must cover them all at once (docs/05). */
      axes: ('measure' | 'region' | 'period' | 'derivation')[] | null;
      availability: EchoAvailability;
    };

/** Gap-free loaded year window for a canonical measure at its pinned
 * coordinate — the same mergedDims + interior-gap rules resolve.ts's
 * openEndedRangeOptions applies (WP14), reimplemented here against the
 * canonical key because a failed dry-run has no ResolvedQuery to borrow. */
async function loadedYearRange(
  db: Db,
  canonicalKey: string,
): Promise<{ fromYear: number; toYear: number } | null> {
  const cm = await db.query(
    `select c.table_id, c.measure, c.dims, t.default_coordinates
     from canonical_measures c join cbs_tables t on t.id = c.table_id
     where c.key = $1`,
    [canonicalKey],
  );
  const row = cm.rows[0];
  if (!row) return null;
  const parseJson = (v: unknown): Record<string, string> =>
    v == null ? {} : ((typeof v === 'string' ? JSON.parse(v) : v) as Record<string, string>);
  const mergedDims = { ...parseJson(row.default_coordinates), ...parseJson(row.dims) };
  const params = [row.table_id, row.measure, JSON.stringify(mergedDims)];

  const bounds = await db.query(
    `select min(period_code) as earliest, max(period_code) as latest, count(distinct period_code) as n
     from observations
     where table_id = $1 and measure = $2 and period_grain = 'JJ' and dims = $3::jsonb`,
    params,
  );
  const parseYear = (value: unknown): number | null =>
    typeof value === 'string' && /^\d{4}JJ00$/.test(value) ? Number(value.slice(0, 4)) : null;
  const fromYear = parseYear(bounds.rows[0]?.earliest);
  const toYear = parseYear(bounds.rows[0]?.latest);
  if (fromYear === null || toYear === null) return null;
  // Interior-gap check: a named window must be fully servable (WP14 lesson).
  if (Number(bounds.rows[0]?.n) !== toYear - fromYear + 1) return null;
  return { fromYear, toYear };
}

/** Dry-runs an already-resolved intent through the real query layer. The
 * ValidatedResult of a servable intent is discarded HERE — values never cross
 * this function's return boundary. */
export async function echoServability(
  db: Db,
  intent: StructuredIntent,
): Promise<EchoServability> {
  const outcome = await runQuery(db, intent);
  if (outcome.ok) return { servable: true };

  // Availability lookups are canonical-key based: every parser-produced
  // intent is a canonical target (resolveCandidate builds no other kind).
  const canonicalKey = intent.target.kind === 'canonical' ? intent.target.key : null;
  // The refusal's own freshness payload is grain-pinned and can be empty
  // (e.g. a no_data at a grain the canonical coordinate never publishes —
  // unemployment has no yearly cells); the grain-agnostic canonical freshest
  // is then the honest thing to name instead.
  const freshest =
    outcome.refusal.freshness?.freshestAvailable ??
    (canonicalKey === null ? null : await freshestForCanonical(db, canonicalKey));
  const availability: EchoAvailability = {
    yearRange: canonicalKey === null ? null : await loadedYearRange(db, canonicalKey),
    freshest,
  };
  return {
    servable: false,
    kind: outcome.refusal.kind,
    axes: outcome.refusal.axes ?? (outcome.refusal.axis ? [outcome.refusal.axis] : null),
    availability,
  };
}
