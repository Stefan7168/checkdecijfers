// WP23 (open-questions #86): the "Bekijk bij …" deep-link — pure URL
// construction over the answer's own table id, no live source call (the
// ADR 003 boundary: sources are never queried from the request path; this
// link sends the USER to the source's own viewer, our pipeline stays
// bulk-ingested).
//
// WP30a (ADR 030 D3): the URL shape and the label live in the SOURCE
// REGISTRY; absent source (historical answers) resolves to 'cbs' (A1), so
// today's output is byte-identical to the pre-WP30a literals. The CBS shape
// deliberately links to the TABLE view, not a cell: StatLine's cell-level
// deep-link syntax is unreliable across portal versions (#86 design check),
// while the dataset/table URL is CBS's own stable, shareable form. The table
// id rides VERBATIM — casing is load-bearing for CBS ids (ingestion quirk
// #1: '03759ned' is lowercase at CBS itself).
import { formatValueNl } from '../backend/answer/compose/format.ts';
import { resolveSource } from '../backend/sources/registry.ts';

/** The source's own viewer URL for a table, or null when the source has no
 * public viewer (render no link then). */
export function sourceTableUrl(source: string | undefined, tableId: string): string | null {
  return resolveSource(source).deepLink?.(tableId) ?? null;
}

/** The deep-link label: "Bekijk bij CBS StatLine". */
export function sourceLinkLabel(source: string | undefined): string {
  return `Bekijk bij ${resolveSource(source).attributionLabel}`;
}

/** formatValueNl groups thousands with a period ('742.783', Dutch prose
 * convention); StatLine's own rendered tables group with a space
 * ('742 783', verified against the real portal 2026-09). formatValueNl only
 * ever uses '.' for grouping, so this substitution is exact. */
function toStatlineNumberText(formatted: string): string {
  return formatted.replaceAll('.', ' ');
}

/** A best-effort per-cell highlight: a browser Text Fragment
 * (https://wicg.github.io/scroll-to-text-fragment/) appended to the table
 * URL, so a click scrolls to and highlights the matching cell on StatLine's
 * own page in browsers that support it. Purely additive over
 * sourceTableUrl/#86 — unsupported browsers, portal layout drift, or a
 * duplicate value elsewhere in the table just make the fragment a no-op;
 * the link still opens the same stable table view it always did.
 *
 * The period label rides as the match's PREFIX (never highlighted itself)
 * to disambiguate a value that repeats elsewhere in the table — reusing the
 * same STORED cell.value/decimals formatValueNl already formats for
 * display (R1: no new computation, just reformatted for the URL).
 *
 * null whenever there is nothing safe to point at: no public viewer for the
 * source, or a null-valued cell. */
export function cbsHighlightUrl(
  source: string | undefined,
  tableId: string,
  periodLabel: string,
  value: number | null,
  decimals: number,
): string | null {
  const base = sourceTableUrl(source, tableId);
  if (base === null || value === null) return null;
  const target = toStatlineNumberText(formatValueNl(value, decimals));
  const directive = `${encodeURIComponent(periodLabel)}-,${encodeURIComponent(target)}`;
  return `${base}:~:text=${directive}`;
}
