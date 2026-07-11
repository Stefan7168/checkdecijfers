// WP20 (open-questions #80): pure extraction of the stat-card's display data
// from a validated answer. The card exists ONLY for a single-number result:
// shape 'single', exactly one cell, non-null value — anything else returns
// null and the chat renders no card. The number is formatted by the SHARED
// formatValueNl (R3: one formatter, no drift with answer text or charts);
// nothing here computes or rounds a value itself.
//
// Unit conventions (WP20 adversarial-review HIGH finding): the card must
// render units exactly as the answer body does — '%' hugging, 'aantal' bare,
// digit-bearing factor units parenthesized (the R10 ×1.000 misreading
// guard). Rather than duplicating those rules, `unitSuffix` is DERIVED from
// the shared displayValueUnit itself (the full rendering minus the formatted
// value), so the card structurally cannot drift from the body convention.
// template.ts and its imports (validate.ts → format.ts) are pure modules —
// verified leaf-chain, safe in the client bundle.
import { formatValueNl } from '../backend/answer/compose/format.ts';
import { displayValueUnit } from '../backend/answer/compose/template.ts';
import type { AnswerResponse } from '../backend/answer/respond/types.ts';
import { resolveSource } from '../backend/sources/registry.ts';

export interface StatCardData {
  /** Dutch-formatted value, straight from formatValueNl. */
  value: string;
  /** What follows the value, per the shared body convention: '%' | '' (a
   * bare 'aantal' count) | ' (× 1 000)' (factor guard) | ' eenheid'. */
  unitSuffix: string;
  measureTitle: string;
  /** "regio · periode" context line (region omitted on national tables). */
  context: string;
  provisional: boolean;
  tableId: string;
  /** The registry-resolved attribution label ('CBS StatLine') for the card
   * footer (WP30a, ADR 030 A3 — StatCardData carried no source before). */
  sourceLabel: string;
  /** ISO date part of the sync timestamp (rendered on the card verbatim). */
  syncedDate: string;
}

export function statCardData(response: AnswerResponse): StatCardData | null {
  const { result } = response;
  if (result.shape !== 'single' || result.cells.length !== 1) return null;
  const cell = result.cells[0]!;
  if (cell.value === null) return null;
  const value = formatValueNl(cell.value, cell.decimals);
  return {
    value,
    unitSuffix: displayValueUnit(cell.value, cell.decimals, cell.unit).slice(value.length),
    measureTitle: cell.measureTitle,
    context: [cell.regionLabel, cell.periodLabel].filter((part) => part !== null && part !== '').join(' · '),
    provisional: cell.provisional,
    tableId: result.attribution.tableId,
    sourceLabel: resolveSource(result.attribution.source).attributionLabel,
    syncedDate: result.attribution.syncedAt.slice(0, 10),
  };
}
