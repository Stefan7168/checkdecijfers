// "Eigen data" attachments tier — pure-leaf types (ADR 037, WP202a).
// PURE LEAF: no SDK/db imports. Imported by web code via
// web/backend/attachments/types.ts (the existing `web/backend -> ../src`
// symlink, ADR 018) exactly like src/websearch/types.ts and src/chart/types.ts.
//
// This module is a SECOND, structurally separate trust tier from the CBS
// answer pipeline (ADR 032's shape, applied end to end — ADR 037 D1). Nothing
// here is a ChartSpec, an AnswerResponse, or a ConversationContext, and
// nothing in this file's types can ever satisfy those schemas — the
// separation is a TYPE-LEVEL guarantee, not a naming convention.
//
// The single most important invariant this file encodes (H1, the owner's
// hard constraint): a `ChartInstruction` can only ever carry SELECTORS
// (column ids, enumerated values, a chart kind) — there is no field capable
// of holding a display value. Deterministic code (execute.ts, chart.ts)
// alone reads a stored cell into a plotted value.

/** Bumped whenever UserChartSpec's shape changes (forces a fixture
 * re-record and a schema-version guard in the renderer) — the ADR 007/014
 * versioning discipline, applied to this tier's own spec type. */
export const USER_CHART_SPEC_VERSION = 1 as const;

/** Bumped whenever DatasetTurnEnvelope's shape changes — the R8-analog
 * envelope stored verbatim in dataset_turns.envelope (D9). */
export const DATASET_TURN_ENVELOPE_VERSION = 1 as const;

/** Rendered on every user-data chart, its legend/footer, and baked into
 * every export — the one line that keeps this tier honest about what it is
 * (D0/D11). Never combined with, or substituted for, the CBS attribution
 * line — a UserChartSpec has no `license`/`attribution` field to combine it
 * with in the first place. English (session-brief §8 Q6, superseded by the
 * later "product copy/UI text is English" decision, open-questions #206 —
 * the original design's Dutch wording is recorded there for history). */
export const USER_DATA_DISCLAIMER = 'User-uploaded data — not verified by checkdecijfers.' as const;

/** Redaction placeholder for a dataset_turns row (D9/D13) — the D9 sentinel,
 * mirroring src/answer/audit/retention.ts's REDACTED_QUESTION_TEXT shape.
 * English, per the same #206 decision. */
export const REDACTED_DATASET_TEXT = '[deleted question]' as const;

export type SourceKind = 'file_csv' | 'file_tsv' | 'file_xlsx' | 'url_html' | 'file_pdf';

export type DatasetStatus = 'ready' | 'needs_decision' | 'failed' | 'redacted';

/** A column id is positional into every row of `cells` (`c0` = index 0,
 * `c1` = index 1, ...) — opaque and stable for the dataset's lifetime (U12:
 * `cells`/`profile` are immutable once `status` first becomes 'ready',
 * except through redaction — a future header-row-correction WP must mint a
 * new row rather than renumber these in place). */
export type ColumnId = string;

export type ColumnType = 'year' | 'date' | 'number' | 'text';

/** How a numeric column's separators were deterministically classified
 * (D5). 'ambiguous' blocks charting on that column until the user answers
 * the profile card's two-chip disambiguation — never guessed (principle c). */
export type NumberFormat = 'nl' | 'en' | 'ambiguous';

/** One column's entry in the closed vocabulary the LLM is ever shown (D6,
 * the R2 analog). `distinct` is present on `text`/`year`/`date` columns
 * (capped, e.g. 50) so an `in` filter has something to validate against —
 * fixed in review: the original draft only gave `text` columns a distinct
 * list, leaving `in` filters on low-cardinality year/date columns nothing
 * to check. A `number` column with high cardinality carries no `distinct`
 * at all — `in` is simply not a legal operator on it (instruct/schema.ts). */
export interface ColumnProfile {
  id: ColumnId;
  /** The file's own header text, verbatim — axis/series labels never
   * reword it (U9). */
  header: string;
  type: ColumnType;
  /** Present on 'number'/'year'/'date' columns; the real range the `between`
   * operator's bounds are checked against. */
  min?: number;
  max?: number;
  /** Present on 'number' columns only, deterministically decided (D5). */
  numberFormat?: NumberFormat;
  /** Present on 'text'/'year'/'date' columns; capped and marked when
   * truncated. The ONLY legal source of `in` filter values. */
  distinct?: string[];
  distinctTruncated?: boolean;
  /** A few raw cell samples (capped length) so the model can recognize the
   * column's shape without seeing the full column. */
  sample?: string[];
  nulls: number;
}

/** Stored on user_datasets.profile — the ONLY dataset content that ever
 * reaches an LLM prompt (D6, the R2 analog). Ranges/samples/distinct lists
 * let the model express filters; nothing here is ever a chart VALUE. */
export interface DatasetProfile {
  columns: ColumnProfile[];
  rowCount: number;
}

export type ChartKind = 'line' | 'bar';

