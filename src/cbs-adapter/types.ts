// CbsSource — the single seam through which all CBS contact happens (ADR 003).
// Exactly one live implementation (OData v4); the fixture implementation replays
// captured raw v4 responses through the same parsing code, so tests exercise the
// real wire shapes. No module outside this directory may know CBS URL shapes.

/** Dimension kinds as published by the v4 API (measured 2026-07-02). */
export type CbsDimensionKind = 'Dimension' | 'TimeDimension' | 'GeoDimension';

export interface CbsDimension {
  /** Exact identifier, e.g. 'RegioS', 'Perioden', 'Geslacht'. */
  name: string;
  kind: CbsDimensionKind;
}

export interface CbsMeasure {
  /** Exact identifier, e.g. 'M000352'. */
  code: string;
  title: string;
  unit: string;
  decimals: number;
  /** CBS 'Description' — the full definition blurb for this measure, verbatim;
   * '' when CBS omits it. Carried so an on-demand-onboarded measure can show a
   * REAL definition (its meaning, its scale) instead of only its short title
   * (#115 lever b). NEVER rewritten — CBS's own words or nothing (principle a,
   * R10 spirit). */
  description: string;
  /** CBS 'DataType' from MeasureCodes ('Double' | 'Long' | 'String' | …); ''
   * when CBS omits it. A text measure carries 'String' — never registered as
   * servable (breadth step 2 constraints: text measures like `code`, `naam`,
   * `omschrijving` are excluded from ingestion). */
  dataType: string;
}

export interface CbsTableSchema {
  /** Exact as-published table ID — casing preserved (catalog quirk #1). */
  tableId: string;
  title: string;
  dimensions: CbsDimension[];
  measures: CbsMeasure[];
}

export interface CbsCode {
  /** Trimmed identifier (catalog quirk #2: v3 codes can carry padding). */
  code: string;
  title: string;
  dimensionGroup: string | null;
  /** Period status (Definitief/Voorlopig/NaderVoorlopig) — only on Perioden codes. */
  status: string | null;
  index: number | null;
  /**
   * CBS 'Description' — verbatim, present ONLY when non-empty after trim (so
   * every existing parsed-code equality stays unchanged for tables that don't
   * use it). On a Perioden code with `status: null`, some tables (70072ned)
   * carry the publication status here as PROSE instead of a machine field
   * ("Uitkomsten zijn voorlopig over: ...") — read by
   * `src/ingestion/period-note-status.ts` (Task 3a, R11, #251 hook), never by
   * anything else.
   */
  description?: string;
}

/**
 * Ingested slice of a table (docs/07-phase0-table-set.md, "Registered slices").
 * Also the registry's record of what is loaded, so refusal wording can
 * distinguish "outside the loaded slice" from "not published by CBS".
 */
export interface CbsSlice {
  /** Exact-coordinate pins, e.g. { Geslacht: 'T001038' }. */
  dimensionEquals?: Record<string, string>;
  /** Prefix pins, e.g. { RegioS: ['NL', 'PV', 'GM'] }. */
  dimensionPrefixes?: Record<string, string[]>;
  /** Inclusive period floor, e.g. '2019JJ00' (lexicographic on CBS codes). */
  periodFloor?: string;
  /** Measure allow-list (exact CBS measure codes). Absent or empty = every
   * measure. When set, ingestion scopes registration units, the served
   * measure set and the schema fingerprint to these codes (ADR 061), so a CBS
   * revision of an UNLISTED code in a wide table (70072ned: 248 codes) no
   * longer quarantines it, while a change to a listed code still fails loudly.
   * CBS-only: the Eurostat adapter refuses it. */
  measures?: string[];
  /** Several allowed codes per dimension (breadth step 2): `(Dim eq 'a' or
   * Dim eq 'b')`, ANDed with everything else, appended AFTER every existing
   * clause so every already-registered slice's filter string is unchanged.
   * An empty array for a dimension adds no clause (never "match nothing").
   * CBS-only: the Eurostat adapter refuses it. */
  dimensionIn?: Record<string, string[]>;
  /** Exact period codes (breadth step 2): `(Perioden eq 'x' or …)`, appended
   * LAST (after `dimensionIn`). `dimension` is the table's own TimeDimension
   * name (usually 'Perioden'), passed by the caller — this type has no way to
   * know it on its own. An empty `codes` array adds no clause. CBS-only: the
   * Eurostat adapter refuses it. */
  periodIn?: { dimension: string; codes: string[] };
}

/**
 * One CBS catalog entry — a table CBS publishes, metadata only (no observation
 * cells). Fetched in bulk for table discovery (WP16), never per question. The
 * fields are exactly what the v4 Datasets listing carries (measured 2026-07-05).
 */
