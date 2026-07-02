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
import { DERIVED_DATA_MARKING, type DerivationRecord, type ResultCell } from './types.ts';

export type DerivationResult =
  | { ok: true; record: DerivationRecord }
  | { ok: false; reason: string };

function refuse(reason: string): DerivationResult {
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

/** B13-style growth: later period minus earlier period, one coordinate.
 * Requires exactly two cells at the same region/dims, different periods;
 * cells arrive period-ordered from run.ts. */
export function deriveDifference(cells: ResultCell[]): DerivationResult {
  if (cells.length !== 2) {
    return refuse(`difference needs exactly 2 source cells, got ${cells.length}`);
  }
  const [earlier, later] = cells as [ResultCell, ResultCell];
  if (earlier.periodCode === later.periodCode) {
    return refuse('difference needs two distinct periods');
  }
  if (earlier.regionCode !== later.regionCode) {
    return refuse('difference compares periods at one place — regions differ');
  }
  const problem = checkComputable(cells);
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

/** Pre-registered on every series (R9): net direction over the period-ordered
 * cells, plus whether the movement was monotonic — so "gestegen" can be
 * checked, and a rose-then-fell series cannot be phrased as a straight rise. */
export function deriveDirection(cells: ResultCell[]): DerivationResult {
  if (cells.length < 2) {
    return refuse(`direction needs at least 2 source cells, got ${cells.length}`);
  }
  const problem = checkComputable(cells);
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

/** Pre-registered on every series (R9): the endpoints, so "van X naar Y"
 * sentences bind to named cells. */
export function deriveFirstLast(cells: ResultCell[]): DerivationResult {
  if (cells.length < 2) {
    return refuse(`first_last needs at least 2 source cells, got ${cells.length}`);
  }
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
