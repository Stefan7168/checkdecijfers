// WP6 intent parsing — the answer module's first step (docs/08-build-plan.md,
// ADR 004: LLM confined to schema-validated roles, ADR 012: harness design).
//
// Division of labor (principle a): the LLM maps Dutch to the registry's
// vocabulary — canonical measure KEYS, region NAMES as the user said them, and
// a structured period description. It never emits CBS codes and never sees
// data. Deterministic code (resolve.ts/policy.ts) turns names into codes,
// applies the R7 threshold policy, and assembles the frozen WP5
// StructuredIntent contract.
import type { StructuredIntent } from '../../query/index.ts';

// ---------------------------------------------------------------------------
// The LLM's output contract (raw parse) — validated by zod in schema.ts
// ---------------------------------------------------------------------------

/** v2 (2026-07-04, WP14): open-ended period ranges — 'since', 'last_n' and
 * 'now_vs_ago' added to PeriodSpec (open-questions #55, validation pass
 * V01/V28/V02). The StructuredIntent contract is UNCHANGED: all three resolve
 * deterministically to the existing range/codes shapes.
 * v3 (2026-07-05, #77 fix): 'date_range' added — explicit day/month/year
 * boundaries ("van 1 januari 2022 tot en met 31 december 2022"), copied
 * verbatim by the model; deterministic code normalizes them to whole months
 * and picks the grain (ADR 023). StructuredIntent again unchanged. */
export const RAW_PARSE_VERSION = 3 as const;

/** Question classification. Everything except data_query exits the pipeline
 * before any intent is built (docs/05 failure table; phrased by WP9). */
export type QuestionKind =
  | 'data_query'
  | 'forecast_request'
  | 'causal_question'
  | 'out_of_scope'
  | 'compound'
  | 'smalltalk_or_other';

/** Region kind qualifier. 'onbekend' when the question doesn't say — the
 * resolver then matches across kinds and treats multiple hits as user-facing
 * ambiguity (R7), e.g. "Utrecht" = gemeente OR provincie. */
export type RegionKind = 'land' | 'landsdeel' | 'provincie' | 'gemeente' | 'onbekend';

export interface RegionTerm {
  /** Place name as the user wrote it (e.g. "Den Haag", never a CBS code). */
  name: string;
  kind: RegionKind;
}

/** One end of an explicit date_range, exactly as the user wrote it. */
export interface DateBoundary {
  year: number;
  month: number;
  /** null when the phrasing names only a month ("van maart 2020 …"). */
  day: number | null;
}

/** Structured period description. Relative kinds resolve deterministically
 * against a caller-supplied reference date — the prompt never contains the
 * current date (keeps fixtures and the prompt cache date-independent). */
export type PeriodSpec =
  | { kind: 'year'; year: number }
  | { kind: 'quarter'; year: number; quarter: number }
  | { kind: 'month'; year: number; month: number }
  | { kind: 'year_range'; fromYear: number; toYear: number }
  /** "sinds 2015" / "vanaf maart 2020" — an OPEN-ENDED range (WP14, #55). The
   * model states only the start (year, optionally refined by quarter OR
   * month); deterministic code resolves the end to the freshest published
   * period at the start's grain. A start before the loaded slice passes
   * through — the query layer's slice/publication refusals stay the single
   * honest source of that behavior. */
  | { kind: 'since'; year: number; quarter: number | null; month: number | null }
  /** "de afgelopen vijf jaar" / "laatste zes maanden" — the n freshest
   * published periods at the unit's grain (n ≥ 2; the singular "afgelopen
   * jaar" stays a relative offset). Resolved end-anchored: the range ends at
   * the freshest published period, never at a date the model guessed. */
  | { kind: 'last_n'; unit: 'month' | 'quarter' | 'year'; n: number }
  /** "nu vergeleken met vijf jaar geleden" (V02) — TWO disjoint periods, not
   * a range: the freshest published period and the one `amount` units before
   * it, both picked by code at the finest grain that can express the unit. */
  | { kind: 'now_vs_ago'; unit: 'month' | 'quarter' | 'year'; amount: number }
  /** "groeide/steeg/daalde ... in {year}, met hoeveel" — change DURING a year.
   * Which two cells that means depends on the measure's period semantics
   * (stand per 1 januari vs. flow) — a deterministic mapping in resolve.ts,
   * never the LLM's call. */
  | { kind: 'change_over_year'; year: number }
  /** "van 1 januari 2022 tot en met 31 december 2022" / "van maart 2020 tot
   * juni 2021" — explicit CLOSED boundaries with day/month/year named (#77,
   * ADR 023). The model copies the boundaries AS WRITTEN (day null when no
   * day is named) plus whether the end is inclusive ("tot en met"/"t/m") or
   * exclusive (bare "tot") — pure language, never date arithmetic.
   * Deterministic code normalizes to whole months, rejects boundaries that
   * cut a month (CBS data is monthly at finest), and picks the finest
   * published grain that expresses the range exactly. */
  | { kind: 'date_range'; from: DateBoundary; to: DateBoundary; toInclusive: boolean }
  /** "vorige maand" / "vorig kwartaal" / "vorig jaar" — offset is negative. */
  | { kind: 'relative'; unit: 'month' | 'quarter' | 'year'; offset: number }
  /** Present tense / "nu" / "op dit moment" — freshest published period. */
  | { kind: 'latest' }
  /** No period signal in the question at all — an unresolved axis (R7). */
  | { kind: 'none' };

