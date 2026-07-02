// Registry work package contract: cbs_tables.default_coordinates/.period_semantics
// (existing nullable columns, migration 001) and canonical_measures (migration 002).
// Behavior spec: docs/05-data-rules.md (canonical defaults, R7) and ADR 010.

/** Per-table "totaal" coordinate for dimensions incidental to every question on
 * that table (e.g. population's Geslacht/Leeftijd) — not a semantic choice. */
export type DefaultCoordinates = Record<string, string>;

/** Per-grain description of what a period code means for this table
 * (docs/05-data-rules.md: "a population table's 2025JJ00 means stand per 1
 * januari while CPI's means jaargemiddelde"). Keyed by period_grain. */
export type PeriodSemantics = Record<string, string>;

export interface TableRegistryDefaults {
  tableId: string;
  defaultCoordinates: DefaultCoordinates;
  periodSemantics: PeriodSemantics;
}

export interface CanonicalMeasureAlternate {
  /** Present when the alternate differs by measure code, e.g. B6's Eindstand. */
  measure?: string;
  /** Present when the alternate differs by dimension coordinate(s). */
  dims?: Record<string, string>;
  label: string;
}

export interface CanonicalMeasure {
  /** Stable concept key — the schema-validated vocabulary a future intent
   * parser selects from. Not a raw Dutch string matched against user input. */
  key: string;
  tableId: string;
  measure: string;
  measureTitle: string;
  /** Semantic (non-totaal) dimension coordinates that define this concept. */
  dims: Record<string, string>;
  definitionLabel: string;
  everydayTerms: string[];
  alternates?: CanonicalMeasureAlternate[];
  notes?: string;
}