export type FilterClause =
  | { column: ColumnId; op: 'in'; values: string[] }
  | { column: ColumnId; op: 'between'; from: number; to: number };

export type UnsupportedReason =
  | 'aggregation'
  | 'computation'
  | 'compare_with_cbs'
  | 'not_chartable'
  | 'other';

/**
 * The model's WHOLE output surface (D6). SERVER-SIDE / STORED SHAPE ONLY.
 *
 * `reading` and `unsupported.detail` are free Dutch prose, fed in part by
 * untrusted user-controlled CSV headers/cell values (the DatasetProfile) —
 * a live prompt-injection surface. They exist for server-side audit only
 * and MUST NEVER be serialized to any client-facing type — see
 * ClientChartInstruction below, which is the ONLY shape that may reach the
 * browser (fixed in review: this codebase has already rendered the
 * structurally identical field, `RerankResult.reading`/intent
 * `candidate.reading`, verbatim in two places — "never rendered by
 * convention" was found insufficient).
 */
export interface ChartInstruction {
  version: 1;
  kind: ChartKind;
  /** Must be a profile column id — validated by instruct/schema.ts. */
  x: ColumnId;
  /** 1..4 columns of type 'number'|'year' (validated). */
  y: ColumnId[];
  /** A column carrying a `distinct` list → one series per value (cap 8,
   * enforced as a clarification-worthy throw, never silent truncation —
   * D7's "never silent omission" rule, extended in review to this cap too). */
  seriesBy: ColumnId | null;
  filters: FilterClause[];
  /** Bar charts only; ignored (not an error) on a line chart, which always
   * orders by x ascending. */
  sort: { by: 'x' | ColumnId; direction: 'asc' | 'desc' } | null;
  /** Top-N after sort, 1..50. */
  limit: number | null;
  /** 0..1; the threshold is applied by deterministic code (the R7 analog),
   * never by the model itself. */
  confidence: number;
  /** SERVER-SIDE AUDIT ONLY — see the file-header note. Never leaves the
   * server via any client-facing type. */
  reading: string;
  unsupported: null | { reason: UnsupportedReason; detail: string };
}

/**
 * The ONLY shape that ever reaches the browser or round-trips as client
 * state (`rawState`/`lastInstruction`, D8 step 2). Cuts `reading`,
 * `confidence`, and `unsupported.detail` — there is no code path for them
 * to reach web/ at all, because web/ never receives the full
 * ChartInstruction (fixed in review — see the file-header note and D6).
 * `dataset_turns.instruction` (the DB column) and the envelope's own
 * `instruction` field store the FULL ChartInstruction; this narrower type
 * is derived from it server-side before `state.lastInstruction` is
 * populated.
 */
export type ClientChartInstruction = Omit<ChartInstruction, 'reading' | 'confidence' | 'unsupported'> & {
  unsupported: null | { reason: UnsupportedReason };
};

/** Strips the server-only fields — the ONLY place a ChartInstruction is
 * narrowed to ClientChartInstruction, so there is exactly one code path to
 * audit for the H1/U3 guarantee. */
export function toClientInstruction(instruction: ChartInstruction): ClientChartInstruction {
  return {
    version: instruction.version,
    kind: instruction.kind,
    x: instruction.x,
    y: instruction.y,
    seriesBy: instruction.seriesBy,
    filters: instruction.filters,
    sort: instruction.sort,
    limit: instruction.limit,
    unsupported: instruction.unsupported === null ? null : { reason: instruction.unsupported.reason },
  };
}

/**
 * The inverse of toClientInstruction, used ONLY to revalidate a
 * client-held `rawState.lastInstruction` (D8 step 2) through the existing
 * `validateInstruction` allowlist without duplicating its logic. Fills the
 * server-only fields with harmless placeholders (`reading: ''`,
 * `confidence: 1`, `unsupported.detail: ''`) that satisfy the schema's
 * shape but play no role in the allowlist/range checks — those checks
 * only ever inspect the fields ClientChartInstruction already carries.
 * Never used to reconstruct a value a user could see; the revived
 * `reading`/`detail` are immediately discarded by the next
 * toClientInstruction call in the turn's own response.
 */
export function reviveClientInstruction(client: ClientChartInstruction): ChartInstruction {
  return {
    version: client.version,
    kind: client.kind,
    x: client.x,
    y: client.y,
    seriesBy: client.seriesBy,
    filters: client.filters,
    sort: client.sort,
    limit: client.limit,
    confidence: 1,
    reading: '',
    unsupported: client.unsupported === null ? null : { reason: client.unsupported.reason, detail: '' },
  };
}

/** Why a plotted point is null — the R11 analog: a gap is shown, never
 * silently omitted (U11). */
export type MissingValueReason = 'leeg in bron' | 'geen getal';

/** One plotted value — a projection of exactly one stored cell, traced by
 * `rowRef` (D7 point 3, U1's own traceability handle). `rowRef` format:
 * `r{rowIndex}:c{colIndex}`, both 0-based positional indices into the
 * dataset's own `cells` array (row 0 IS the header row — see execute.ts for
 * the exact indexing this refers to). */
