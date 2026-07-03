// Dutch rendering of CBS period codes for refusal/clarification prose. Lives
// here (respond/), not in compose/format.ts: compose's period words come from
// the ingested dimension_labels (periodLabel on ResultCell), never re-derived
// from the code — this module renders periods the REFUSAL builders reason
// about (freshest-available codes, example-question codes) before any cell
// or label exists to draw from.
const MONTH_NAMES_NL = [
  'januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december',
];

const QUARTER_WORDS_NL = ['eerste', 'tweede', 'derde', 'vierde'];

/** '2026MM06' -> 'juni 2026'; '2025KW04' -> 'het vierde kwartaal van 2025';
 * '2024JJ00' -> '2024'. Unparseable/unrecognized codes render verbatim
 * (never fabricate a period that isn't the code itself). */
export function periodCodeToNl(code: string): string {
  const match = /^(\d{4})(JJ|KW|MM)(\d{2})$/.exec(code);
  if (!match) return code;
  const [, yearStr, grain, seqStr] = match as unknown as [string, string, string, string];
  const year = Number.parseInt(yearStr, 10);
  const seq = Number.parseInt(seqStr, 10);

  if (grain === 'JJ') return `${year}`;
  if (grain === 'MM') {
    const month = MONTH_NAMES_NL[seq - 1];
    return month ? `${month} ${year}` : code;
  }
  if (grain === 'KW') {
    const word = QUARTER_WORDS_NL[seq - 1];
    return word ? `het ${word} kwartaal van ${year}` : code;
  }
  return code;
}
