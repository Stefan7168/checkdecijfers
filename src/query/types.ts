// Query work package (WP5) contract — docs/08-build-plan.md.
//
// StructuredIntent is the INPUT contract: the typed object the WP6 intent
// parser must emit. Because the deterministic layer is built first (build-plan
// sequencing note), this file FIXES that contract — WP6 targets it, not the
// other way around. Keep it minimal-but-sufficient for benchmark tasks B1-B14;
// extensions get their own schema version.
//
// ValidatedResult / QueryRefusal are the OUTPUT: either a fully validated,
// attributed result whose every number is traceable (R1), or a typed refusal —
// never a guessed value (principle c). Invariants served here: R1, R4, R5,
// R9, R10, R11 (docs/05-data-rules.md).

export const INTENT_SCHEMA_VERSION = 1 as const;
export const RESULT_SCHEMA_VERSION = 1 as const;

export type PeriodGrain = 'JJ' | 'KW' | 'MM';

/** What to measure: a canonical_measures key (the registry's alias list,
 * ADR 010) or an explicit table + measure + semantic dims. The intent parser
 * emits `canonical` for everyday terms (the registry supplies the pinned
 * definition, stated transparently per R7) and `explicit` only when the user
 * names a specific alternate reading. Canonical targets take no dim
 * overrides — overriding the definition IS choosing an alternate, which must
 * be explicit. */
export type IntentTarget =
  | { kind: 'canonical'; key: string }
  | { kind: 'explicit'; tableId: string; measure: string; dims?: Record<string, string> };

/** Period selection: explicit CBS period code(s), or an inclusive range whose
 * endpoints share one grain. Multiple codes express derivation sources (B13's
 * two years); a range expresses a series (B4, B8). */
export type IntentPeriod =
  | { kind: 'codes'; codes: string[] }
  | { kind: 'range'; from: string; to: string };

/** The registered-derivation vocabulary (R5). `none` = plain lookup;
 * `difference` = exactly two periods, one coordinate (B13); `max` = one
 * period, several regions (B14); `series` = explicit trend request over a
 * multi-period selection (B4/B8). Every kind maps to a registered function in
 * derivations.ts — there is no free-form computation. */
export type IntentDerivation = 'none' | 'difference' | 'max' | 'series';

export interface StructuredIntent {
  schemaVersion: typeof INTENT_SCHEMA_VERSION;
  target: IntentTarget;
  /** CBS region codes on the table's geo dimension. Required (non-empty) when
   * the table has a geo dimension — a missing region on a geo table is a
   * user-facing ambiguity and refuses to clarification, never defaults.
   * Must be omitted/empty for tables without one. */
  regions?: string[];
  period: IntentPeriod;
  derivation: IntentDerivation;
}

// ---------------------------------------------------------------------------
// Output: validated results
// ---------------------------------------------------------------------------

/** One database cell, with everything an answer needs to bind it correctly:
 * value + unit + decimals (R10), CBS status + null-reason (R11), and the full
 * labeled coordinate set (R9 semantic binding). */
export interface ResultCell {
  /** Deterministic coordinate id — R1's traceability handle. Built from the
   * natural key (table:measure:region:period:dims), so it is stable across
   * re-ingests and self-describing, unlike a database row id. Version pinning
   * comes from batchId + Attribution.tableVersion. */
  resultId: string;
  tableId: string;
  measure: string;
  measureTitle: string;
  regionCode: string | null;
  regionLabel: string | null;
  periodCode: string;
  periodLabel: string;
  grain: PeriodGrain;
  /** Non-geo, non-period coordinates this value sits at (e.g. seasonal
   * adjustment), with their Dutch labels — the R9 binding targets. */
  dims: Record<string, string>;
  dimLabels: Record<string, string>;
  /** Null only with a CBS reason in valueAttribute (ingestion guarantees it). */
  value: number | null;
  unit: string;
  decimals: number;
  /** CBS publication status: Definitief / Voorlopig / NaderVoorlopig. */
  status: string;
  /** True when status is not Definitief — the R11 "voorlopig cijfer" flag. */
  provisional: boolean;
  /** CBS ValueAttribute: 'None' for plain values, else the cell/null reason. */
  valueAttribute: string;
  batchId: number;
}

export const DERIVED_DATA_MARKING = 'bewerking van CBS-gegevens door checkdecijfers.nl' as const;

interface DerivationBase {
  /** True when the intent asked for this derivation (its value is the
   * answer's headline number); false for the automatically pre-registered
   * series/comparison derivations that exist so honest trend and ranking
   * sentences have something to bind to (R9). */
  explicit: boolean;
  /** The source cells, always (R5). */
  sourceResultIds: string[];
  unit: string;
  /** CC BY derived-data marking (docs/05): must render whenever this
   * derivation's value appears in an answer. */
  marking: typeof DERIVED_DATA_MARKING;
}

/** Derived values exist only as these records, produced by the registered
 * functions in derivations.ts (R5). Any numeric field below is a legitimate
 * derivation output R1's scan may accept. */
