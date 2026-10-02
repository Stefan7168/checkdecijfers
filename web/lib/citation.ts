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
import { derivedDataMarking, isDerivedResult } from '../backend/query/types.ts';
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

/** "CBS StatLine, tabel X, gesynchroniseerd 3 juli 2026" — one table's source. */
function tableFlags(attribution: AnswerResponse['result']['attribution']): string {
  // WP30a (ADR 030 D3): the label resolves via the source registry —
  // absent source (historical envelopes) → 'cbs' (A1), byte-identical.
  return (
    `${resolveSource(attribution.source).attributionLabel}, tabel ${attribution.tableId}, ` +
    `gesynchroniseerd ${formatDateNl(attribution.syncedAt)}`
  );
}

export function buildCitation(response: AnswerResponse): string {
  // #296 part 2 Task 7: a scatter answer rests on TWO tables (the x leg rides
  // `pairedResult`, present-only) — both are cited, y first, each with its
  // own sync date; the honesty flags then cover BOTH legs.
  const paired = response.pairedResult ?? null;
  const results = paired === null ? [response.result] : [response.result, paired];
  const sources = [tableFlags(response.result.attribution)];
  if (paired !== null && paired.attribution.tableId !== response.result.attribution.tableId) {
    sources.push(tableFlags(paired.attribution));
  }
  const flags: string[] = [sources.join('; ')];
  if (results.some((result) => result.cells.some((cell) => cell.provisional))) {
    flags.push('voorlopige cijfers');
  }
  const derived = results.find((result) => isDerivedResult(result));
  if (derived !== undefined) {
    flags.push(derivedDataMarking(derived.attribution.tableId));
  }
  return `${response.answer.body} (${flags.join(', ')})`;
}
