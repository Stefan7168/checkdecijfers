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
  /** "Definitie: …" — rendered whenever a canonical default was applied
   * (attribution.definitionLabel), structurally, never left to the LLM. */
  definitionLine: string | null;
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
  /** Summed over all LLM attempts (0/0 for pure template paths). */
  usage: LlmUsage;
  attempts: ComposeAttempt[];
  /** Validation report of the final body. For template bodies this must
   * always be ok — proven by test, not assumed. */
  validation: AnswerValidationReport;
}
