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
  /**
   * The dimension's human title, verbatim from the source (CBS v4
   * Dimensions' `Title`, e.g. `BurgerlijkeStaat` -> 'Burgerlijke staat'; the
   * Eurostat adapter's own JSON-stat dimension `label` when present — see
   * jsonstat.ts). '' when the source has none (never guessed — principle c).
   * NOT part of the schema fingerprint (fingerprint.ts hashes name + kind
   * only, byte-identical before/after this field was added) and NOT stored
   * in `cbs_tables.expected_dimensions` (that column stays {name, kind}
   * only — see pipeline.ts). Breadth step 3, Task 1: feeds the breakdown
   * resolver's stated defaults/button text ("<dimension title>: <member
   * title>", docs/superpowers/plans/2026-09-28-breadth-step-3-breakdown-resolver.md
   * Global Constraints) — never persisted registry state on its own.
   */
  title: string;
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
  /**
   * CBS's own MeasureGroups titles, root -> leaf, verbatim (breadth step 4b,
   * Task 1). Resolved from the measure's `MeasureGroupId` by walking
   * `MeasureGroups`' `ParentId` chain up to the root. `[]` when CBS has no
   * group for the measure, or the table publishes no `MeasureGroups` at all,
   * or a `MeasureGroupId` points at a group CBS never listed (the walk stops
   * at whatever was resolved so far — never guessed, principle c). A
   * `ParentId` cycle stops at the first repeated id rather than looping
   * forever. Distinguishes measures that otherwise share a bare title (e.g.
   * every "Seizoengecorrigeerd" measure in a table like 80590ned) by the
   * group CBS files them under — see src/answer/table-parse for the prompt
   * line this feeds. NOT part of the schema fingerprint (fingerprint.ts
   * hashes measure CODES only) and NEVER persisted: `unitsFromMeasures`
   * (src/ingestion/pipeline.ts) copies named fields only, so `groupPath`
   * never reaches `cbs_tables.units` or any other stored registry state —
   * it is carried in memory for the current parse/prompt-build only. The
   * Eurostat adapter (no measure-groups concept) always sets `[]`.
   */
  groupPath: string[];
}

export interface CbsTableSchema {
  /** Exact as-published table ID — casing preserved (catalog quirk #1). */
  tableId: string;
  title: string;
  dimensions: CbsDimension[];
  measures: CbsMeasure[];
  /**
   * CBS 'Modified' ISO timestamp from the table's own Properties document
   * (breadth step 2, Task 3: `registerSchemaOnly` stores it as
   * `cbs_tables.schema_cbs_modified` — a slice-cache table's ONLY freshness
   * signal, since it has no `syncTable` row-plausibility history to lean on.
   * REQUIRED, not optional (fix round 1, controller ruling): a source with
   * no way to say "this changed" cannot be schema-only registered at all —
   * `registerSchemaOnly` refuses (`no_cbs_modified`) rather than register a
   * table it can never detect staleness for. The v4 adapter and
   * `FixtureSource` fill it from the Properties document they already
   * fetch; the Eurostat adapter (jsonstat.ts) fills it from JSON-stat's own
   * `updated` field when present, `null` otherwise — every `CbsSource`
   * implementation, real or test double, must state one or the other,
   * never omit the field.
   */
  modified: string | null;
  /**
   * Final-review I2 (breadth step 4b fix wave): `true` ONLY when the v4
   * adapter could not fetch (a non-404 failure after its normal retries) or
   * parse the table's MeasureGroups — every measure's `groupPath` is then
   * `[]` for that reason, not because CBS has no groups. Absent otherwise
   * (including the 404 "this table publishes no groups" case, and every
   * FixtureSource / Eurostat schema). In memory only, never stored;
   * ingestion never reads it — groups are never persisted, so they must
   * never fail a sync. buildTableParseSchema (src/answer/table-parse)
   * refuses a flagged table, since the group is what tells same-titled
   * measures apart in its prompt.
   */
  measureGroupsUnavailable?: boolean;
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
  /** Eurostat only (its catalogue file lists them; CBS's does not, so absent there): first and
   * last period the dataset holds, verbatim ('2024', '2026-Q2', '2026-08'), and its value count.
   * null = the catalogue row gave none or an unreadable one. Never mirrored into the database. */
  dataStart?: string | null;
  dataEnd?: string | null;
  valueCount?: number | null;
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