export type DerivationHint = 'none' | 'difference' | 'max' | 'series';

export interface RawCandidate {
  /** A canonical_measures key — the registry vocabulary (ADR 010). */
  canonicalKey: string;
  /** null when the question names no place at all. */
  regions: RegionTerm[] | null;
  period: PeriodSpec;
  derivation: DerivationHint;
  /** 0..1 self-reported confidence — calibrated thresholds in policy.ts
   * decide answer vs. clarify (R7, open-questions #19 / ADR 012). */
  confidence: number;
  /** One-line reading, for the audit record and clarification options. */
  reading: string;
}

export interface RawParse {
  version: typeof RAW_PARSE_VERSION;
  kind: QuestionKind;
  /** data_query: 1..3 readings, best first. Empty for every other kind, and
   * for data-shaped questions whose topic matches nothing loaded. */
  candidates: RawCandidate[];
  /** The topic term that matched no canonical key (e.g. "bijstand") — drives
   * the B15-style measure clarification. */
  unmatchedMeasureTerm: string | null;
  /** Closest loaded concepts to an unmatched term — clarification options
   * that actually resolve in the loaded data (docs/05 failure table). */
  nearestCanonicalKeys: string[];
  note: string | null;
}

// ---------------------------------------------------------------------------
// Parse outcome — what WP6 hands the rest of the answer pipeline
// ---------------------------------------------------------------------------

export type ClarifyAxis = 'measure' | 'region' | 'period' | 'derivation';

export interface RankedCandidate {
  intent: StructuredIntent;
  confidence: number;
  reading: string;
  /** True when the period came from a relative/'latest' spec — feeds the
   * docs/05 staleness rule (recency-implying questions refuse when stale). */
  impliedRecency: boolean;
}

/** Why a raw candidate could not become a StructuredIntent. All of these are
 * user-facing (they exit to clarification, never a silent fix). */
export interface ResolutionFailure {
  axis: ClarifyAxis;
  reason:
    | 'unknown_canonical_key'
    | 'region_ambiguous'
    | 'region_unknown'
    | 'region_on_national_measure'
    /** WP22 (#97a): a max/"meeste" ask on a GEO table without ≥2 named
     * regions — the real gap is the comparison set, so the question asks for
     * regions to COMPARE; it must never reuse region_unknown's "welke
     * gemeente bedoel je" (that template belongs to unknown place names). */
    | 'max_needs_regions'
    /** WP22 (#97a): a max/"meeste" ask on a national-only measure — regional
     * comparison is impossible here AND max-over-periods is not built yet
     * (open-questions #97b); the clarification names that real gap instead
     * of asking gemeente-of-provincie on a measure without regions. */
    | 'max_on_national_measure'
    | 'grain_unavailable'
    | 'period_invalid'
    | 'period_missing';
  message: string;
  /** Concrete, loaded-data options for the clarification (docs/05). */
  options: string[];
  confidence: number;
  reading: string;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

interface OutcomeBase {
  /** Echoed for the audit record (R8, WP10). */
  question: string;
  raw: RawParse;
  model: string;
  usage: LlmUsage;
}

export type ParseOutcome =
  | (OutcomeBase & {
      kind: 'intent';
      intent: StructuredIntent;
      confidence: number;
      impliedRecency: boolean;
      /** All resolved readings, best first — R7's "ranked candidate intents". */
      ranked: RankedCandidate[];
    })
  | (OutcomeBase & {
      kind: 'clarification';
      /** EVERY unresolved axis at once — the one clarification round must
       * cover them all (docs/05 failure table). */
      axes: ClarifyAxis[];
      /** Exactly one compact Dutch question (B15/B16 scoring criterion). */
      question_nl: string;
      /** The offered options; each resolves in the loaded data. */
      options: string[];
      reason: string;
    })
  | (OutcomeBase & {
      kind: 'refusal';
      refusalKind: 'forecast' | 'causal' | 'out_of_scope' | 'compound' | 'smalltalk';
      note: string | null;
    });

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ParserConfig {
  /** Top candidate below this → clarify, never a best guess (R7). */
  answerThreshold: number;
  /** A second, materially different reading at or above this → clarify. */
  runnerUpThreshold: number;
}

/** Calibrated 2026-07-03 against benchmark/intent-labelled-set.json (45 cases,
 * claude-haiku-4-5, prompt v3; report: benchmark/intent-calibration-report
 * .json, procedure: ADR 012). Measured: correct parses sit at 0.92–0.98
 * (min 0.92, median 0.95); the model's shaky readings — vague-period and
 * dropped-region cases from calibration run 1 — sat at 0.75–0.85. 0.9 splits
 * the bands with margin on both sides: a borderline-confident CORRECT reading
 * degrades to a clarifying question (safe, principle c), while a shaky one
 * can never be answered. Change only with a re-run of npm run intent:eval. */
export const DEFAULT_PARSER_CONFIG: ParserConfig = {
  answerThreshold: 0.9,
  runnerUpThreshold: 0.35,
};

/** Thrown when the LLM's output fails schema validation — the caller (WP9)
 * maps this to a safe refusal; it must never surface as an answer. */
export class RawParseValidationError extends Error {
  readonly outputText: string;

  constructor(message: string, outputText: string) {
    super(message);
    this.name = 'RawParseValidationError';
    this.outputText = outputText;
  }
}
