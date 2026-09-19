// Registered derivation functions — the ONLY place derived values may be
// computed (invariant R5, docs/05-data-rules.md). Each function validates its
// inputs and either returns a DerivationRecord (kind, source result ids, CC BY
// marking) or refuses with a reason; nothing here ever guesses past a null
// value or a unit mismatch (principle c).
//
// Two ways in:
// - explicit: the intent asked for `difference` (B13) or `max` (B14) — the
//   record's value is the answer's headline number, rendered with the
//   derived-data marking.
// - pre-registered: every multi-period result gets `direction` + `first_last`,
//   every multi-region comparison gets a non-explicit `max`, so honest trend /
//   ranking / comparison sentences have a registered derivation to bind to
//   (R9) — added automatically by run.ts, never on demand by the LLM.
import { DERIVED_DATA_MARKING, type DerivationRecord, type RegionSetCoverage, type ResultCell } from './types.ts';
import { contiguousPeriodCodes } from './resolve.ts';

export type DerivationResult =
  | { ok: true; record: DerivationRecord }
  | { ok: false; reason: string };

// Narrowly typed to the shared failure shape (not the full DerivationResult
// union) so it is reusable as-is by derivePeriodChangeSeries's own
// differently-shaped PeriodChangeSeriesResult below, rather than needing a
// second one-line "refuse" helper that would do exactly the same thing.
function refuse(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

/** Shared preconditions: values present (a null-with-reason cell cannot be
 * computed over) and exactly one unit across the sources (R10). */
function checkComputable(cells: ResultCell[]): string | null {
  const nullCell = cells.find((c) => c.value === null);
  if (nullCell) {
    return `source cell ${nullCell.resultId} has no value (CBS reason: ${nullCell.valueAttribute}) — cannot compute over it`;
  }
  const units = new Set(cells.map((c) => c.unit));
  if (units.size > 1) {
    return `source cells mix units (${[...units].join(', ')}) — refusing to combine them`;
  }
  return null;
}

/** #203: a "first cell vs last cell" derivation (direction, first_last) is
 * only meaningful when every cell tracks the SAME place over time — mixing
 * regions turns "first vs last" into an arbitrary cross-region diff, not a
 * trend. No caller passes a multi-region cells array here: ADR 055's
 * `region_series` shape is the one query shape whose cells span several
 * regions at several periods, and run.ts calls these functions once per
 * region over that region's OWN slice precisely because this guard makes a
 * single-region slice the only legal input (MS1 is mechanised by slicing, not
 * by a new function). This guard means that stays true even if a future
 * caller's own discipline doesn't, rather than relying on every future call
 * site to remember. */
function checkSingleRegion(cells: ResultCell[]): string | null {
  const regions = new Set(cells.map((c) => c.regionCode));
  if (regions.size > 1) {
    return `source cells span ${regions.size} different regions — a first-vs-last comparison across regions is not a trend`;
  }
  return null;
}

/** B13-style growth: later period minus earlier period, one coordinate.
 * Requires exactly two cells at the same region/dims, different periods;
 * cells arrive period-ordered from run.ts. */
export function deriveDifference(cells: Pick<ResultCell, 'resultId' | 'periodCode' | 'regionCode' | 'unit' | 'value'>[]): DerivationResult {
  if (cells.length !== 2) {
    return refuse(`difference needs exactly 2 source cells, got ${cells.length}`);
  }
  const [earlier, later] = cells as [Pick<ResultCell, 'resultId' | 'periodCode' | 'regionCode' | 'unit' | 'value'>, Pick<ResultCell, 'resultId' | 'periodCode' | 'regionCode' | 'unit' | 'value'>];
  if (earlier.periodCode === later.periodCode) {
    return refuse('difference needs two distinct periods');
  }
  if (earlier.regionCode !== later.regionCode) {
    return refuse('difference compares periods at one place — regions differ');
  }
  const problem = checkComputable(cells as ResultCell[]);
  if (problem) return refuse(problem);
  return {
    ok: true,
    record: {
      kind: 'difference',
      explicit: true,
      sourceResultIds: [earlier.resultId, later.resultId],
      unit: later.unit,
      marking: DERIVED_DATA_MARKING,
      value: (later.value as number) - (earlier.value as number),
      minuendResultId: later.resultId,
      subtrahendResultId: earlier.resultId,
    },
  };
}

/** Arithmetic mean over ≥2 cells at one place (region), any number of
 * periods. Reuses the same refusal discipline as every other derivation:
 * a null cell or a unit mismatch refuses the whole calculation rather than
 * silently skipping a value (principle c). */
export function deriveMean(cells: Pick<ResultCell, 'resultId' | 'periodCode' | 'regionCode' | 'unit' | 'value'>[]): DerivationResult {
  if (cells.length < 2) {
    return refuse(`mean needs at least 2 source cells, got ${cells.length}`);
  }
  const problem = checkComputable(cells as ResultCell[]) ?? checkSingleRegion(cells as ResultCell[]);
  if (problem) return refuse(problem);
  const sum = cells.reduce((acc, c) => acc + (c.value as number), 0);
  return {
    ok: true,
    record: {
      kind: 'mean',
      explicit: true,
      sourceResultIds: cells.map((c) => c.resultId),
      unit: cells[0]!.unit,
      marking: DERIVED_DATA_MARKING,
      value: sum / cells.length,
    },
  };
}

/** B14-style ranking: the largest value across ≥2 cells at one period.
 * Ties refuse rather than pick a winner arbitrarily. */
export function deriveMax(cells: ResultCell[], explicit: boolean): DerivationResult {
  if (cells.length < 2) {
    return refuse(`max needs at least 2 source cells, got ${cells.length}`);
  }
  const periods = new Set(cells.map((c) => c.periodCode));
  if (periods.size > 1) {
    return refuse(`max compares cells at one period — got ${[...periods].join(', ')}`);
  }
  const problem = checkComputable(cells);
  if (problem) return refuse(problem);
  const ranked = [...cells].sort((a, b) => (b.value as number) - (a.value as number));
  const [winner, runnerUp] = ranked as [ResultCell, ResultCell];
  if (winner.value === runnerUp.value) {
    return refuse(
      `no single maximum: ${winner.resultId} and ${runnerUp.resultId} share the top value`,
    );
  }
  return {
    ok: true,
    record: {
      kind: 'max',
      explicit,
      sourceResultIds: cells.map((c) => c.resultId),
      unit: winner.unit,
      marking: DERIVED_DATA_MARKING,
      value: winner.value as number,
      winnerResultId: winner.resultId,
      rankingResultIds: ranked.map((c) => c.resultId),
    },
  };
}

/** #253 / **RS1** — the ranking over a region CLASS ("welke gemeente had de
 * hoogste …"), and the mechanism that makes the honesty rule enforceable
 * rather than editorial.
 *
 * RS1: a region-set answer may use ranking or superlative language only when
 * the set is COMPLETE for the class — zero withheld members, zero missing
 * ones. Members CBS itself marks `Impossible` do not break completeness: CBS
 * is stating they are not members at that coordinate, not hiding a number.
 *
 * The rule is enforced by the ABSENCE of a derivation record, never by
 * filtering superlatives out of prose: with an incomplete set this function
 * returns `{ ok: false }`, so no `max`-family DerivationRecord exists, and
 * R9's post-generation check already fails closed on a ranking word with no
 * registered derivation behind it. That is strictly stronger than a caveat
 * sentence — a withheld value could BE the maximum, so "de hoogste" would be a
 * claim the data cannot support (principle (c)).
 *
 * Reuses deriveMax's existing `max` record (no new DerivationRecord kind, no
 * IntentDerivation change — ADR 052's reasoning, applied again), including its
 * refusal on a tie and its null-source guard. */
export function deriveRegionRanking(
  cells: ResultCell[],
  coverage: RegionSetCoverage,
  /** True only when the intent literally asked for the ranking ("welke … de
   * hoogste"); false for the automatic pre-registration that exists so honest
   * ranking prose has something to bind to, exactly like the comparison max. */
  explicit = false,
): DerivationResult {
  if (!coverage.complete) {
    const gaps = [
      coverage.withheld.length > 0 ? `${coverage.withheld.length} withheld (${coverage.withheld.join(', ')})` : null,
      coverage.missing.length > 0 ? `${coverage.missing.length} missing (${coverage.missing.join(', ')})` : null,
    ].filter((part): part is string => part !== null);
    return refuse(
      `the region class "${coverage.scope.kind}" is not complete — ${gaps.join(' and ')} of ${coverage.rosterSize} member(s); a ranking over an incomplete set would be a claim the data cannot support`,
    );
  }
  return deriveMax(cells, explicit);
}

/** Pre-registered on every series (R9): net direction over the period-ordered
 * cells, plus whether the movement was monotonic — so "gestegen" can be
 * checked, and a rose-then-fell series cannot be phrased as a straight rise. */
export function deriveDirection(cells: ResultCell[]): DerivationResult {
  if (cells.length < 2) {
    return refuse(`direction needs at least 2 source cells, got ${cells.length}`);
  }
  const problem = checkComputable(cells) ?? checkSingleRegion(cells);
  if (problem) return refuse(problem);
  const first = cells[0] as ResultCell;
  const last = cells[cells.length - 1] as ResultCell;
  const netChange = (last.value as number) - (first.value as number);
  let rises = false;
  let falls = false;
  for (let i = 1; i < cells.length; i++) {
    const step = (cells[i]!.value as number) - (cells[i - 1]!.value as number);
    if (step > 0) rises = true;
    if (step < 0) falls = true;
  }
  return {
    ok: true,
    record: {
      kind: 'direction',
      explicit: false,
      sourceResultIds: cells.map((c) => c.resultId),
      unit: first.unit,
      marking: DERIVED_DATA_MARKING,
      direction: netChange > 0 ? 'up' : netChange < 0 ? 'down' : 'flat',
      monotonic: !(rises && falls),
      netChange,
      firstResultId: first.resultId,
      lastResultId: last.resultId,
    },
  };
}

/** A PURE numeric factor unit ('x 1 000', 'x 1000', '× 1.000'): an optional
 * x/× prefix, then one digit group with space/dot thousands-grouping, and
 * NOTHING else. Units containing any other character are structurally
 * excluded — '1 000 euro' (a factor with a currency word) is out of v1 scope,
 * and rate units ('aantal per 1 000 inwoners') can never match (ADR 031 D1).
 * Returns the factor as a positive safe integer, or null when the unit is not
 * a pure factor. */
export function parseFactorUnit(unit: string): number | null {
  const trimmed = unit.trim();
  const match = /^[x×]?[\s ]*(\d{1,3}(?:[\s .]\d{3})*|\d+)$/.exec(trimmed);
  if (!match) return null;
  const factor = Number.parseInt(match[1]!.replace(/[\s .]/g, ''), 10);
  if (!Number.isSafeInteger(factor) || factor < 10) return null;
  return factor;
}

/** #125a (ADR 031): the exact expanded figure for a pure-factor-unit cell —
 * "390,2 x 1000" also states "= 390.200". EXACT arithmetic only: IEEE-754
 * float multiplication is not always exact (16.1 * 1000 =
 * 16100.000000000002; 96 of the 9,999 one-decimal values below 1000 multiply
 * inexactly by 1000), so the value is scaled to an integer via its declared
 * decimals first. Only
 * integer-valued expansions are registered in v1; anything the guards cannot
 * prove exact refuses, and the answer simply renders as today (fail-open —
 * a missing nicety, never a wrong number). */
export function deriveUnitExpansion(cell: ResultCell): DerivationResult {
  const factor = parseFactorUnit(cell.unit);
  if (factor === null) {
    return refuse(`unit '${cell.unit}' is not a pure numeric factor unit`);
  }
  if (cell.value === null) {
    return refuse(`source cell ${cell.resultId} has no value (CBS reason: ${cell.valueAttribute}) — cannot expand it`);
  }
  const decimals = cell.decimals;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) {
    return refuse(`decimals ${decimals} outside the exact-arithmetic range — refusing to expand`);
  }
  const pow = 10 ** decimals;
  const scaled = Math.round(cell.value * pow);
  // The scaled value must reconstruct the cell value exactly — a value
  // carrying more precision than its declared decimals cannot be expanded
  // honestly.
  if (!Number.isSafeInteger(scaled) || scaled / pow !== cell.value) {
    return refuse(`value ${cell.value} does not scale exactly at ${decimals} decimals — refusing to expand`);
  }
  const expandedScaled = scaled * factor;
  if (!Number.isSafeInteger(expandedScaled)) {
    return refuse(`expansion of ${cell.value} × ${factor} exceeds exact integer range — refusing to expand`);
  }
  if (expandedScaled % pow !== 0) {
    return refuse(`expansion of ${cell.value} × ${factor} is not integer-valued — v1 registers integer expansions only`);
  }
  return {
    ok: true,
    record: {
      kind: 'unit_expansion',
      explicit: false,
      sourceResultIds: [cell.resultId],
      // The expanded figure is a bare count — 'aantal' is the validator's
      // existing no-unit-word-required convention (ADR 031 D1). The verbatim
      // factor string next to the SOURCE value stays R10-enforced.
      unit: 'aantal',
      marking: DERIVED_DATA_MARKING,
      factor,
      value: expandedScaled / pow,
    },
  };
}

