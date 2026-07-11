// WP20 (open-questions #78): the "Kopieer als citaat" text — a ready-to-paste
// editorial quote assembled ONLY from the validated answer body (verbatim,
// never recomposed: the body's numbers passed the R3 validator, and this
// module must not create any new number-bearing prose) plus structured
// Attribution fields. Honesty flags ride along structurally: a provisional
// cell anywhere in the quoted result adds "voorlopige cijfers", and any
// registered derivation adds the exact CC BY marking constant (R5).
//
// Imports deliberately target LEAF modules (types.ts), never the query
// barrel — the WP13 lesson: importing anything from a barrel pulls its whole
// module graph into Turbopack's resolution.
import type { AnswerResponse } from '../backend/answer/respond/types.ts';
import { DERIVED_DATA_MARKING } from '../backend/query/types.ts';
import { resolveSource } from '../backend/sources/registry.ts';

/** Dutch long date ("3 juli 2026") in the product's own timezone, matching
 * question-history's date convention. */
function formatDateNl(iso: string): string {
  return new Intl.DateTimeFormat('nl-NL', {
    timeZone: 'Europe/Amsterdam',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));
}

export function buildCitation(response: AnswerResponse): string {
  const attribution = response.result.attribution;
  const flags: string[] = [
    // WP30a (ADR 030 D3): the label resolves via the source registry —
    // absent source (historical envelopes) → 'cbs' (A1), byte-identical.
    `${resolveSource(attribution.source).attributionLabel}, tabel ${attribution.tableId}`,
    `gesynchroniseerd ${formatDateNl(attribution.syncedAt)}`,
  ];
  if (response.result.cells.some((cell) => cell.provisional)) {
    flags.push('voorlopige cijfers');
  }
  if (response.result.derivations.length > 0) {
    flags.push(DERIVED_DATA_MARKING);
  }
  return `${response.answer.body} (${flags.join(', ')})`;
}
