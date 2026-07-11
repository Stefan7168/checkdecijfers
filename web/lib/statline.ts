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