/** Pre-registered on every series (R9): the endpoints, so "van X naar Y"
 * sentences bind to named cells. */
export function deriveFirstLast(cells: ResultCell[]): DerivationResult {
  if (cells.length < 2) {
    return refuse(`first_last needs at least 2 source cells, got ${cells.length}`);
  }
  const regionProblem = checkSingleRegion(cells);
  if (regionProblem) return refuse(regionProblem);
  const first = cells[0] as ResultCell;
  const last = cells[cells.length - 1] as ResultCell;
  return {
    ok: true,
    record: {
      kind: 'first_last',
      explicit: false,
      sourceResultIds: cells.map((c) => c.resultId),
      unit: first.unit,
      marking: DERIVED_DATA_MARKING,
      firstResultId: first.resultId,
      lastResultId: last.resultId,
    },
  };
}

type PeriodChangeRecord = Extract<DerivationRecord, { kind: 'period_change' }>;

export type PeriodChangeSeriesResult =
  | { ok: true; records: PeriodChangeRecord[] }
  | { ok: false; reason: string };

/** ADR 052 (#254's level-vs-%-change gap): one `period_change` record per
 * ADJACENT pair in a period-ordered, single-region series — cells[1] vs
 * cells[0], cells[2] vs cells[1], and so on ("adjacent" is grain-relative:
 * this never skips ahead to "same period last year" the way CBS's own
 * "jaarmutatie" measures do; where CBS publishes that as a real measure, the
 * ADR 051 alternate-reading toggle already serves it — this function exists
 * for the measures that have no such CBS-published sibling at all).
 *
 * Refuses the WHOLE series (principle c: no partial/fabricated result) when:
 *  - fewer than 2 cells, more than one region, or any cell has no value
 *    (checkComputable/checkSingleRegion — the same guards every other
 *    derivation in this file uses);
 *  - the periods are not a gap-free, single-grain, ascending sequence
 *    (contiguousPeriodCodes — reused from resolve.ts, not reimplemented);
 *  - ANY step's previous-period value is zero (division by zero) or
 *    negative (a percentage from a negative base can flip sign in a way
 *    that reads as nonsense — e.g. −5 to +5 is arithmetically "+200%").
 * Checked as one pre-scan pass over every step before any record is built,
 * so a bad step anywhere in the series refuses the entire reading rather
 * than silently dropping just that one point (the same "a chart may not
 * imply a continuity the data doesn't have" discipline chart/build.ts and
 * buildAlternateReading's own period-match guard already apply). */
