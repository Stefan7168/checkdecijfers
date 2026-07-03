// WP9 refusal & clarification behaviour — the response envelope
// (docs/08-build-plan.md WP9; failure-behaviour table in docs/05-data-rules.md).
//
// ComposedResponse is what the pipeline hands the outside world for EVERY
// question: a validated answer, exactly one compact clarifying question, or a
// typed refusal — never a guessed number (principle c). All refusal and
// clarification text is assembled by DETERMINISTIC templates, never an LLM
// (ADR 015): these messages exist precisely because we have no validated
// numbers to phrase, so an LLM could only add fabrication risk. The no-numbers
// guarantee is structural (the builders never see cell values) plus
// belt-checked by tests that scan the rendered text.
//
// This envelope is also the WP10 seam: it carries the parse outcome, the query
// outcome and the composed answer verbatim, so one audit record can
// reconstruct the full decision path (R8).
import type { ChartSpec } from '../../chart/index.ts';
import type { FreshnessInfo, QueryRefusal, ValidatedResult } from '../../query/index.ts';
import type { ComposedAnswer } from '../compose/index.ts';
import type { ClarifyAxis, ParseOutcome } from '../intent/types.ts';

export const RESPONSE_SCHEMA_VERSION = 1 as const;

/** User-facing refusal reasons — one per docs/05 failure-behaviour row (plus
 * the defensive parse/internal buckets). The REASON is part of the benchmark
 * pass criterion (B17–B20 must state the CORRECT reason: scope vs. freshness
 * vs. interpretation), so this taxonomy is load-bearing, not cosmetic. */
export type RefusalReason =
  /** Topic outside the loaded table set (B17); wording names the scope limit
   * and a genuinely answerable alternative. */
  | 'scope'
  /** CBS publishes realizations, not forecasts (B18); wording offers the
   * realized statistic when the topic itself is loaded. */
  | 'forecast'
  /** Causal interpretation refused (B19); descriptive stats offered only when
   * the topic is loaded, else refused fully. */
  | 'causal'
  /** Several independent asks in one message — honest split, never a misfired
   * ambiguity clarification (docs/02 compound rule). */
  | 'compound'
  /** Not a statistics question; the reply explains what the product does. */
  | 'smalltalk'
  /** Data exists but not yet for the requested period (B20): the wording
   * states the freshest available period + status (R11), NEVER a value. */
  | 'freshness'
  /** Table past its expected update cadence AND the question implies recency
   * (docs/05 staleness row, refusal branch; warn-and-serve is the other
   * branch, carried on AnswerResponse.stalenessWarning). */
  | 'staleness'
  /** CBS never published this period/coordinate (distinguished from a slice
   * limit, per docs/05). */
  | 'not_published'
  /** CBS publishes it, but it lies outside OUR ingested slice — wording must
   * say the limit is ours, not CBS's (docs/05). */
  | 'outside_loaded_slice'
  /** Table quarantined pending review — treated as out of scope, never
   * served; wording is honest about the temporary hold (docs/05). */
  | 'quarantined'
  /** Still ambiguous after the one clarification round: refusal-with-guidance,
   * never a second question (docs/05 failure table). */
  | 'still_ambiguous'
  /** Loud internal problems (data gap, failed derivation, inconsistency,
   * invalid intent, unparseable LLM output) — an honest "cannot answer this
   * reliably right now", never a partial or guessed answer. */
  | 'internal';

/** Serializable state of the one open clarification round — handed back on
 * the user's next message (respondToClarificationReply) so the reply is
 * parsed MERGED with this, not as a fresh question (docs/05, docs/02 S3).
 * Persistable as-is (future chat UI; WP10 audit). */
export interface PendingClarification {
  version: typeof RESPONSE_SCHEMA_VERSION;
  /** The original user question, verbatim. */
  question: string;
  /** The reference date the original parse ran against — the reply must
   * resolve relative periods against the SAME clock. */
  referenceDate: string;
  /** Every unresolved axis, all at once (the one round covers them all). */
  axes: ClarifyAxis[];
  /** The compact Dutch question we asked (exactly one). */
  questionNl: string;
  /** The offered options — each resolves in the loaded data. */
  options: string[];
}

interface ResponseBase {
  schemaVersion: typeof RESPONSE_SCHEMA_VERSION;
  /** The original user question, verbatim (audit; R8). */
  question: string;
  /** The full user-facing Dutch message, assembled deterministically from the
   * structured fields below — the single string a chat UI renders. */
  text: string;
}

export interface AnswerResponse extends ResponseBase {
  kind: 'answer';
  /** WP7's composed answer, verbatim (body + structural lines). */
  answer: ComposedAnswer;
  /** WP8 chart spec when the result shape warrants one (series/comparison),
   * else null — policy lives in the chart module, not here. */
  chart: ChartSpec | null;
  /** docs/05 staleness row, warn-and-serve branch: set when the table is past
   * its expected update cadence but the requested period is covered. Rendered
   * into `text`; structural so no rendering path can drop it. */
  stalenessWarning: string | null;
  /** Audit seams (R8): the full parse and query outcomes. */
  parse: ParseOutcome;
  result: ValidatedResult;
}

export interface ClarificationResponse extends ResponseBase {
  kind: 'clarification';
  /** Every unresolved axis at once (R7 / docs/05: one round, all axes). */
  axes: ClarifyAxis[];
  options: string[];
  /** State for the merge on the user's next message. */
  pending: PendingClarification;
  parse: ParseOutcome;
}

export interface RefusalResponse extends ResponseBase {
  kind: 'refusal';
  reason: RefusalReason;
  /** What we CAN honestly do instead ("nearest answerable alternative"):
   * rendered inside `text`, kept structured for tests/audit. Null when there
   * is nothing honest to offer. NEVER contains a data value. */
  offer: string | null;
  /** Refusal-with-guidance: what to ask instead (docs/05 failure table).
   * Null when the refusal needs no guidance (e.g. smalltalk). */
  guidance: string | null;
  /** Structured freshness payload for freshness refusals (period + status
   * only, never a value — open-questions #37). */
  freshness: FreshnessInfo | null;
  /** Audit seams (R8). `parse` is null only when parsing itself failed
   * (schema-invalid LLM output / API error) — the 'internal' safe refusal. */
  parse: ParseOutcome | null;
  queryRefusal: QueryRefusal | null;
  /** Owner-readable English diagnostic for the audit record (R8) — e.g. the
   * caught error message behind an 'internal' refusal. NEVER rendered to the
   * user; `text` is the only user-facing surface. */
  internalNote: string | null;
}

export type ComposedResponse = AnswerResponse | ClarificationResponse | RefusalResponse;
