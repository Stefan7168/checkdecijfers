// Two-measure scatter (spec docs/superpowers/specs/2026-09-27-two-measure-scatter-design.md,
// open-questions #296): the paired query. A pair intent is TWO ordinary
// region-set queries — the asked-about measure (y, vertical axis) and the added
// measure (x, horizontal axis) — over the same region class and period, joined
// on region code by the pure pairRegions below. Each leg stays a normal
// single-lineage ValidatedResult, so every per-result rule (R1, R9, R10, R11,
// attribution) applies to each unchanged (spec D3). The join is recomputed from
// the two stored results wherever it is needed (compose, chart, audit) and is
// never stored itself (spec D4).
import type { Db } from '../db/types.ts';
import { runQuery } from './run.ts';
import type { QueryOptions } from './resolve.ts';
import type { QueryRefusal, ResultCell, StructuredIntent, ValidatedResult } from './types.ts';

/** Fewer paired regions than this is not a scatter worth drawing; refused `no_data`. */
export const SCATTER_MIN_PAIRS = 3;

/** Null when `intent` is a supported pair intent, else the owner-readable reason. */
export function pairIntentProblem(intent: StructuredIntent): string | null {
  const pair = intent.pairWith;
  if (pair === undefined) return 'the intent has no pairWith';
  if (intent.regionSet === undefined) return 'a paired intent needs a region class (regionSet)';
  if ((intent.regions ?? []).length > 0) return 'a paired intent cannot also name explicit regions';
  if (intent.period.kind !== 'codes' || intent.period.codes.length !== 1) {
    return 'a paired intent needs exactly one period code';
  }
  if (intent.derivation !== 'none') return `a paired intent needs derivation "none", got "${intent.derivation}"`;
  if (intent.target.kind !== 'canonical' || pair.kind !== 'canonical') {
    return 'a paired intent needs two canonical measures';
  }
  if (intent.target.key === pair.key) return 'a paired intent names the same measure twice';
  return null;
}

/** The two single-measure legs: y = the asked-about `target`, x = `pairWith`. */
export function legIntents(intent: StructuredIntent): { y: StructuredIntent; x: StructuredIntent } {
  const { pairWith, ...y } = intent;
  if (pairWith === undefined) throw new Error('legIntents: the intent has no pairWith');
  return { y, x: { ...y, target: pairWith } };
}

export type SideState = 'value' | 'withheld' | 'not_applicable' | 'missing';

export interface PairSide {
  state: SideState;
  /** The leg's cell for this region: set for 'value' and 'withheld', null otherwise. */
  cell: ResultCell | null;
}

export interface RegionPair {
  regionCode: string;
  regionLabel: string;
  y: ResultCell;
  x: ResultCell;
}

export interface LeftOutRegion {
  regionCode: string;
  /** From whichever leg has a cell; null when neither has one (missing on both). */
  regionLabel: string | null;
  y: PairSide;
  x: PairSide;
}

export interface RegionPairing {
  /** Regions with a value on both legs, in the y leg's cell order. */
  pairs: RegionPair[];
  /** Every other region of either leg that has a value or a withheld cell on at
   * least one side, or is missing — disclosed with each side's state (R11). */
  leftOut: LeftOutRegion[];
  /** Not a member of the class at this period per CBS (`Impossible`) on at
   * least one leg, with no value and no withheld cell on the other. */
  notApplicable: string[];
  /** True exactly when nothing is left out. */
  complete: boolean;
}

function sideOf(leg: ValidatedResult, regionCode: string): PairSide {
  const cell = leg.cells.find((c) => c.regionCode === regionCode) ?? null;
  if (cell !== null) return { state: cell.value !== null ? 'value' : 'withheld', cell };
  if ((leg.regionSet?.notApplicable ?? []).includes(regionCode)) return { state: 'not_applicable', cell: null };
  return { state: 'missing', cell: null };
}