export interface UserChartPoint {
  rowRef: string;
  xKey: string;
  /** The x cell's own raw text, verbatim (U9 — never reworded). */
  xLabel: string;
  value: number | null;
  /** Built by the shared src/answer/compose/format.ts formatValueNl — the
   * SAME formatter CBS answers use, so display never rounds or reformats
   * beyond localisation (R3/R10 analog). Null exactly when value is null. */
  formattedValue: string | null;
  /** The raw, unparsed cell text — kept so a renderer/export can show
   * exactly what the file said, even for a null/unparseable value. */
  sourceText: string;
  reason?: MissingValueReason;
}

export interface UserChartSeries {
  /** The seriesBy column's distinct value this series represents, or the
   * y-column's own header when there is no seriesBy. */
  label: string;
  points: UserChartPoint[];
}

/** H2: distinguishes this chart from a CBS ChartSpec at the TYPE level, not
 * just visually. `chartSpecSchema` (src/chart/schema.ts) is a strictObject
 * with no `origin`/`trust`/`provenance` fields and DOES have
 * `attribution`/`license` — a UserChartSpec cannot parse as a ChartSpec, and
 * ChartView refuses it outright (D11). */
export interface UserChartProvenance {
  datasetId: number;
  sourceKind: SourceKind;
  displayName: string;
  sourceUrlHost: string | null;
  capturedAt: string;
  contentSha256: string;
}

export interface UserChartSpec {
  schemaVersion: typeof USER_CHART_SPEC_VERSION;
  origin: 'user_dataset';
  trust: 'unverified';
  kind: ChartKind;
  /** The file's own header text, verbatim (U9/U10 — units are never
   * inferred; a header like "Omzet (x 1.000 euro)" is shown as-is). */
  xHeader: string;
  yHeaders: string[];
  series: UserChartSeries[];
  provenance: UserChartProvenance;
  disclaimerLine: typeof USER_DATA_DISCLAIMER;
}

/** The DB row shape execute.ts/chart.ts operate over — a pure-leaf
 * projection of user_datasets, no SQL/db import required to use it. */
export interface UserDataset {
  id: number;
  userId: string;
  sourceKind: SourceKind;
  displayName: string;
  sourceUrl: string | null;
  cells: string[][];
  profile: DatasetProfile;
  status: DatasetStatus;
  contentSha256: string;
  createdAt: string;
}

/**
 * Stored verbatim in dataset_turns.envelope — the R8 analog for this tier
 * (D9). `instruction` here is the FULL server-side ChartInstruction (fine —
 * it never leaves the server from this field, which lives only in the DB
 * row). `state.lastInstruction` is DIFFERENT: it is what round-trips to the
 * browser as `rawState` for the next turn, so it is typed as the narrow
 * ClientChartInstruction.
 */
export type DatasetTurnEnvelope =
  | {
      schemaVersion: typeof DATASET_TURN_ENVELOPE_VERSION;
      kind: 'chart';
      question: string;
      /** Deterministic template output — never LLM prose (D8 step 5). */
      text: string;
      instruction: ChartInstruction;
      chart: UserChartSpec;
      state: { datasetId: number; lastInstruction: ClientChartInstruction };
    }
  | {
      schemaVersion: typeof DATASET_TURN_ENVELOPE_VERSION;
      kind: 'clarification';
      question: string;
      text: string;
      options: string[];
      instruction: ChartInstruction | null;
      reason: 'low_confidence' | 'validation' | 'ambiguous_format' | 'zero_rows';
    }
  | {
      schemaVersion: typeof DATASET_TURN_ENVELOPE_VERSION;
      kind: 'refusal';
      question: string;
      text: string;
      // Fixed while building respond.ts: widened to the full UnsupportedReason
      // set ('computation'/'other' were missing) plus this tier's own
      // execution-level reasons — a refusal built from a validated
      // instruction's `unsupported` field must always have a home here.
      reason:
        | 'aggregation'
        | 'computation'
        | 'compare_with_cbs'
        | 'not_chartable'
        | 'other'
        | 'too_many_points'
        | 'export_hint'
        | 'empty_question'
        | 'internal';
      guidance: string | null;
    };

/** The D9 redaction sentinel — mirrors src/answer/audit/retention.ts's
 * redactedResponse() shape exactly, one field renamed for this tier. */
export interface RedactedDatasetEnvelope {
  schemaVersion: typeof DATASET_TURN_ENVELOPE_VERSION;
  kind: DatasetTurnEnvelope['kind'];
  question: typeof REDACTED_DATASET_TEXT;
  text: typeof REDACTED_DATASET_TEXT;
  redacted: true;
}

export function redactedDatasetEnvelope(kind: DatasetTurnEnvelope['kind']): RedactedDatasetEnvelope {
  return {
    schemaVersion: DATASET_TURN_ENVELOPE_VERSION,
    kind,
    question: REDACTED_DATASET_TEXT,
    text: REDACTED_DATASET_TEXT,
    redacted: true,
  };
}
