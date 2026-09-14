// Eurostat adapter — wire types (ADR 048 D1: "no new provider abstraction").
//
// D1's own text: the Eurostat adapter is one more SourceAdapter behind the
// existing waist; the `Cbs*` wire-type names stay (ADR 030 A5 already
// measured a rename at 31+ files of diff noise and deferred it — that
// verdict is unchanged for source two). This module therefore mostly
// RE-EXPORTS the shared types verbatim, under a Eurostat-flavoured alias
// where that reads better at a Eurostat call site, plus the handful of
// genuinely Eurostat-specific shapes D6 needs that have no CBS equivalent:
// the raw JSON-stat 2.0 wire shape (nothing outside src/eurostat-adapter/ may
// know it, mirroring ADR 003 decision 2 for CBS's OData v4 shape) and the
// typed refusal for a grain this adapter does not map (D6: semester/weekly/
// daily datasets are refused, never silently mapped).
export type {
  CbsCatalogEntry as EurostatCatalogEntry,
  CbsCode as EurostatCode,
  CbsDimension as EurostatDimension,
  CbsDimensionKind as EurostatDimensionKind,
  CbsMeasure as EurostatMeasure,
  CbsObservationRow as EurostatObservationRow,
  CbsSlice as EurostatSlice,
  CbsSource as EurostatSource,
  CbsTableSchema as EurostatTableSchema,
} from '../cbs-adapter/types.ts';

/**
 * Raw JSON-stat 2.0 "dataset" response shape (https://json-stat.org/format/),
 * restricted to the fields this adapter actually reads. Eurostat's real live
 * response is not verified against this session (Constraint 0, the WP30c/E1
 * brief) — this is the documented spec shape, exercised only against
 * hand-built synthetic fixtures (tests/fixtures/eurostat/), never a captured
 * real payload. `id`/`size` are parallel arrays (one entry per dimension, in
 * the SAME order); `value` is the flat cell array with the LAST dimension in
 * `id` varying fastest (the spec's own indexing rule) — jsonstat.ts's
 * `cellOffset` is the one place that arithmetic happens.
 */
export interface JsonStatCategory {
  /** Either an object mapping category code -> its position in `id`'s
   * dimension, or (some encoders emit this instead) a plain array of codes
   * whose ARRAY POSITION is the index — both are valid per spec; the parser
   * accepts either rather than assuming one. */
  index: Record<string, number> | string[];
  /** category code -> human label. Optional per spec; a missing entry falls
   * back to the code itself (never fabricated prose). */
  label?: Record<string, string>;
}

export interface JsonStatDimension {
  label?: string;
  category: JsonStatCategory;
}

export interface JsonStatDataset {
  version?: string;
  class?: string;
  /** The dataset's own title. */
  label?: string;
  /** Dimension ids, in the order `size`/the value-array indexing follow. */
  id: string[];
  /** Category counts, parallel to `id`. */
  size: number[];
  dimension: Record<string, JsonStatDimension>;
  /** Flat, dense cell array (length = product(size)); a missing observation
   * is `null` at its position, never a fabricated 0. */
  value: Array<number | null>;
  /**
   * Per-cell flags (D6: `p e s f b c d u n z :`). Per spec this is either
   * absent (no flagged cells), a single string (uncommon — applies to every
   * cell), or an object keyed by the cell's flat-index AS A DECIMAL STRING
   * (the common, sparse shape real APIs use — only flagged cells appear).
   */
  status?: string | Record<string, string>;
  /** ISO timestamp of the dataset's own last update, when present. */
  updated?: string;
}

/**
 * D6: "semester (`-S1`), weekly (`-W01`) and daily datasets are refused by
 * the fit gate ... not silently mapped." Thrown by `mapEurostatPeriod`
 * (jsonstat.ts) — never caught and coerced inside this adapter; a caller
 * that wants to know why a dataset can't be served sees this typed error,
 * not a generic parse failure.
 */
export class UnsupportedGrainError extends Error {
  readonly grain: string;
  readonly nativeCode: string;

  constructor(grain: string, nativeCode: string) {
    super(
      `Eurostat time grain '${grain}' (native time code '${nativeCode}') is not supported — ` +
        `only annual ('YYYY'), quarterly ('YYYY-Qn') and monthly ('YYYY-Mnn') grains map into the ` +
        `internal 'YYYY(JJ|KW|MM)NN' grammar (ADR 048 D6). This is a deliberate refusal, not a bug: ` +
        `a semester/weekly/daily dataset is an ADR-030-D2 grain-extension revisit trigger.`,
    );
    this.name = 'UnsupportedGrainError';
    this.grain = grain;
    this.nativeCode = nativeCode;
  }
}

/**
 * D6: "refuse server-side any dataset whose declared cell count would need
 * the async API — a typed refusal, not a hang." Thrown when a JSON-stat
 * dataset's declared `size` product exceeds the synchronous-API ceiling.
 */
export class AsyncApiRequiredError extends Error {
  readonly declaredCellCount: number;

  constructor(declaredCellCount: number, threshold: number) {
    super(
      `Eurostat dataset declares ${declaredCellCount} cells, over the ${threshold}-cell synchronous ` +
        `threshold (ADR 048 D6) — this adapter implements the synchronous Statistics API only; the ` +
        `async submit-and-poll API is not implemented. Refusing rather than hanging or truncating.`,
    );
    this.name = 'AsyncApiRequiredError';
    this.declaredCellCount = declaredCellCount;
  }
}
