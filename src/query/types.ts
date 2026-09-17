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

/** #253: a region CLASS, as opposed to an explicit list of region codes. The
 * class is a NAME here, never a list — the roster it stands for is read from
 * CBS's own dimension groups per table at resolve time
 * (src/query/region-set.ts), so no layer above the database ever enumerates
 * region codes (principle (a), ADR 012 decision 1). `parent` is a CBS province
 * code (e.g. 'PV26'). */
export type RegionScope =
  | { kind: 'all_provincies' }
  | { kind: 'all_landsdelen' }
  | { kind: 'all_gemeenten' }
  | { kind: 'gemeenten_in_provincie'; parent: string };

export interface StructuredIntent {
  schemaVersion: typeof INTENT_SCHEMA_VERSION;
  target: IntentTarget;
  /** CBS region codes on the table's geo dimension. Required (non-empty) when
   * the table has a geo dimension — a missing region on a geo table is a
   * user-facing ambiguity and refuses to clarification, never defaults.
   * Must be omitted/empty for tables without one. */
  regions?: string[];
  /** #253: a region CLASS instead of an explicit list — "alle provincies",
   * "de gemeenten in Utrecht". Mutually exclusive with `regions`; the roster
   * it stands for is read from the table's own CBS dimension groups at
   * resolve time (src/query/region-set.ts), never enumerated by a caller.
   *
   * ADDITIVE and PRESENT-ONLY (docs/13-envelope-presence-grammar.md): every
   * intent stored before #253 carries no key at all, which is exactly why
   * INTENT_SCHEMA_VERSION is NOT bumped — a bump would invalidate every live
   * embed token (src/chart/embed-live.ts) and every in-flight pending
   * clarification (src/answer/respond/validate-pending.ts). Readers use
   * `?? undefined`, never a bare truthiness assumption about its presence. */
  regionSet?: RegionScope;
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

/** R5's single true-by-construction "is this result derived, so must it show
 * DERIVED_DATA_MARKING?" predicate. Every marking-line call site (compose.ts,
 * audit/reconstruct.ts — which must byte-match compose.ts per R8 —
 * citation.ts, and the answer-proof panel) calls this instead of repeating
 * `derivations.length > 0`, so the rule cannot silently diverge across
 * surfaces the way it did before open-questions #79's follow-up. csv.ts's
 * `exportableDerivations` answers a different, narrower question — which
 * derivations get a numbered row in the CSV's own data table — and stays
 * separate; its marking-line decision (whether to show "Bewerking: ..." at
 * all) uses this predicate too. */
export function isDerivedResult(result: { derivations: DerivationRecord[] }): boolean {
  return result.derivations.length > 0;
}

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
    })
  | (DerivationBase & {
      /** ADR 052 (#254's level-vs-%-change gap): period-over-period percent
       * change — (current − previous) / previous × 100, rounded to 1
       * decimal — between two ADJACENT cells in a period-ordered,
       * single-region, single-grain, gap-free series (never a skipped-ahead
       * comparison; "adjacent" is grain-relative: month-over-month for
       * monthly data, year-over-year for yearly). Computed only by
       * `derivePeriodChangeSeries` (src/query/derivations.ts), which refuses
       * the WHOLE series rather than emit one record on a null source cell,
       * an irregular/mixed-grain gap, or a zero/negative previous-period
       * base (principle c — a percentage from a non-positive base can be
       * misleading, not just occasionally wrong). Never explicit: nothing in
       * today's intent vocabulary asks for this directly (ADR 052
       * Alternatives) — it exists only as a chart alternate-reading built by
       * src/chart/period-change.ts over an already-answered primary series,
       * the same "toggle an already-delivered reading" shape ADR 051 uses,
       * never a second query. */
      kind: 'period_change';
      value: number;
      previousResultId: string;
      currentResultId: string;
    });

/** #39: one non-chosen alternate reading of a canonical measure — the
 * registry's own record (canonical_measures.alternates) carried onto the
 * result so the answer can STATE that the alternate exists (owner policy,
 * 2026-07-04: never silently pick a definition). Mirrors the registry shape
 * (src/registry/types.ts CanonicalMeasureAlternate) so the later #89 UI
 * affordance has the full coordinates to build from, not just a label. */
