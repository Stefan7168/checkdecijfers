// Shared types for the table lane (breadth step 5). Kept in a leaf file so the
// request store (src/ingestion/table-lane-store.ts) and the lane planner can
// both import them without importing each other.

/** One accumulated reader answer to a breakdown or region question: the
 * dimension it answers and the member code the reader picked. Codes are
 * always CBS's own (checked against the table's stored dimension_labels by
 * the planner before they are stored or used) — never free text. */
export interface TableLaneChoice {
  dimension: string;
  code: string;
}
