// WP23 (open-questions #86): the "Bekijk bij CBS StatLine" deep-link — pure
// URL construction over the answer's own table id, no live CBS call (the
// ADR 003 boundary: CBS is never queried from the request path; this link
// sends the USER to CBS's own viewer, our pipeline stays bulk-ingested).
//
// Deliberately links to the TABLE view, not a cell: StatLine's cell-level
// deep-link/filter syntax is unreliable across portal versions (#86 design
// check), while the dataset/table URL shape is CBS's own stable, shareable
// form. The table id rides VERBATIM — casing is load-bearing for CBS ids
// (ingestion quirk #1: '03759ned' is lowercase at CBS itself).
export function statLineUrl(tableId: string): string {
  return `https://opendata.cbs.nl/statline/#/CBS/nl/dataset/${tableId}/table`;
}
