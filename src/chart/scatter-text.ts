// Two-measure scatter (spec 2026-09-27, #296 part 2 Task 3): the pure Dutch
// scatter texts. No I/O, no LLM (R9/global-constraints): both builders are
// deterministic functions of a `ScatterSpec` — the SAME spec the chart
// itself renders from, so `answer.body`/`answer.scatterLine` re-derive
// byte-identically at audit time (R8), just like `regionSetLine`
// (src/answer/compose/format.ts). The body carries no data value (every
// number lives in the structural `scatterLineNl`, outside any value scan,
// same discipline as regionSetLine) and states no causal or superlative claim
// (R9) — a scatter shows two measures occurring together, never one
// "explaining" or "beating" the other.
import type { ScatterAxis, ScatterLeftOut, ScatterSideStatus, ScatterSpec } from './scatter.ts';
import { regionSetNoun } from '../answer/compose/format.ts';
import { nullReasonText } from '../answer/compose/template.ts';
import { sourceKeyForTableId } from '../sources/registry.ts';

/** Above this, a left-out list stops informing and starts being a wall of
 * text (same reasoning as format.ts's own REGION_SET_NAMED_LIMIT) — the
 * count itself is never dropped, only the naming. */
export const SCATTER_NAMED_LIMIT = 10;

/** "Gemiddelde verkoopprijs" → "gemiddelde verkoopprijs" — used to fold a
 * verbatim measure/region title into the middle of a sentence without
 * reshouting its capital (R10: the title itself is never reworded, only its
 * casing at the join point). The one copy `scatter.ts` also uses. */
export function lowerFirst(s: string): string {
  return s.length === 0 ? s : s[0].toLowerCase() + s.slice(1);
}

/** The Dutch reason a left-out region's ONE side carries no value, or null
 * when that side is 'value' (nothing to disclose). 'withheld' resolves
 * through the shared registry wording (R11, same call shape as
 * template.ts's own null-reason renderings) so a Eurostat axis gets
 * Eurostat's own marker text, not CBS's. */
function sideReason(side: ScatterSideStatus, axis: ScatterAxis): string | null {
  switch (side.state) {
    case 'withheld':
      // ScatterSideStatus always carries a real valueAttribute when withheld
      // (scatter.ts's sideStatus sets it from the cell; ResultCell.valueAttribute
      // is itself non-nullable — ingestion guarantees a reason on every null cell).
      return nullReasonText(side.valueAttribute!, sourceKeyForTableId(axis.tableId));
    case 'missing':
      return 'niet in onze database';
    case 'not_applicable':
      return 'bestond niet volgens het CBS';
    case 'value':
      return null;
  }
}

/** One left-out region as it is named in the coverage line: its label,
 * followed by every non-'value' side's reason, joined "measure: reason". */
function namedLeftOut(item: ScatterLeftOut, spec: ScatterSpec): string {
  const reasons: string[] = [];
  const yReason = sideReason(item.y, spec.y);
  if (yReason !== null) reasons.push(`${lowerFirst(spec.y.measureTitle)}: ${yReason}`);
  const xReason = sideReason(item.x, spec.x);
  if (xReason !== null) reasons.push(`${lowerFirst(spec.x.measureTitle)}: ${xReason}`);
  return `${item.label} (${reasons.join('; ')})`;
}

/** The scatter's body: what the two axes are, the region class, the period,
 * and the standard correlation-is-not-causation caveat (R9) — nothing else.
 * No number appears here beyond what is already inside the two measure
 * titles or the period label (both verbatim from the CBS table, R10); every
 * count lives in `scatterLineNl` instead, exactly like `regionSetLine`. */
export function scatterBodyNl(spec: ScatterSpec): string {
  const noun = regionSetNoun(spec.scope, 1);
  return (
    `${spec.y.measureTitle} tegenover ${lowerFirst(spec.x.measureTitle)} per ${noun}, ${spec.y.periodLabel}. ` +
    `Elke stip is één ${noun}. De grafiek laat zien hoe de twee cijfers samen voorkomen, ` +
    'niet dat het ene het andere veroorzaakt.'
  );
}

/** The scatter's structural coverage disclosure (#253-style, parallel to
 * `regionSetLine`): how many regions carry both measures, which regions were
 * left out and why (R11 — no dropped region is silent), and how many were
 * not a member of the class this period per CBS. */
export function scatterLineNl(spec: ScatterSpec): string {
  const noun = (n: number): string => regionSetNoun(spec.scope, n);
  const plotted = spec.points.length;
  const left = spec.leftOut.length;

  const coverage =
    left === 0
      ? `alle ${plotted} ${noun(plotted)} hebben beide cijfers.`
      : (() => {
          const named = spec.leftOut
            .slice(0, SCATTER_NAMED_LIMIT)
            .map((item) => namedLeftOut(item, spec))
            .join(', ');
          const rest = left > SCATTER_NAMED_LIMIT ? ` en ${left - SCATTER_NAMED_LIMIT} andere` : '';
          return `${plotted} ${noun(plotted)} hebben beide cijfers. Niet getoond: ${left} ${noun(left)} — ${named}${rest}.`;
        })();

  const notApplicableClause =
    spec.notApplicableCount > 0
      ? ` ${spec.notApplicableCount} ${noun(spec.notApplicableCount)} ${
          spec.notApplicableCount === 1 ? 'bestond' : 'bestonden'
        } in deze periode niet volgens het CBS.`
      : '';

  return `Dekking: ${coverage}${notApplicableClause}`;
}
