// WP20 (open-questions #80): pure extraction of the stat-card's display data
// from a validated answer. The card exists ONLY for a single-number result:
// shape 'single', exactly one cell, non-null value — anything else returns
// null and the chat renders no card. The number is formatted by the SHARED
// formatValueNl (R3: one formatter, no drift with answer text or charts);
// nothing here computes or rounds a value itself.
import { formatValueNl } from '../backend/answer/compose/format.ts';
import type { AnswerResponse } from '../backend/answer/respond/types.ts';

export interface StatCardData {
  /** Dutch-formatted value, straight from formatValueNl. */
  value: string;
  unit: string;
  measureTitle: string;
  /** "regio · periode" context line (region omitted on national tables). */
  context: string;
  provisional: boolean;
  tableId: string;
  /** ISO date part of the sync timestamp (rendered on the card verbatim). */
  syncedDate: string;
}

export function statCardData(response: AnswerResponse): StatCardData | null {
  const { result } = response;
  if (result.shape !== 'single' || result.cells.length !== 1) return null;
  const cell = result.cells[0]!;
  if (cell.value === null) return null;
  return {
    value: formatValueNl(cell.value, cell.decimals),
    unit: cell.unit,
    measureTitle: cell.measureTitle,
    context: [cell.regionLabel, cell.periodLabel].filter((part) => part !== null && part !== '').join(' · '),
    provisional: cell.provisional,
    tableId: result.attribution.tableId,
    syncedDate: result.attribution.syncedAt.slice(0, 10),
  };
}