/** Join two region-set results on region code. Pure; deterministic order. */
export function pairRegions(y: ValidatedResult, x: ValidatedResult): RegionPairing {
  const codes: string[] = [];
  const add = (code: string | null): void => {
    if (code !== null && !codes.includes(code)) codes.push(code);
  };
  for (const leg of [y, x]) for (const c of leg.cells) add(c.regionCode);
  for (const leg of [y, x]) {
    const cov = leg.regionSet;
    for (const code of [...(cov?.withheld ?? []), ...(cov?.missing ?? []), ...(cov?.notApplicable ?? [])]) add(code);
  }

  const pairs: RegionPair[] = [];
  const leftOut: LeftOutRegion[] = [];
  const notApplicable: string[] = [];
  for (const code of codes) {
    const ys = sideOf(y, code);
    const xs = sideOf(x, code);
    if (ys.state === 'value' && xs.state === 'value') {
      pairs.push({ regionCode: code, regionLabel: ys.cell!.regionLabel ?? xs.cell!.regionLabel ?? code, y: ys.cell!, x: xs.cell! });
      continue;
    }
    const anyCell = ys.cell !== null || xs.cell !== null;
    if (!anyCell && (ys.state === 'not_applicable' || xs.state === 'not_applicable')) {
      notApplicable.push(code);
      continue;
    }
    leftOut.push({ regionCode: code, regionLabel: ys.cell?.regionLabel ?? xs.cell?.regionLabel ?? null, y: ys, x: xs });
  }
  return { pairs, leftOut, notApplicable, complete: leftOut.length === 0 };
}

export interface PairedResults {
  ok: true;
  /** The FULL pair intent that was asked (with `pairWith`) — NOT `result.intent`,
   * which is only the y leg's own one-measure intent (legIntents strips
   * `pairWith` off before either leg runs). A later audit writer must record
   * this field so the audited question reads as the two-measure scatter that
   * was actually asked, not as a single-measure query. */
  intent: StructuredIntent;
  /** The asked-about measure (vertical axis). */
  result: ValidatedResult;
  /** The added measure (horizontal axis). */
  pairedResult: ValidatedResult;
  pairing: RegionPairing;
}

export type PairOutcome = PairedResults | QueryRefusal;

function refusePair(intent: StructuredIntent, kind: QueryRefusal['refusal']['kind'], message: string): QueryRefusal {
  return { ok: false, refusal: { kind, message }, intent };
}

/** Run a paired intent: both legs through the ordinary runQuery, then the join.
 * A refused leg refuses the pair (with the leg's own refusal, re-pinned to the
 * full pair intent); too few pairs refuses `no_data` — never a partial scatter
 * of one measure. */
export async function runPairQuery(db: Db, intent: StructuredIntent, options: QueryOptions = {}): Promise<PairOutcome> {
  const problem = pairIntentProblem(intent);
  if (problem !== null) return refusePair(intent, 'invalid_intent', problem);
  const legs = legIntents(intent);

  const y = await runQuery(db, legs.y, options);
  if (!y.ok) return { ...y, intent };
  const x = await runQuery(db, legs.x, options);
  if (!x.ok) return { ...x, intent };

  if (y.shape !== 'region_set' || x.shape !== 'region_set') {
    return refusePair(intent, 'internal_inconsistency', `a paired leg did not answer as a region set (y=${y.shape}, x=${x.shape})`);
  }
  const period = intent.period.kind === 'codes' ? intent.period.codes[0] : null;
  const offPeriod = [...y.cells, ...x.cells].find((c) => c.periodCode !== period);
  if (offPeriod !== undefined) {
    return refusePair(intent, 'internal_inconsistency', `a paired leg returned period ${offPeriod.periodCode}, expected ${period}`);
  }

  const pairing = pairRegions(y, x);
  if (pairing.pairs.length < SCATTER_MIN_PAIRS) {
    return refusePair(intent, 'no_data', `only ${pairing.pairs.length} region(s) carry both measures; a scatter needs ${SCATTER_MIN_PAIRS}`);
  }
  return { ok: true, intent, result: y, pairedResult: x, pairing };
}