export interface CbsCatalogEntry {
  /**
   * The as-published v4 Identifier. Verified to BE the id the data endpoints
   * require (Properties/85773NED → 200, /85773 → 404), so it can feed the
   * ingestion pipeline directly. Casing is load-bearing (quirk #1) — verbatim,
   * never normalized.
   */
  tableId: string;
  title: string;
  /** CBS 'Description' — the full blurb; may be empty. */
  summary: string;
  /** CBS 'Status': 'Regulier' | 'Gediscontinueerd' | 'Vervallen' | …; null if absent. */
  status: string | null;
  /** CBS 'DatasetType': 'Numeric' | 'Mixed' | 'Text' | …; null if absent. */
  datasetType: string | null;
  /** CBS 'Language' — 'nl' for the CBS catalog; null if absent. */
  language: string | null;
  /** CBS 'Modified' ISO timestamp (when CBS last changed the dataset), or null. */
  modified: string | null;
}

/** One observation as fetched — codes trimmed, otherwise verbatim from CBS. */
export interface CbsObservationRow {
  measure: string;
  /** Coordinate per dimension name (region and period included, untyped here). */
  coordinates: Record<string, string>;
  value: number | null;
  /** CBS ValueAttribute: 'None' for plain values, otherwise the cell/null reason. */
  valueAttribute: string;
  /** Non-numeric payload; unexpected for the Phase 0 set, must fail loudly. */
  stringValue: string | null;
  /**
   * #251 (session 109): OPTIONAL per-CELL publication status — the narrow
   * waist's one path for a source whose statuses are NOT a property of the
   * period.
   *
   * ABSENT (the CBS shape, and the default): the ingestion pipeline derives
   * `observations.status` from the per-PERIOD-code lookup it always has
   * (`periodStatusByCode`, built from the time dimension's own code list).
   * The CBS adapter never sets this field — every CBS cell in a period
   * genuinely shares one CBS status (Definitief / Voorlopig /
   * NaderVoorlopig), so the per-period derivation is the honest one and
   * stays byte-identical (pinned by test in tests/ingestion/ingestion.test.ts).
   *
   * PRESENT: this verbatim string becomes the cell's `observations.status`
   * INSTEAD of the period status. It is what `isProvisionalStatus` (R11)
   * reads, so a source setting it must guarantee the value is definitive
   * ONLY when the source really says so — Eurostat's JSON-stat per-cell
   * flags (ADR 048 D6 + its #251 addendum) are the first user. An empty /
   * whitespace-only string is rejected loudly by the pipeline: omit the
   * field rather than sending a blank one (principle (c) — never guess).
   */
  status?: string;
}

export interface CbsSource {
  /**
   * Optional `slice`, added for the Eurostat E2a step-5 fix (2026-09-23):
   * a Eurostat dataset's own JSON-stat document carries schema AND
   * observations together, so a schema fetch on an unfiltered request can
   * hit the same 500k-cell synchronous cap `fetchObservations` does — the
   * caller (registration/sync, `src/ingestion/pipeline.ts`) passes the
   * table's OWN registered slice through here so the schema/code-list read
   * uses the SAME server-side-filtered request `fetchObservations` does
   * (one underlying fetch for all three, where an adapter caches per
   * (tableId, slice) — see `StatisticsApiSource.loadDataset`). CBS's own
   * adapter implementations (four genuinely separate, slice-independent
   * endpoints) simply ignore this parameter — passing it changes nothing
   * for CBS, so its registration/sync stays byte-identical.
   */
  fetchTableSchema(tableId: string, slice?: CbsSlice): Promise<CbsTableSchema>;
  /** Code list for one dimension, e.g. fetchCodeList('03759ned', 'RegioS').
   * `slice` — see `fetchTableSchema`'s doc comment above; same rationale. */
  fetchCodeList(tableId: string, dimension: string, slice?: CbsSlice): Promise<CbsCode[]>;
  /** Observations page by page, server-side filtered to the slice when given.
   * #156 (session-47 ingestion hunt): `dimensionNames` lets a caller that has
   * ALREADY fetched + validated the schema (the ingestion pipeline) hand the
   * dimension names in, so the adapter parses observations against the SAME
   * validated dimension set instead of re-fetching /Dimensions independently (a
   * redundant HTTP call and a TOCTOU: two live fetches could disagree). Omitted
   * ⇒ the adapter fetches them itself (the standalone/harness path), unchanged. */
  fetchObservations(
    tableId: string,
    slice?: CbsSlice,
    dimensionNames?: string[],
  ): AsyncIterable<CbsObservationRow[]>;
  /**
   * Total observation-cell count for a table (WP16 sub-part 2, ADR 026, slice
   * estimation §4). Returns null when the count cannot be determined (v4
   * $count 404/error, or a fixture that did not capture a row count) — the
   * caller then falls back to the dimension-cardinality product estimate.
   * Never throws for a plain "count unavailable"; a real network failure on
   * the LIVE source still throws (the caller's job wraps the whole attempt).
   */
  fetchObservationCount(tableId: string): Promise<number | null>;
  /**
   * The full CBS dataset catalog (metadata only), for table discovery (WP16).
   * Bulk-refreshed on a schedule into our own DB and searched locally — never
   * called on the request path (principle b / ADR 003). e.g. fetchCatalog()
   * → [{ tableId: '85773NED', title: 'Bestaande koopwoningen; …', … }].
   */
  fetchCatalog(): Promise<CbsCatalogEntry[]>;
}
