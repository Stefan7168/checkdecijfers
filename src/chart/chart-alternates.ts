// #254 / ADR 051 / ADR 052 / Session 110 (#262(c)): the ONE shared assembly
// of a primary answer's `chartAlternates` list — extracted from
// src/answer/respond/respond.ts (where it originally lived inline) so
// src/chart/embed-live.ts's live re-run (Session 110) can build the exact
// same list from a freshly re-queried result, rather than duplicating this
// logic a second time. Both callers get byte-identical assembly rules:
// respond.ts's own stored-envelope pin (tests/answer/respond-pipeline.test.ts)
// depends on this function producing exactly what the inline loop used to.
//
// Every entry is built best-effort (never blocks/breaks the primary answer):
// a refused/failed alternate or period-change reading is simply omitted,
// never surfaced as an error — the same degrade-on-refusal contract
// buildAlternateReading/buildPeriodChangeReading already document.
import type { Db } from '../db/types.ts';
import type { AttributionAlternate, StructuredIntent, ValidatedResult } from '../query/index.ts';
import { buildAlternateReading } from './alternate-reading.ts';
import { buildPeriodChangeReading, composeAlternatePeriodChangeLabel, isPeriodChangeEligible } from './period-change.ts';
import type { ChartSpec } from './types.ts';

export interface ChartAlternateEntry {
  label: string;
  spec: ChartSpec;
}

export interface BuildChartAlternatesOptions {
  /** The primary intent's own canonical key, when it has one (`intent.target.kind
   * === 'canonical' ? intent.target.key : null`) — checked against the
   * hand-curated PERIOD_CHANGE_ELIGIBLE_KEYS allowlist (ADR 052 D3) to decide
   * whether to offer a period-over-period %-change reading of the PRIMARY
   * result itself, on top of whatever the registry-alternates loop below
   * already produced. `null` when the primary target isn't canonical at all
   * (an explicit-target intent has no canonical key to check). */
  periodChangeEligibleKey: string | null;
  /** Session 110, ADR 041's #195 discipline: forwarded verbatim to every
   * `buildAlternateReading` call below (see that function's own doc comment).
   * Absent/`false` (the default — respond.ts's own call, an actually-served
   * chat answer) matches this function's pre-extraction behavior exactly;
   * `src/chart/embed-live.ts`'s `rerunLive` is the one caller that passes
   * `true`, so a live embed re-render's alternate rebuilds never bump
   * `cbs_tables.last_queried_at` any more than its own primary query does.
   * The period-change readings below never re-query at all (D4: a pure
   * transform of already-fetched cells), so they need no probe flag of
   * their own — there is nothing for `probe` to apply to there. */
  probe?: boolean;
}

/**
 * Builds the full `chartAlternates` list for an already-answered primary
 * result: one entry per registered registry alternate (capped at 4 — the
 * highest count any registry entry carries today, a defensive bound rather
 * than a real limit hit in practice), each optionally followed by its own
 * period-over-period %-change reading (ADR 052 session-110 addendum, when
 * that alternate itself is `periodChangeEligible`), and finally one more
 * period-change entry for the PRIMARY result itself when `options.
 * periodChangeEligibleKey` names an eligible canonical key (ADR 052 D3).
 *
 * Callers are expected to only invoke this when there IS a primary chart to
 * offer alternates alongside (a single-value/derived answer has no chart to
 * toggle from) — this function itself has no opinion on that; it operates
 * purely on `result`/`alternatesFromAttribution`.
 */
export async function buildChartAlternates(
  db: Db,
  result: ValidatedResult,
  intent: StructuredIntent,
  alternatesFromAttribution: AttributionAlternate[],
  options: BuildChartAlternatesOptions,
): Promise<ChartAlternateEntry[]> {
  const chartAlternates: ChartAlternateEntry[] = [];

  for (const alt of alternatesFromAttribution.slice(0, 4)) {
    const outcome = await buildAlternateReading(db, result, intent, alt, { probe: options.probe === true });
    if (!outcome.ok) continue;
    // Explicit pick, never a spread: outcome.result also carries `validated`
    // (#254(a) below) — the stored envelope must stay byte-identical, so
    // only the two original keys ever reach chartAlternates.
    chartAlternates.push({ label: outcome.result.label, spec: outcome.result.spec });

    // #254(a), ADR 052 session-110 addendum: a registry alternate can itself
    // be marked periodChangeEligible (today: the three household-income
    // concepts) on the SAME grounds ADR 052 D3 checked for the primary — a
    // person reviewed that alternate's own data, not an inference from the
    // primary's eligibility. When it is, offer ONE extra dropdown entry: the
    // period-change reading of THIS alternate's own already-built result
    // (never a third query — buildPeriodChangeReading is a pure transform of
    // `outcome.result.validated`'s own cells). Best-effort, same
    // degrade-on-refusal contract as everywhere else.
    if (alt.periodChangeEligible === true) {
      const altPctOutcome = buildPeriodChangeReading(outcome.result.validated);
      if (altPctOutcome.ok) {
        chartAlternates.push({
          label: composeAlternatePeriodChangeLabel(alt.label, altPctOutcome.result.label),
          spec: altPctOutcome.result.spec,
        });
      }
    }
  }

  // ADR 052 (#254's level-vs-%-change gap): a DIFFERENT mechanism from the
  // registry-alternates loop above — no re-query, a pure transform of
  // `result`'s own cells (src/chart/period-change.ts) — offered as one EXTRA
  // entry on the same dropdown, deliberately not folded into the
  // 4-alternate cap above (ADR 052 D6: the two lists come from structurally
  // different places). Gated on the intent's own canonical key (passed in by
  // the caller as `options.periodChangeEligibleKey`), not on
  // `alternatesFromAttribution` (a measure can be period-change-eligible
  // with zero registry alternates of its own, e.g.
  // solar_electricity_production). Best-effort, same degrade-on-refusal
  // contract as the loop above.
  if (
    options.periodChangeEligibleKey !== null &&
    isPeriodChangeEligible(options.periodChangeEligibleKey)
  ) {
    const pctOutcome = buildPeriodChangeReading(result);
    if (pctOutcome.ok) chartAlternates.push(pctOutcome.result);
  }

  return chartAlternates;
}
