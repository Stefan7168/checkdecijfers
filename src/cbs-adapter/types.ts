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
}

export interface CbsSource {
  fetchTableSchema(tableId: string): Promise<CbsTableSchema>;
  /** Code list for one dimension, e.g. fetchCodeList('03759ned', 'RegioS'). */
  fetchCodeList(tableId: string, dimension: string): Promise<CbsCode[]>;
  /** Observations page by page, server-side filtered to the slice when given. */
  fetchObservations(tableId: string, slice?: CbsSlice): AsyncIterable<CbsObservationRow[]>;
  /**
   * The full CBS dataset catalog (metadata only), for table discovery (WP16).
   * Bulk-refreshed on a schedule into our own DB and searched locally — never
   * called on the request path (principle b / ADR 003). e.g. fetchCatalog()
   * → [{ tableId: '85773NED', title: 'Bestaande koopwoningen; …', … }].
   */
  fetchCatalog(): Promise<CbsCatalogEntry[]>;
}
