// WP15 follow-up parsing: a NEW question parsed with the PREVIOUS turn's
// resolved intent offered as a merge candidate (ADR 021, open-questions #57)
// — the WP9 clarify-reply mechanism generalized. "En in Rotterdam?" after a
// population answer keeps the topic and period and swaps the region.
//
// Confinement is identical to WP6/WP9 (ADR 004/012): the LLM sees the new
// question plus a STRUCTURED previous intent — registry vocabulary only
// (canonical key, registry-labelled region names, a concrete period shape),
// server-validated before use, never chat history, never data — and emits the
// same schema-validated RawParse vocabulary. Deterministic code still owns
// name→code resolution and the R7 thresholds. A follow-up is a fresh question
// with a fresh clarification round: finalRound stays with the reply flow.
//
// HASH-STABILITY: this module APPENDS a mode section to the WP6 system prompt
// builder's output. It must never modify prompt.ts's bytes — the recorded
// intent fixtures hash the base prompt verbatim, and the clarify fixtures
// hash base + clarify section (ADR 012/021). This section's own bytes are
// part of every follow-up fixture hash: keep the text stable.
import type { Db } from '../../db/types.ts';
import { echoServability } from '../../query/index.ts';
import type { ConversationContext } from '../context/types.ts';
import { INTENT_MODEL, type IntentLlmClient, type IntentLlmRequest } from './client.ts';
import { MAX_CANDIDATES, REFUSAL_KIND_BY_QUESTION_KIND, extraKeysOf } from './parse.ts';
import { buildSystemPrompt, type OnboardedMeasure } from './prompt.ts';
import { rawParseJsonSchema, validateRawParse } from './schema.ts';
import { resolveCandidate } from './resolve.ts';
import { resolveUnmatched, decide, type OutcomeContext, type TableFinder } from './policy.ts';
import { DEFAULT_PARSER_CONFIG, type ParseOutcome, type ParserConfig } from './types.ts';

/** Bump when the follow-up mode section or payload shape changes
 * meaningfully — recorded in every follow-up fixture and the audit record.
 * v2 (2026-07-04, calibration run 1): topic-switch rule strengthened after
 * the model silently dropped an inherited region on a national-only topic
 * switch ("regio vervalt omdat werkloosheid alleen landelijk beschikbaar
 * is" — its own reading) — the WP6 dropped-region failure mode on a new
 * surface; fixed by a rule, not a threshold, exactly like calibration run 1
 * of WP6 itself.
 * v3 (2026-07-04, calibration run 2): chart-request rule strengthened after
 * the model widened an inherited single period into an unrequested
 * open-ended range ("period wordt uitgebreid van enkel 2024 naar een reeks
 * vanaf 2024" — its own note). Its 0.88 confidence happened to trip the R7
 * clarify, but the guard must be the deterministic degenerate-range check,
 * never the model's self-doubt (principle c). */
export const FOLLOWUP_PROMPT_VERSION = 3;

export interface FollowUpOptions {
  client: IntentLlmClient;
  referenceDate: string;
  config?: ParserConfig;
  model?: string;
  maxTokens?: number;
  /** WP16 sub-part 2 (ADR 026): OPTIONAL table-finder, same seam as
   * ParseQuestionOptions — a follow-up whose topic matches nothing loaded can
   * also route to the on-demand fetch trigger. Absent → B15, byte-identical. */
  tableFinder?: TableFinder;
  /** WP16 sub-part 2 (ADR 026): OPTIONAL onboarded measures appended to the
   * vocabulary, same seam as ParseQuestionOptions. Absent/empty → byte-
   * identical follow-up prompt (fixtures unaffected). */
  extraCanonicalMeasures?: OnboardedMeasure[];
}

/** The follow-up-mode instruction, appended verbatim to the WP6 system prompt
 * so the vocabulary/region/period/derivation rules stay a single source of
 * truth. Keep this text stable: its bytes are part of every follow-up fixture
 * hash. */
