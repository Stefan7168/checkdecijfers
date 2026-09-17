// ADR 052 (#254's level-vs-%-change gap): a period-over-period percent-change
// alternate reading of an already-answered LEVEL series — a genuinely
// different mechanism from src/chart/alternate-reading.ts's
// buildAlternateReading, not a variant of it (see the ADR's D4). That
// function swaps measure/dims and RE-QUERIES the database for a different,
// independently-stored CBS cell; this one takes the PRIMARY result's own
// already-fetched, already-validated cells and transforms them — no second
// runQuery, no StructuredIntent, no explicit-target eviction-race exposure
// (buildAlternateReading's own documented caveat simply does not apply
// here). The transform itself is delegated entirely to the registered
// derivation function (derivePeriodChangeSeries, src/query/derivations.ts,
// R5) — this module's only job is projecting that derivation's output into a
// synthetic ValidatedResult and handing it to the EXISTING, unmodified
// buildChartSpec (reuse over reinvention, the same approach ADR 051 itself
// took for runQuery, applied one level down).
import type { Attribution, ResultCell, ValidatedResult } from '../query/index.ts';
import { derivePeriodChangeSeries } from '../query/derivations.ts';
import { PERIOD_CHANGE_ELIGIBLE_KEYS } from '../registry/defaults.ts';
import { buildChartSpec } from './build.ts';
import type { ChartSpec } from './types.ts';

export const PERIOD_CHANGE_READING_LABEL = 'Procentuele verandering t.o.v. vorige periode' as const;

export interface PeriodChangeReadingResult {
  label: string;
  spec: ChartSpec;
}

export type PeriodChangeReadingOutcome =
  | { ok: true; result: PeriodChangeReadingResult }
  | { ok: false; reason: string };

/** ADR 052 D3: whether `canonicalKey` is on the hand-curated allowlist
 * (src/registry/defaults.ts PERIOD_CHANGE_ELIGIBLE_KEYS) — a plain code
 * constant, not a database column or a runtime heuristic over the data
 * (cheapest-mechanism-first; no migration needed for this feature at all). */
export function isPeriodChangeEligible(canonicalKey: string): boolean {
  return PERIOD_CHANGE_ELIGIBLE_KEYS.has(canonicalKey);
}

/** Builds the period-over-period %-change alternate reading of `primary`, or
 * refuses (never throws, mirroring buildAlternateReading's degrade-on-refusal
 * contract) — every caller today (src/answer/respond/respond.ts) already
 * treats `{ ok: false }` as "no extra dropdown entry, primary chart
 * unaffected," so a refusal here is always a missing toggle, never a broken
 * answer. Callers are expected to have already checked
 * `isPeriodChangeEligible` on the primary's own canonical key — this
 * function does not re-check eligibility itself, since it has no dependency
 * on `StructuredIntent` at all (D4: it operates purely on the already-
 * validated `ValidatedResult`). */
export function buildPeriodChangeReading(primary: ValidatedResult): PeriodChangeReadingOutcome {
  if (primary.shape !== 'series') {
    return { ok: false, reason: `primary result has shape '${primary.shape}', not a single-region time series` };
  }

  const derived = derivePeriodChangeSeries(primary.cells);
  if (!derived.ok) {
    return { ok: false, reason: `period-over-period change refused (${derived.reason})` };
  }

  const cellById = new Map(primary.cells.map((c) => [c.resultId, c] as const));
  const changeCells: ResultCell[] = derived.records.map((record) => {
    const previous = cellById.get(record.previousResultId);
    const current = cellById.get(record.currentResultId);
    if (!previous || !current) {
      // Structurally unreachable: derivePeriodChangeSeries mints these ids
      // from `primary.cells` itself, so every id it returns is a key of
      // `cellById` by construction. Thrown (never a silent skip) so a future
      // change to either function that broke this invariant fails loudly in
      // CI rather than quietly dropping a point.
      throw new Error(`period-change reading: derivation referenced an unknown source cell (${record.previousResultId} / ${record.currentResultId})`);
    }
    return {
      resultId: `${current.resultId}#period_change`,
      tableId: current.tableId,
      // Distinguishable from a real CBS measure code — nothing parses this
      // field's internal structure, but a synthetic value should never read
      // as though it were CBS's own measure.
      measure: `${current.measure}#period_change`,
      measureTitle: `${current.measureTitle} — procentuele verandering t.o.v. vorige periode`,
      regionCode: current.regionCode,
      regionLabel: current.regionLabel,
      periodCode: current.periodCode,
      periodLabel: current.periodLabel,
      grain: current.grain,
      dims: current.dims,
      dimLabels: current.dimLabels,
      value: record.value,
      unit: '%',
      decimals: 1,
      status: current.status,
      // A provisional SOURCE on either side of the pair taints the computed
      // percentage — honest to flag it even when only one side is
      // provisional (R11).
      provisional: current.provisional || previous.provisional,
      valueAttribute: 'None',
      batchId: current.batchId,
    };
  });

  // `alternates` deliberately dropped (docs/13 present-only discipline: this
  // synthetic result is not itself a canonical-default answer, so it states
  // no alternates of its own), everything else about the source table
  // carried through unchanged.
  const { alternates: _primaryAlternates, ...attributionRest } = primary.attribution;
  const attribution: Attribution = {
    ...attributionRest,
    definitionLabel:
      primary.attribution.definitionLabel === null
        ? 'procentuele verandering t.o.v. vorige periode'
        : `${primary.attribution.definitionLabel}, procentuele verandering t.o.v. vorige periode`,
  };

  const synthetic: ValidatedResult = {
    ok: true,
    schemaVersion: primary.schemaVersion,
    shape: 'series',
    cells: changeCells,
    derivations: derived.records,
    attribution,
    intent: primary.intent,
  };

  try {
    const spec = buildChartSpec(synthetic);
    if (spec === null) {
      return { ok: false, reason: 'period-change reading shape yields no chart' };
    }
    return { ok: true, result: { label: PERIOD_CHANGE_READING_LABEL, spec } };
  } catch (err) {
    return { ok: false, reason: `period-change chart build failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