export type DerivationRecord =
  | (DerivationBase & {
      kind: 'difference';
      /** later period value minus earlier period value */
      value: number;
      minuendResultId: string;
      subtrahendResultId: string;
    })
  | (DerivationBase & {
      kind: 'max';
      value: number;
      winnerResultId: string;
      /** All source cells ordered by value, descending — backs ranking and
       * "more than" statements over the full set. */
      rankingResultIds: string[];
    })
  | (DerivationBase & {
      kind: 'direction';
      direction: 'up' | 'down' | 'flat';
      /** True when every step moves the same way (or is flat); a non-monotonic
       * series rose AND fell — phrasing may not claim a straight trend. */
      monotonic: boolean;
      /** last value minus first value */
      netChange: number;
      firstResultId: string;
      lastResultId: string;
    })
  | (DerivationBase & {
      kind: 'first_last';
      firstResultId: string;
      lastResultId: string;
    })
  | (DerivationBase & {
      /** Pure numeric factor units ('x 1 000', 'x 1000'): the exact expanded
       * figure shown ALONGSIDE the verbatim CBS notation — the owner-decided
       * "uitgerekend erbij" display (#125a, ADR 031). One record per source
       * cell; `unit` is 'aantal' (the expansion is a bare count — the verbatim
       * factor string next to the SOURCE value stays R10-enforced, unchanged).
       * Never explicit; never serialized into the phrasing payload (D3). */
      kind: 'unit_expansion';
      /** The unit's numeric factor, as a positive integer. */
      factor: number;
      /** source cell value × factor, exact (integer-scaled, never float
       * multiplication) and integer-valued by construction (ADR 031 D1). */
      value: number;
    });

/** R4: what every answer must display, carried in the result so no rendering
 * path can drop it. */
export interface Attribution {
  tableId: string;
  tableTitle: string;
  tableVersion: number;
  /** Our last successful sync of this table (ISO timestamp). */
  syncedAt: string;
  /** The period span the cells cover, as CBS codes (equal for single-period). */
  coveredPeriods: { from: string; to: string };
  license: 'CC BY 4.0';
  /** The chosen canonical definition, always stated when a canonical target
   * was used ("werkloosheidspercentage, seizoengecorrigeerd") — the R7
   * transparent-default policy. Null for explicit targets. */
  definitionLabel: string | null;
  /** The FULL verbatim CBS definition of the measure (its meaning + any scale),
   * shown as the answer's "Definitie:" line. Populated only for on-demand-
   * onboarded measures whose CBS blurb was captured (#115 lever b); null for the
   * curated Phase-0 set and explicit targets, whose short definitionLabel already
   * reads as its own definition. */
  definitionText: string | null;
  /** What a period code means for this table + grain (registry
   * period_semantics: stand per 1 januari vs. jaargemiddelde). */
  periodSemantics: string | null;
}

export type ResultShape = 'single' | 'series' | 'comparison' | 'derived';

export interface ValidatedResult {
  ok: true;
  schemaVersion: typeof RESULT_SCHEMA_VERSION;
  shape: ResultShape;
  /** Ordered: by period ascending, then by the intent's region order. */
  cells: ResultCell[];
  derivations: DerivationRecord[];
  attribution: Attribution;
  /** The intent this result answers — echoed for the audit record (R8, WP10). */
  intent: StructuredIntent;
}

// ---------------------------------------------------------------------------
// Output: typed refusals (principle c — refuse, don't guess)
// ---------------------------------------------------------------------------

export type RefusalKind =
  /** Structurally invalid intent: unknown canonical key, malformed or
   * mixed-grain period codes, derivation arity that can never be satisfied,
   * regions on a region-less table, unknown dimension coordinates. */
  | 'invalid_intent'
  /** A user-facing axis is unresolved (e.g. no region on a geo table) —
   * exits to clarification (WP6/WP9), never a silent default. */
  | 'needs_clarification'
  /** Explicit target names a table not in the registry. */
  | 'table_not_registered'
  /** Table is quarantined (needs_review) — out of scope, never served. */
  | 'table_quarantined'
  /** CBS publishes this, but it is outside our ingested slice
   * (docs/05: must be distinguished from not-published). */
  | 'outside_loaded_slice'
  /** CBS never published this period/coordinate for this table. */
  | 'not_published'
  /** Requested period lies beyond the freshest available period —
   * the refusal offers what we CAN serve (B20). */
  | 'freshness'
  /** Cell absent for a reason none of the above explain — a loud data gap,
   * never silently skipped. */
  | 'no_data'
  /** A registered derivation refused its inputs (arity, null cells, unit
   * mix) — the lookup succeeded but the computation cannot be honest. */
  | 'derivation_failed'
  /** Cells that must agree (units across one measure) don't — suspected
   * ingestion corruption; refuse loudly rather than serve. */
  | 'internal_inconsistency';

export interface FreshnessInfo {
  /** Freshest period we can serve for these exact coordinates, any status —
   * offered period + status only, never a value: a refusal carries no
   * numbers (open-questions #37 policy, R11 status marking). */
  freshestAvailable: { periodCode: string; status: string } | null;
  /** Freshest Definitief period, as the secondary reference (#37). */
  freshestDefinitief: { periodCode: string } | null;
}

export interface QueryRefusal {
  ok: false;
  refusal: {
    kind: RefusalKind;
    /** Which intent axis failed, when one can be named. */
    axis?: 'measure' | 'region' | 'period' | 'derivation';
    /** For needs_clarification: EVERY unresolved axis, together — docs/05's
     * failure table requires the one clarification round to cover all axes
     * at once, so the answer layer (WP9) must see the full list, not the
     * first one hit. */
    axes?: ('measure' | 'region' | 'period' | 'derivation')[];
    /** Owner-readable English summary (internal; user-facing Dutch phrasing
     * is the answer layer's job, WP7/WP9). */
    message: string;
    /** For freshness refusals: what we can serve instead. */
    freshness?: FreshnessInfo;
    /** For scope refusals: the nearest answerable alternative, as a CBS code
     * (e.g. the loaded slice's period floor). */
    nearestAlternative?: string;
  };
  intent: StructuredIntent;
}

export type QueryOutcome = ValidatedResult | QueryRefusal;
