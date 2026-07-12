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
import type { ConversationContext } from '../context/types.ts';
import type { ClarifyAxis, ParseOutcome } from '../intent/types.ts';
// WP129+130 (ADR 032): the source-selection state and the unverified-web
// section ride the envelope as additive structural fields. Imported from the
// PURE LEAF (never the module barrel) so the Anthropic SDK never enters this
// widely-consumed types graph.
import type { SourceSelection, WebSection } from '../../websearch/types.ts';

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
  /** WP18 (F3): a genuinely meta question about the product itself (bronnen,
   * werkwijze, actualiteit, betrouwbaarheid, mogelijkheden), recognized by the
   * deterministic post-classification router (meta.ts, ADR 022) inside the
   * smalltalk bucket. Delivered through the refusal envelope because it is
   * not a data answer (no cells, no attribution) — but the text ANSWERS the
   * question with a product-behaviour template instead of deflecting. */
  | 'meta'
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
  /** WP16 sub-part 2 (ADR 026): the topic matched no loaded measure, but the
   * table finder confidently identified a CBS table that can answer it, so we
   * have TRIGGERED an on-demand fetch+verify+store job (the 100-credit debit
   * happens in the web action, outside the answer module — src/billing must
   * not leak in here). The text ACKNOWLEDGES that and invites another question
   * while the job runs; like 'meta', it rides the refusal envelope but ANSWERS
   * (nothing is refused, nothing is fabricated — no data value exists yet).
   * Carries the structured `onboarding` field below so the web action knows
   * which table to fetch and how confident the finder was. */
  | 'onboarding_pending'
  /** WP16 sub-part 2: the SAME (user, table) already has an active
   * pending/running onboarding job — asking again must not queue a second
   * fetch or cost a second debit. A plain acknowledgment; no `onboarding`
   * field (the web action never triggers on this reason). */
  | 'onboarding_already_pending'
  /** WP129+130 (#129, ADR 032): ALL sources deselected — a deterministic
   * pre-parse refusal (server belt behind the client's disabled send). No LLM,
   * no web attempt (in the ⟨W3⟩ skip-list). Rides the normal gate ⇒ full
   * refund ⇒ net 0. */
  | 'no_sources'
  /** WP129+130 (#129/#130, ADR 032): CBS deselected but the "Internet" chip
   * kept — the web-only mode. A deterministic pre-parse refusal (no verified
   * CBS answer) with the unverified-web section rendered below it; NOT in the
   * skip-list (this reason is exactly where the web section belongs). */
  | 'web_only'
  /** Loud internal problems (data gap, failed derivation, inconsistency,
   * invalid intent, unparseable LLM output) — an honest "cannot answer this
   * reliably right now", never a partial or guessed answer. */
  | 'internal';

/** WP16 sub-part 2 (ADR 026): the structured onboarding payload the web
 * action needs to trigger the fetch+verify+store job — the finder's confident
 * pick, verbatim. Present ONLY on an 'onboarding_pending' refusal; null on
 * every other refusal (including 'onboarding_already_pending', which triggers
 * nothing). Carries NO data value — only catalog identifiers and the finder's
 * confidence — so principle (c) is not at risk here. */
export interface OnboardingEnvelope {
  /** The CBS table id the finder confidently picked (verbatim casing — it is
   * the API id, fed straight into the ingestion pipeline). */
  tableId: string;
  /** The unmatched topic term the finder matched on (raw.unmatchedMeasureTerm). */
  topicTerm: string;
  /** The finder's 0..1 confidence in the pick (>= the 0.8 confident floor). */
  confidence: number;
  /** WP27 stage B (ADR 027 D2a): the finder's candidate chain — pick first,
   * then its allowlist-sanitized alternativeIds, cap 3. Carries only catalog
   * IDENTIFIERS (like the rest of this envelope, no data values — principle
   * (c) stays unthreatened); the web action hands it to triggerOnboarding so
   * stage C's fit gate can fall through to candidate 2 when candidate 1
   * misfits. Old audit rows predate this field — every reader treats it as
   * additive (the audit response is stored as plain JSON, reconstruct checks
   * only envelope presence, never its exact fields). */
  candidateIds: string[];
}

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
  /** WP15 (ADR 021, review finding 2026-07-04): when the clarification arose
   * from a FOLLOW-UP parse, the conversational referent that gave the
   * elliptical question its meaning ("En in Nederland?" ← unemployment) —
   * without it, the reply merge sees only the bare follow-up text and the
   * referent is lost. Absent/undefined on pre-WP15 pendings and on
   * clarifications of standalone questions; client-held, so it is
   * re-validated server-side before any use (context/validate.ts), exactly
   * like the context on a fresh question. */
  conversationContext?: ConversationContext | null;
}