export interface AttributionAlternate {
  /** Present when the alternate differs by measure code. */
  measure?: string;
  /** Present when the alternate differs by dimension coordinate(s). */
  dims?: Record<string, string>;
  label: string;
  /** #254(a), ADR 052 session 110 addendum: mirrors registry/types.ts's
   * CanonicalMeasureAlternate.periodChangeEligible — carried through
   * unchanged from canonical_measures.alternates (resolve.ts reads the JSONB
   * column as-is, no reconstruction). When true, src/answer/respond/
   * respond.ts also offers a period-over-period %-change reading of THIS
   * alternate's own built result, alongside its plain toggle entry. */
  periodChangeEligible?: true;
}

/** R4: what every answer must display, carried in the result so no rendering
 * path can drop it. */
export interface Attribution {
  tableId: string;
  tableTitle: string;
  tableVersion: number;
  /** WP30a (ADR 030 D3): the source-registry KEY ('cbs'). OPTIONAL and
   * additive: audit rows stored before WP30a carry no key at all, and every
   * consumer resolves via resolveSource(), whose absent→'cbs' fallback (A1)
   * keeps those rows re-deriving byte-identically forever (R8). */
  source?: string;
  /** WP30c D7(a), ADR 048: the source's DOI for this table, when it has one.
   * OPTIONAL and additive: absent for every pre-Eurostat stored envelope and
   * for every CBS table (no DOI concept), and for a Eurostat row whose DOI
   * was never captured — buildAttributionLine renders the DOI clause only
   * when present, never throwing on its absence (R8). */
  doi?: string;
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
  /** #39: the registry-recorded alternate readings of the chosen canonical
   * default, so the answer can state that a non-chosen reading exists (owner
   * policy 2026-07-04 — never silently pick a definition). PRESENT-ONLY
   * (docs/13-envelope-presence-grammar.md): absent on explicit targets, on
   * canonical measures without alternates, and on every row stored before
   * #39 — readers use `?? []`/`?? null`, never a bare read. */
  alternates?: AttributionAlternate[];
}

/** #253: `'region_set'` is one measure at one period across a whole region
 * CLASS. It is its own shape rather than a 'comparison' because it carries a
 * coverage record (ValidatedResult.regionSet) and because 'derived' — what an
 * explicit `max` produces — charts as null (src/chart/build.ts), while a
 * ranked region set must chart. Forward-only: no stored row carries it. */
export type ResultShape = 'single' | 'series' | 'comparison' | 'derived' | 'region_set';

/** #253: what the region CLASS actually covered, recorded so the disclosure
 * sentence is re-DERIVED at audit time rather than re-decided (R8), and so the
 * ranking honesty rule (RS1) is a function of stored facts.
 *
 * The four buckets are mutually exclusive and, together with the served cells,
 * account for every roster member:
 *  - served cells: the member has a row with a value ("applicable"), or a row
 *    whose value is null for a reason OTHER than `Impossible` ("withheld" — a
 *    value that exists but is not disclosed, and could be the maximum);
 *  - `notApplicable`: null with CBS's own `Impossible` — CBS states the
 *    coordinate does not exist (an abolished gemeente after its abolition), so
 *    the member is not part of the class at that period and carries no number;
 *  - `missing`: no row at all, or a member outside our ingested slice — we
 *    simply do not know.
 *
 * `complete` is true only when `withheld` and `missing` are both empty. That is
 * the whole of RS1: a ranking derivation is produced only for a complete set,
 * so a superlative has nothing to bind to otherwise (R9 then fails closed). */
export interface RegionSetCoverage {
  /** The class asked for — the audit record re-derives the roster from this. */
  scope: RegionScope;
  /** Every member CBS lists for this table's class, before any partition. */
  rosterSize: number;
  notApplicable: string[];
  withheld: string[];
  missing: string[];
  complete: boolean;
}

