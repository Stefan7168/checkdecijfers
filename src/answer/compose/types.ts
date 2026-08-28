// WP7 answer composition — types (docs/08-build-plan.md).
//
// The composed answer is a structured object, not just a string: attribution
// (R4), the definition statement (canonical-default transparency, docs/05),
// and the CC BY derived-data marking (R5) are FIELDS assembled by
// deterministic code, so no rendering path — and no LLM output — can drop
// them. The LLM only ever writes `body`, and only after the R3/R9/R10/R11
// validator has passed it.
import type { LlmUsage } from '../llm/client.ts';

export const ANSWER_SCHEMA_VERSION = 1 as const;

/** Which path produced the body (docs/02 reports the template-fallback count):
 *  llm        — first attempt passed validation
 *  llm_retry  — the single R3 regeneration passed
 *  template   — fail-closed deterministic rendering (never fabricates) */
export type AnswerSource = 'llm' | 'llm_retry' | 'template';

export interface AnswerValidationReport {
  ok: boolean;
  problems: string[];
}

// ---------------------------------------------------------------------------
// #144 (ADR 034) — the semantic second pass on residual-prone bodies
// ---------------------------------------------------------------------------

export const SEMANTIC_CHECK_SCHEMA_VERSION = 1 as const;

/** One numeric token whose deterministic exemption sits at the proven
 * deterministic ceiling (ClassifiedToken.soft) — re-derivable from the stored
 * body + result, which is what gives the R8 shape check its teeth. */
export interface SuspectToken {
  token: string;
  /** Start index in the scan-normalized body. */
  index: number;
  /** The sentence the token sits in — the judgment context the checker sees. */
  sentence: string;
  /** Which residual class flagged it: a #140 metadata echo or a #141
   * temporal-marker-before period grounding. */
  kind: 'metadata' | 'period';
}

/** The checker's judgment of one suspect — model output, recorded verbatim on
 * the audit record and NEVER re-derived (an LLM verdict has no deterministic
 * ground truth; ADR 034 mirrors how llm_calls are recorded-not-rederived). */
export interface SemanticVerdictItem {
  /** Position of the judged suspect in `suspects` (the id sent to the model). */
  id: number;
  fabricated: boolean;
  reason: string;
}

/** Owner decision (ADR 034): what happens when the checker CALL itself fails
 * (API error, malformed output). fail_open serves the answer that already
 * passed the full deterministic validator and records the skip; fail_closed
 * treats it as a rejection and drops down the R3 ladder. */
export type SemanticCheckMode = 'fail_open' | 'fail_closed';

/** The verdict stored on the served answer (inside the envelope, so the audit
 * row carries it verbatim — R8). Absent (key not serialized) when the feature
 * is off — pre-feature rows and off-flag rows read `?? null` (A1).
 *  - 'skipped_no_suspects': the deterministic gate found nothing residual-
 *    prone; no LLM call was made (re-derivable, so reconstruct verifies it).
 *  - 'ok': the checker ran and cleared every suspect (verdicts recorded).
 *  - 'error': the checker call failed and mode is fail_open — the answer was
 *    served on the strength of the deterministic validator alone. A served
 *    record can never carry status 'error' under fail_closed, nor any
 *    fabricated=true verdict (those bodies drop down the ladder instead). */
export interface SemanticCheckRecord {
  schemaVersion: typeof SEMANTIC_CHECK_SCHEMA_VERSION;
  promptVersion: number;
  mode: SemanticCheckMode;
  status: 'ok' | 'skipped_no_suspects' | 'error';
  /** The model that judged, as reported by the API; null when no call ran. */
  model: string | null;
  suspects: SuspectToken[];
  /** Model output, verbatim; null when no call ran or the call errored. */
  verdicts: SemanticVerdictItem[] | null;
  /** The call/validation error message; null unless status is 'error'. */
  error: string | null;
  /** Wall-time of the checker call — telemetry, not reconstruction material. */
  latencyMs: number | null;
}

// ---------------------------------------------------------------------------
// #162 (ADR-draft slot-filling, hermetic half) — typed-placeholder phrasing
// ---------------------------------------------------------------------------

export const SLOT_PHRASING_SCHEMA_VERSION = 1 as const;

/** One slot's binding: which stored coordinate fills it (R1/R8 traceability
 * per slot — the ADR-draft's "slot map"). Re-derivable: the slot menu is a
 * pure function of the ValidatedResult (buildSlotContext), so reconstruction
 * re-derives this map from the stored result and compares byte-identically. */
