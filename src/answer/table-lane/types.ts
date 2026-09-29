// Shared types for the table lane (breadth step 5). Kept in a leaf file so the
// request store (src/ingestion/table-lane-store.ts) and the lane planner can
// both import them without importing each other.
import type { CbsCode, CbsTableSchema } from '../../cbs-adapter/types.ts';
import type { BreakdownQuestion } from '../../query/breakdowns.ts';
import type { TableParseAudit, TableParseResult } from '../table-parse/parse.ts';

/** One accumulated reader answer to a breakdown or region question: the
 * dimension it answers and the member code the reader picked. Codes are
 * always CBS's own (checked against the table's stored dimension_labels by
 * the planner before they are stored or used) — never free text. */
export interface TableLaneChoice {
  dimension: string;
  code: string;
}

/** One CBS table as the table lane plans over it (moved here from plan.ts in
 * fix round 1 so regions.ts and plan.ts do not import each other). */
export interface TableLaneTable {
  /** Live CBS metadata (groupPath included) — fetched by the job. */
  schema: CbsTableSchema;
  /** Same source; period codes carry status. */
  codeLists: Record<string, CbsCode[]>;
}

/** The table lane's present-only envelope key (breadth step 5, Task 3) — set
 * ONLY by respondTableLane (./respond.ts) on the answer, question or refusal
 * it produces; absent on every other envelope and on every row stored before
 * the lane existed (docs/13: readers use `?? null`). Carries no data value:
 * codes, CBS titles, the parse and its audit (principle a — the numbers ride
 * `result` like on every answer). R8: shape-checked by reconstruct.ts
 * checkTableLane (tests/audit/envelope-key-manifest.test.ts). */
export interface TableLaneEnvelope {
  version: 1;
  /** table_lane_requests.id of the row this response answers. */
  rowId: number;
  tableId: string;
  finderConfidence: number;
  /** The validated table-scoped parse; null when validation refused it (or
   * no model call ran). */
  parse: TableParseResult | null;
  /** requestHash, model, usage, raw output (#339 (11)); null only when no
   * model call happened. Mirrored in the row's llm_calls as 'table_parse'. */
  parseAudit: TableParseAudit | null;
  /** sha256 (hex) of serializeTableParseInput's menu part (everything after
   * the question line) — reproducible from the same table metadata. Null
   * when the plan carried no offered menu (a refusal). */
  offeredMenuHash: string | null;
  /** "Selectie: … · Uitgangspunt: …" in the reader's language — rendered by
   * the client under the answer, never part of `text`. Null off the fetch
   * path or when nothing was fixed. */
  selectionNote: string | null;
  /** slice_fetches.filter_key of the stored slice the answer ran over. */
  sliceFilterKey: string | null;
  /** The full button question on a clarification; null otherwise. */
  question: BreakdownQuestion | null;
  /** Settled choice 1: CBS unreachable, answered from a < 24 h cached slice. */
  fromCachedSlice: boolean;
}