export interface ValidatedResult {
  ok: true;
  schemaVersion: typeof RESULT_SCHEMA_VERSION;
  shape: ResultShape;
  /** Ordered: by period ascending, then by the intent's region order. */
  cells: ResultCell[];
  derivations: DerivationRecord[];
  attribution: Attribution;
  /** The intent this result answers — echoed for the audit record (R8, WP10).
   * When a WP26 default fired, this is the RESOLVED intent (the one that ran),
   * not the under-specified question. */
  intent: StructuredIntent;
  /** WP26 mechanism B-region (ADR 024, safelist entry 1): the question named no
   * place and we answered with the national total. Drives the deterministic
   * disclosure sentence ("Dit is het landelijke cijfer voor heel Nederland.")
   * and its correction chip, and is re-read at audit time so that sentence
   * re-derives byte-identically (R8) instead of being re-decided.
   *
   * ADDITIVE and present-only: pre-WP26 rows and every non-defaulted answer
   * carry no key at all, so readers MUST use `?? false` — `undefined !== false`
   * would otherwise misreport them (the lesson the WP16 `onboarding` field
   * taught on ~73 real rows). */
  regionDefaulted?: boolean;
  /** WP26 mechanism B-period (ADR 024, safelist entry 2): the question named no
   * period and we answered with the recent-trend window. Set by the ANSWER
   * layer (the period axis is resolved before the query runs), same present-only
   * and `?? false` discipline as regionDefaulted. */
  periodDefaulted?: boolean;
  /** #253: present ONLY on a `region_set` result. Same present-only discipline
   * as regionDefaulted (docs/13): every row stored before this feature carries
   * no key at all, so readers use `?? null` and never a bare read. */
  regionSet?: RegionSetCoverage;
  /** #196 (session 73): the two registry facts the staleness check needs,
   * carried from the SAME cbs_tables row resolveIntent already read
   * (resolve.ts fetchTable) so src/answer/respond/staleness.ts never re-reads
   * that row after the fetch — a re-read an eviction landing mid-turn answers
   * with "no row", silently switching off the staleness warning and the
   * recency refusal, and misphrasing the #154 retained-cell clause.
   * Present-only: a synthetic result (tests) carries no key and checkStaleness
   * then falls back to the registry reads. */
  registry?: {
    /** Free-text `update_cadence` ("monthly (~22 days …)"), null when unset. */
    updateCadence: string | null;
    /** The table's own `last_sync_at` (ISO) — attribution.syncedAt is the
     * MINIMUM over retained cells and can be older than this. */
    lastSyncAt: string | null;
  };
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
  /** #196 (sessions 72–73): the table WAS registered when this query resolved
   * but was evicted (src/ingestion/eviction.ts, the on-demand TTL) before the
   * query completed. Deliberately its own kind: `table_not_registered` is a
   * genuine anomaly (a parser-produced table id nobody registered) and pages
   * the owner through the 'internal' refusal reason; this is a designed,
   * benign race — the data left OUR store, not CBS — with its own honest
   * wording ('evicted' reason, never the alert). run.ts's diagnoseMissing
   * re-checks registration LAST on the only branch a fully evicted table can
   * reach (not_published), so no data-gap refusal is ever manufactured for a
   * table that simply vanished mid-flight. */
  | 'table_evicted'
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
    /** #253: a machine-readable SUB-reason, for the one case where a refusal
     * kind that is otherwise an internal fault is in fact an honest, ordinary
     * scope limit the answer layer must word differently.
     *
     * Why a field and not a new RefusalKind (which the #253 design explicitly
     * rules out): `invalid_intent` is the right kind — the intent genuinely
     * cannot be satisfied — and the answer layer's alternative is matching on
     * `message`, English prose that exists for the owner's eyes and may be
     * reworded any day. It is also NOT derivable from the intent alone: an
     * over-the-cap region set refuses with the same kind, the same axis and
     * the same intent shape, and must keep the generic wording.
     *
     * Present-only (docs/13): absent on every other refusal and on every row
     * stored before #253, so readers use `?? null` and a plain equality test —
     * never a bare truthiness read. */
    subReason?: 'region_scope_on_national_measure';
    /** For freshness refusals: what we can serve instead. */
    freshness?: FreshnessInfo;
    /** For scope refusals: the nearest answerable alternative, as a CBS code
     * (e.g. the loaded slice's period floor). */
    nearestAlternative?: string;
  };
  intent: StructuredIntent;
}

export type QueryOutcome = ValidatedResult | QueryRefusal;