export const FOLLOWUP_MODE_SECTION = `

# Follow-up mode

This request carries conversational context. You receive a JSON object instead of a bare question:

{"previous_intent": {"topicKey": ..., "regions": [...] | null, "period": {...} | null, "derivation": ...}, "question": ...}

previous_intent is what the user's PREVIOUS question resolved to, in your own vocabulary: topicKey is a key from the vocabulary above, regions carries registry place names, period is a concrete period. It is the referent for continuations — "en ...?", "dit", "dat", "daar", an elliptical question that only names what changes.

Rules for this mode:

- First judge: is the question a CONTINUATION of previous_intent, or self-contained? A self-contained question (it names its own topic and enough axes to stand alone) is parsed exactly as in normal mode — ignore previous_intent entirely, including for its kind (forecast_request, causal_question, out_of_scope, compound, smalltalk_or_other all keep their normal meaning).
- For a continuation, emit the MERGED reading: copy every previous_intent axis the question does not change VERBATIM (topicKey, region names and kinds, the period shape), and replace only what the question changes. "En in Rotterdam?" changes the region; "En in 2020?" the period; "En de werkloosheid?" the topic.
- Never inherit an axis the question overrides, and never invent an axis neither the question nor previous_intent states. A previous_intent with period null contributes no period: if the continuation names none either, emit {"kind":"none"} — code will ask, never guess.
- A topic switch keeps the previous regions and period (the user is still in that frame): "En de werkloosheid?" after a question about Amsterdam asks about unemployment IN AMSTERDAM. Copy the inherited regions VERBATIM — NEVER drop or silently replace them, not even when the new topic's vocabulary entry says "alleen landelijk", and do not lower your confidence for that reason alone: an inherited region on a national-only measure is a question code answers with an honest limit, exactly like the base rule for named places. Reading such a follow-up as if it asked about heel Nederland is wrong.
- A chart/graph/series request about the referent ("kun je dit in een grafiek zetten?", "laat de ontwikkeling zien") is a data_query continuation, NOT smalltalk: same topicKey and regions, derivation "series", period EXACTLY as previous_intent states it. A single period stays that single period — NEVER widen it into a "since"/"last_n"/range the question did not state: which window the chart should cover is genuinely the user's call, and code will ask. Guessing a window is wrong even at high confidence.
- Meta-questions about the previous ANSWER itself — its source table, when it was last updated, methodology, which sources were used — are smalltalk_or_other, exactly as in normal mode. previous_intent does not turn product questions into data questions.
- "Waarom ...?" about the referent asks for a cause: causal_question, as in normal mode.
- When continuation vs. self-contained is genuinely unclear, emit BOTH readings as separate candidates with honest confidences — the normal ambiguity machinery decides.
- Confidence keeps its normal meaning, applied to the reading you emit.

The output schema is unchanged.

Voorbeeld (previous_intent: {"topicKey":"population_on_1_january","regions":[{"name":"Amsterdam","kind":"gemeente"}],"period":{"kind":"year","year":2024},"derivation":"none"}):
Vraag: "En in Rotterdam?"
{"version":3,"kind":"data_query","candidates":[{"canonicalKey":"population_on_1_january","regions":[{"name":"Rotterdam","kind":"gemeente"}],"period":{"kind":"year","year":2024},"derivation":"none","confidence":0.95,"reading":"bevolking van Rotterdam in 2024 (vervolg op de vorige vraag)"}],"unmatchedMeasureTerm":null,"nearestCanonicalKeys":[],"note":null}

Zelfde previous_intent, Vraag: "Hoeveel zonnestroom werd er in 2023 opgewekt?"
Zelfstandige vraag — normal mode: {"version":3,"kind":"data_query","candidates":[{"canonicalKey":"solar_electricity_production","regions":null,"period":{"kind":"year","year":2023},"derivation":"none","confidence":0.95,"reading":"opgewekte zonnestroom in 2023"}],"unmatchedMeasureTerm":null,"nearestCanonicalKeys":[],"note":null}`;

export function buildFollowUpSystemPrompt(extra: OnboardedMeasure[] = []): string {
  return buildSystemPrompt(extra) + FOLLOWUP_MODE_SECTION;
}

/** The user-turn payload. Serialized deterministically (stable key order as
 * written) — these bytes are part of the fixture hash. */
export function buildFollowUpUserPayload(context: ConversationContext, question: string): string {
  return JSON.stringify({
    previous_intent: {
      topicKey: context.topicKey,
      regions: context.regions,
      period: context.period,
      derivation: context.derivation,
    },
    question,
  });
}

export function buildFollowUpRequest(
  context: ConversationContext,
  question: string,
  options: Pick<FollowUpOptions, 'model' | 'maxTokens' | 'extraCanonicalMeasures'> = {},
): IntentLlmRequest {
  return {
    model: options.model ?? INTENT_MODEL,
    maxTokens: options.maxTokens ?? 2048,
    temperature: 0,
    system: buildFollowUpSystemPrompt(options.extraCanonicalMeasures ?? []),
    question: buildFollowUpUserPayload(context, question),
    jsonSchema: rawParseJsonSchema(extraKeysOf(options.extraCanonicalMeasures)),
  };
}

/** Parse a follow-up question with the previous turn's resolved intent as
 * merge candidate. Same downstream machinery as parseQuestion: deterministic
 * resolution against THIS turn's referenceDate (a follow-up is a fresh
 * question — only clarify replies pin the original clock), the same R7
 * thresholds, the same servability check on echo suggestions (#56). */
export async function parseFollowUpQuestion(
  db: Db,
  context: ConversationContext,
  question: string,
  options: FollowUpOptions,
): Promise<ParseOutcome> {
  const request = buildFollowUpRequest(context, question, options);
  const response = await options.client.complete(request);
  const raw = validateRawParse(response.outputText, extraKeysOf(options.extraCanonicalMeasures));

  const outcomeContext: OutcomeContext = {
    question,
    raw,
    model: response.model,
    usage: response.usage,
  };

  if (raw.kind !== 'data_query') {
    return {
      kind: 'refusal',
      ...outcomeContext,
      refusalKind: REFUSAL_KIND_BY_QUESTION_KIND[raw.kind],
      note: raw.note,
    };
  }

  if (raw.candidates.length === 0) return resolveUnmatched(outcomeContext, options.tableFinder);

  const resolutions = await Promise.all(
    raw.candidates
      .slice(0, MAX_CANDIDATES)
      .map((candidate) => resolveCandidate(db, candidate, options.referenceDate)),
  );
  return decide(
    outcomeContext,
    resolutions,
    options.config ?? DEFAULT_PARSER_CONFIG,
    (intent) => echoServability(db, intent),
    options.tableFinder,
  );
}
