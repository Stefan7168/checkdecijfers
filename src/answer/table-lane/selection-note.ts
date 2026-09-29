// Breadth step 5 — the table lane's selection record and the deterministic
// note built from it. A LEAF (type-only imports): plan.ts produces the
// selection, respond.ts stores it in the `tableLane` envelope, and
// src/answer/audit/reconstruct.ts re-derives the note from the stored
// selection (R8) without pulling the planner's runtime graph in. Moved here
// from plan.ts in Task 3 fix round 1 (Ruling R8); plan.ts re-exports both.
import type { StatedDefault } from '../../query/breakdowns.ts';

export interface TableLaneSelection {
  named: StatedDefault[];
  defaults: StatedDefault[];
  /** Present-only: "Nederland" was absorbed by a national-only table
   * (Settled design choice 5) — its own line in the selection note. */
  nationalTable?: true;
}

/**
 * The deterministic note under a table-lane answer (Settled design choice 9):
 * every fixed breakdown coordinate, CBS titles verbatim — named ones
 * ("Selectie: <dim>: <member>"), the national-table line, then defaults
 * ("Uitgangspunt: <dim>: <member>"). Never part of the answer text. null when
 * nothing is fixed.
 */
export function selectionNote(sel: TableLaneSelection, lang: 'nl' | 'en'): string | null {
  const item = (s: StatedDefault) => `${s.dimensionTitle}: ${s.memberTitle}`;
  const parts: string[] = [];
  if (sel.named.length > 0) parts.push((lang === 'nl' ? 'Selectie: ' : 'Selection: ') + sel.named.map(item).join('; '));
  if (sel.nationalTable) {
    parts.push(lang === 'nl' ? 'Regio: Nederland (landelijke tabel)' : 'Region: the Netherlands (national table)');
  }
  if (sel.defaults.length > 0) parts.push((lang === 'nl' ? 'Uitgangspunt: ' : 'Assumed: ') + sel.defaults.map(item).join('; '));
  return parts.length > 0 ? parts.join(' · ') : null;
}