export function derivePeriodChangeSeries(cells: ResultCell[]): PeriodChangeSeriesResult {
  // `refuse`'s `{ ok: false, reason }` shape is identical to this function's
  // own failure branch — reused directly (code-review finding) rather than
  // adding a second one-line "refuse" helper that does the same thing.
  if (cells.length < 2) {
    return refuse(`period-over-period change needs at least 2 source cells, got ${cells.length}`);
  }
  const regionProblem = checkSingleRegion(cells);
  if (regionProblem) return refuse(regionProblem);
  const computableProblem = checkComputable(cells);
  if (computableProblem) return refuse(computableProblem);
  const periods = cells.map((c) => c.periodCode);
  if (!contiguousPeriodCodes(periods)) {
    return refuse(
      `cells are not a regular, gap-free, single-grain period-over-period sequence (${periods.join(', ')}) — refusing rather than compare non-adjacent periods`,
    );
  }
  for (let i = 1; i < cells.length; i++) {
    const previous = cells[i - 1] as ResultCell;
    const previousValue = previous.value as number;
    if (previousValue === 0) {
      return refuse(`period ${previous.periodCode} has value 0 — a percentage change from zero is undefined`);
    }
    if (previousValue < 0) {
      return refuse(
        `period ${previous.periodCode} has a negative value (${previousValue}) — a percentage change from a negative base can be misleading, refusing rather than show it`,
      );
    }
  }
  const records: PeriodChangeRecord[] = [];
  for (let i = 1; i < cells.length; i++) {
    const previous = cells[i - 1] as ResultCell;
    const current = cells[i] as ResultCell;
    const previousValue = previous.value as number;
    const currentValue = current.value as number;
    const raw = ((currentValue - previousValue) / previousValue) * 100;
    const rounded = Math.round(raw * 10) / 10 + 0; // + 0 collapses a -0 to 0
    records.push({
      kind: 'period_change',
      explicit: false,
      sourceResultIds: [previous.resultId, current.resultId],
      unit: '%',
      marking: DERIVED_DATA_MARKING,
      value: rounded,
      previousResultId: previous.resultId,
      currentResultId: current.resultId,
    });
  }
  return { ok: true, records };
}