export interface SlotBinding {
  slot: string;
  kind: 'value' | 'period' | 'derivation';
  /** The cell whose value ('value') or periodLabel ('period') fills the slot;
   * null for derivation slots. For a shared period slot: the FIRST cell
   * carrying that periodCode (cells are ordered, so this is deterministic). */
  resultId: string | null;
  /** Index into the stored result.derivations for 'derivation' slots (the
   * records carry no id of their own; the stored array is verbatim, so the
   * index is exact); null for cell-backed slots. */
  derivationIndex: number | null;
}

/** #162: stored on the served answer when the slot rung wrote the body —
 * the raw placeholder body (the model's actual output, zero digits) plus the
 * slot map. Present-only (key not serialized when the flag is off or the body
 * came from another rung), so every pre-#162 and flag-off envelope stays
 * byte-identical — readers use `?? null` (A1). R8: reconstruction re-fills
 * rawBody through the deterministic filler against the stored result and must
 * reproduce the stored body byte-identically. */
export interface SlotPhrasingRecord {
  schemaVersion: typeof SLOT_PHRASING_SCHEMA_VERSION;
  /** The model's raw placeholder body, BEFORE filling — validated digit-free. */
  rawBody: string;
  /** slot → stored coordinate, in menu order. */
  slots: SlotBinding[];
}

/** One failed or succeeded LLM attempt — kept for the audit record (R8). */
export interface ComposeAttempt {
  kind: 'llm' | 'llm_retry';
  ok: boolean;
  problems: string[];
  /** Set when the attempt errored before producing text (API error, refusal). */
  error: string | null;
}

export interface ComposedAnswer {
  schemaVersion: typeof ANSWER_SCHEMA_VERSION;
  source: AnswerSource;
  /** The prose the user reads first — LLM-written (validated) or template. */
  body: string;
  /** WP26 mechanism B (ADR 024): the defaulted-axis disclosure ("Dit is het
   * landelijke cijfer voor heel Nederland. …") — assembled by deterministic
   * code from validated result state, outside the LLM-scanned body, and
   * re-derived byte-identically at audit time (R8) by the same builder.
   *
   * OPTIONAL and present-only: an answer with no defaulted axis, and every row
   * stored before WP26, carries no key at all — readers MUST use `?? null`. */
  assumptionLine?: string | null;
  /** "Definitie: …" — rendered whenever a canonical default was applied
   * (attribution.definitionLabel), structurally, never left to the LLM. */
  definitionLine: string | null;
  /** #39 (owner policy 2026-07-04): the alternate-reading disclosure ("Er is
   * ook een andere lezing beschikbaar: …") — built by deterministic code
   * (buildAlternatesLine) from the registry alternates carried on the stored
   * attribution, outside the LLM-scanned body, and re-derived byte-identically
   * at audit time (R8) by the same builder.
   *
   * OPTIONAL and present-only (docs/13): an answer whose canonical default has
   * no recorded alternates, every explicit-target answer, and every row stored
   * before #39 carries no key at all — readers MUST use `?? null`. */
  alternatesLine?: string | null;
  /** CC BY derived-data marking — rendered whenever the result carries any
   * derivation record (R5; docs/05 Source attribution section). */
  markingLine: string | null;
  /** R4: table ID, title, sync date, covered period, license — always. */
  attributionLine: string;
  /** The full rendered answer: body + structural lines. */
  text: string;
  /** Model that wrote the body; null when the template did. */
  model: string | null;
  promptVersion: number;
  /** Summed over all LLM attempts, semantic-checker calls included (#144);
   * 0/0 for pure template paths. */
  usage: LlmUsage;
  attempts: ComposeAttempt[];
  /** Validation report of the final body. For template bodies this must
   * always be ok — proven by test, not assumed. */
  validation: AnswerValidationReport;
  /** #144 (ADR 034): the semantic checker's verdict on the SERVED body.
   * Present only when the feature was on AND the body came from the LLM
   * (template bodies are deterministic and never checked) — the key is not
   * serialized otherwise, so pre-feature envelopes stay byte-identical and
   * readers use `?? null` (A1). */
  semanticCheck?: SemanticCheckRecord;
  /** #162 (slot-filling, flag `SLOT_PHRASING_ENABLED`, OFF by default): the
   * raw placeholder body + slot map when the slot rung wrote the served body.
   * Present-only — absent on every flag-off, pre-#162 and template envelope
   * (`?? null`, A1). */
  slotPhrasing?: SlotPhrasingRecord;
}
