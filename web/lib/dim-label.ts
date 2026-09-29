// WP-LOOK part (a) round 2 (session 143, 2026-09-29, ADR 063).
//
// CBS's own dimension titles sometimes carry the classification code in
// front of the words — the CPI table's Bestedingscategorieen are the big
// case ("000000 Alle bestedingen", "011150 Pastaproducten, noedels,
// couscous": 568 such titles in the fixtures, all COICOP codes). That title
// is stored verbatim as the chart spec's `dimLabels` value, so the card's
// subtitle read "% 000000 Alle bestedingen" — a machine prefix in the
// reader's face, the first thing the owner asked to have gone.
//
// Display-only. The spec, the audit row and the proof panel keep the raw
// title (the proof panel is where a reader who wants the code finds it,
// answer-proof.tsx's CellTable). Removing digits from a spec string cannot
// add a number to the card, so the whole-card digit scan (R6 / #254) is
// unaffected. Deliberately narrow: ONLY a leading run of four or more
// digits followed by whitespace and at least one more character — never a
// year ("2024"), an age band ("15 tot 25 jaar") or a letter-prefixed code
// ("GM0363 Amsterdam", "T001036 Totaal"), which read as words to a Dutch
// reader or are the label itself.
const LEADING_CODE = /^\d{4,}\s+(?=\S)/;

export function stripDimensionCode(label: string): string {
  return label.replace(LEADING_CODE, '');
}
