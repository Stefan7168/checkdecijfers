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
}