interface ResponseBase {
  schemaVersion: typeof RESPONSE_SCHEMA_VERSION;
  /** The original user question, verbatim (audit; R8). */
  question: string;
  /** The full user-facing Dutch message, assembled deterministically from the
   * structured fields below — the single string a chat UI renders. NEVER
   * contains any web-derived text (WP129+130: `webSection` is the only carrier
   * of unverified web content, kept strictly separate). */
  text: string;
  /** WP129+130 (#129, ADR 032): the source-selection state this turn ran
   * under — an additive STRUCTURAL field (like WP16 `onboarding`), set ONLY by
   * attachWebAugmentation (src/websearch/attach.ts). Rides the audit envelope
   * so R8 reconstructs what was searched. Absent on every pre-WP row and on
   * every turn with no selection ⇒ readers use `?? null` (A1). */
  sourceSelection?: SourceSelection | null;
  /** WP129+130 (#130, ADR 032): the unverified-web augmentation section, stored
   * VERBATIM and replayed on reconstruction — never re-derived (the web is
   * non-deterministic). Additive; set ONLY by attachWebAugmentation. Absent on
   * pre-WP rows and whenever no web attempt was owed ⇒ `?? null` (A1). Its text
   * NEVER enters `text`, any validator input, attribution, chart data, or the
   * benchmark's fabrication scoring — the separation IS the honesty model. */
  webSection?: WebSection | null;
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
  /** WP29 (#73, ADR 029 D4): servability-gated follow-up chip texts — a
   * STRUCTURAL field assembled post-compose like `chart`, so the R8-audited
   * `text` string is byte-untouched. [] when no candidate survived the
   * dry-run gate (the UI then renders no chip block). Every chip passed the
   * echoServability dry-run in THIS request; copy is a deterministic Dutch
   * template over registry labels (no LLM, no numbers, no claims —
   * suggestions.ts). ADDITIVE: pre-WP29 audit rows lack the field; readers
   * treat absence as [] (reconstruct.ts checks only the fields it names). */
  suggestions: string[];
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
  /** WP16 sub-part 2 (ADR 026): the structured onboarding payload, set ONLY on
   * an 'onboarding_pending' refusal (null on every other refusal). The web
   * action (web/app/actions.ts) reads it to trigger the fetch+verify+store
   * job and 100-credit debit — that money orchestration lives OUTSIDE the
   * answer module (the gate.ts "wraps from the OUTSIDE" boundary), so this
   * field is the only thing the answer pipeline hands out for it. */
  onboarding: OnboardingEnvelope | null;
  /** #134(a) (ADR 029, refusal-side variant): servability-gated retry chips on
   * a period-coverage refusal — a STRUCTURAL sibling of AnswerResponse's field,
   * assembled AFTER the refusal text so the R8-audited `text` is byte-untouched.
   * Non-empty ONLY on a 'freshness' / 'outside_loaded_slice' (period-axis)
   * refusal whose boundary period dry-runs as servable (suggestions.ts
   * buildRefusalSuggestions); `[]` on every other refusal. Copy is a
   * deterministic Dutch question over a registry label + a proven-loaded period
   * code (no LLM, no numbers-as-claims). ADDITIVE: pre-#134 audit rows lack the
   * field; readers treat absence as [] (reconstruct.ts never reads it — the
   * refusal text is the only reconstructed surface). */
  suggestions: string[];
}

export type ComposedResponse = AnswerResponse | ClarificationResponse | RefusalResponse;
