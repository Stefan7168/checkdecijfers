// The own-data counterpart of csv.ts's buildAnswerCsv (ADR 037 D11): a CSV
// export for a UserChartSpec, the "your data" chart tier. Same dialect —
// ';' separator, decimal comma, no thousands grouping, UTF-8 BOM, CRLF — so
// a file from either tier opens the same way in Dutch-locale Excel. The
// separation from csv.ts stays structural (H2): this file never imports a
// CBS answer/query type, and buildAnswerCsv never imports a UserChartSpec.
//
// Honesty rules, structural:
// - U1/U9: every row's value/shown-as/cell columns are the spec's own
//   UserChartPoint fields, exact and verbatim — value serializes at full
//   precision (decimal comma, never rounded, never grouped); formattedValue
//   and rowRef are copied as-is. No number is computed or reformatted here.
// - U11 analog: a null value's row is never dropped — the value cell is
//   empty and the note column states why (the point's own `reason`, or the
//   `incomplete` disclosure when a group/series was computed from fewer
//   cells than it has).
// - D0/D11: the disclaimer line (spec.disclaimerLine, the same
//   USER_DATA_DISCLAIMER shown on the chart) opens the file, followed by a
//   source line naming the uploaded file and its capture date — a reader
//   who only has the CSV still sees this is unverified user data, not a CBS
//   export.
// - CSV-injection defense (ADR 037 D11, OWASP CSV Injection): every field
//   whose text originates in the user's own file — xHeader, a series label,
//   an xLabel, the uploaded file's display name — is run through
//   `neutralizeFormula` before being written. Numbers we generate ourselves
//   (value, formattedValue) are never touched, so a genuine negative number
//   stays a number a spreadsheet will compute with.
//
// Imports target pure leaves only, as csv.ts does: the attachments types
// (never a barrel) and messages.ts's own `t`/`Lang`.
import type { UserChartSpec } from '../backend/attachments/types.ts';
import { BOM, CRLF, csvRow } from './csv.ts';
import { t, type Lang } from './i18n/messages.ts';

export interface UserChartCsv {
  filename: string;
  /** Full file content, BOM included. */
  content: string;
}

/** OWASP CSV Injection (https://owasp.org/www-community/attacks/CSV_Injection),
 * applied the way the 2026-09-06 design brief's D11 fix specifies
 * (docs/session-briefs/2026-09-06-chat-with-data-design.md): content-level,
 * not delimiter-level — RFC 4180 quoting alone does NOT stop Excel
 * evaluating `"=1+1"` once its parser strips the quotes.
 * 1. A field that is a plain number (`-5,2`, `+3`, `1.234,5`) is left alone:
 *    this domain is full of legitimate negative numbers and x labels, and a
 *    blanket prefix would visibly mangle them. A plain number is not a
 *    formula — `-2+3` is not a plain number, so it is still neutralised.
 * 2. Otherwise, leading whitespace/control characters are looked THROUGH
 *    (` =1+1` and `\t=1+1` are still formulas in some spreadsheet apps), and
 *    if what follows starts with `=`, `+`, `-` or `@` — or the field itself
 *    opens with a TAB/CR — a single quote is prefixed. The original text is
 *    kept whole after the quote, so nothing the reader wrote is lost.
 * Only the LEADING character matters; a formula-shaped substring in the
 * middle of a field (e.g. `=HYPERLINK(...)` after other text) is inert. */
const PLAIN_NUMBER = /^[+-]?\d+(?:[.,]\d+)*$/;
const FORMULA_TRIGGER = /^[=+\-@]/;

export function neutralizeFormula(text: string): string {
  if (PLAIN_NUMBER.test(text)) return text;
  const opensWithControl = /^[\t\r]/.test(text);
  // eslint-disable-next-line no-control-regex -- deliberately strips leading control characters
  const lead = text.replace(/^[\s\u0000-\u001f]+/, '');
  return opensWithControl || FORMULA_TRIGGER.test(lead) ? `'${text}` : text;
}

/** Value column: exact, ungrouped, decimal comma — the point's own stored
 * value, never rounded (U1). Unlike csv.ts's cell numbers there is no CBS
 * `decimals` metadata here to pad to; the point already carries the exact
 * number the chart plotted. */
function csvUserValue(value: number | null): string {
  return value === null ? '' : String(value).replace('.', ',');
}

/** The note column: the point's own MissingValueReason is a fixed, already
 * short vocabulary ('leeg in bron' / 'geen getal' / 'geen vorige waarde')
 * stored and shown as-is regardless of interface language (like `unit` in
 * csv.ts) — not user text, so it needs neither translation nor
 * neutralization. `incomplete` (session 124, #314) only ever shows when
 * there is no more specific reason. */
function csvUserNote(point: UserChartSpec['series'][number]['points'][number], lang: Lang): string {
  if (point.reason) return point.reason;
  if (point.incomplete) return t(lang, 'userCsv.incompleteNote');
  return '';
}

export function buildUserChartCsv(spec: UserChartSpec, lang: Lang): UserChartCsv {
  const capturedDate = spec.provenance.capturedAt.slice(0, 10);
  const fileName = neutralizeFormula(spec.provenance.displayName);
  // Neutralize the interpolated display name AND the assembled line — the
  // line itself always starts with the fixed 'Bron'/'Source' word, so the
  // second pass is a no-op today, but it keeps this row honest even if the
  // template ever changes shape (defense-in-depth, matching csv.ts's own
  // precedent for the reference-cell fallback in derivationDecimals).
  const sourceLine = neutralizeFormula(
    t(lang, 'userCsv.sourceLine', { file: fileName, date: capturedDate }),
  );

  const preamble = [
    csvRow([spec.disclaimerLine]),
    csvRow([sourceLine]),
    csvRow([t(lang, 'userCsv.fileCreatedBy')]),
  ];

  // Data table: LONG format, one row per plotted point, series in spec
  // order, points in spec order — the same order the chart itself draws.
  const header = csvRow([
    neutralizeFormula(spec.xHeader),
    t(lang, 'userCsv.seriesHeader'),
    t(lang, 'userCsv.valueHeader'),
    t(lang, 'userCsv.shownAsHeader'),
    t(lang, 'userCsv.cellHeader'),
    t(lang, 'userCsv.noteHeader'),
  ]);
  const dataRows = spec.series.flatMap((series) =>
    series.points.map((point) =>
      csvRow([
        neutralizeFormula(point.xLabel),
        neutralizeFormula(series.label),
        csvUserValue(point.value),
        point.formattedValue ?? '',
        point.rowRef,
        csvUserNote(point, lang),
      ]),
    ),
  );

  const lines = [...preamble, '', header, ...dataRows];
  return {
    filename: `checkdecijfers-your-data-${spec.provenance.datasetId}.csv`,
    content: BOM + lines.join(CRLF) + CRLF,
  };
}
