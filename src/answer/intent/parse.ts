// WP6 orchestrator: Dutch question → ParseOutcome. One LLM call behind the
// client seam, schema validation at the call site (R7), then deterministic
// resolution and the threshold policy. The reference date is a caller input
// so relative periods stay testable (clock-injected, docs/05 staleness rule).
import type { Db } from '../../db/types.ts';
import { echoServability } from '../../query/index.ts';
import { buildSystemPrompt, type OnboardedMeasure } from './prompt.ts';
import { rawParseJsonSchema, validateRawParse } from './schema.ts';
import { INTENT_MODEL, type IntentLlmClient, type IntentLlmRequest } from './client.ts';
import { resolveCandidate } from './resolve.ts';
import { resolveUnmatched, decide, type OutcomeContext, type TableFinder } from './policy.ts';
import { DEFAULT_PARSER_CONFIG, type ParseOutcome, type ParserConfig } from './types.ts';

export interface ParseQuestionOptions {
  client: IntentLlmClient;
  /** YYYY-MM-DD "today" for relative periods ("vorige maand") — injected,
   * never read from the wall clock inside the pipeline. */
  referenceDate: string;
  config?: ParserConfig;
  model?: string;
  maxTokens?: number;
  /** WP16 sub-part 2 (ADR 026): OPTIONAL table-finder — present only when the
   * caller (web/app/actions.ts) wants an unmatched topic to route to the
   * on-demand fetch trigger. Absent everywhere else (benchmark, tests, CLI) →
   * the plain B15 clarification, byte-identical. */
  tableFinder?: TableFinder;
  /** WP16 sub-part 2 (ADR 026, design §3.6/§0.4): OPTIONAL extra canonical
   * measures appended to the parser vocabulary — the on-demand-onboarded
   * measures registered by the fetch job. Absent/empty → the prompt bytes are
   * IDENTICAL to Phase-0-only (recorded fixtures + benchmark unaffected by
   * construction). The delivery re-run passes the just-onboarded measure(s) so
   * the parser can actually emit their canonical key and the answer flows
   * through the full validator chain (without this the re-run would re-hit the
   * unmatched exit and dead-end in a refund — the parser prompt is built from
   * code, so a DB-only canonical row is invisible to it: see the HANDOFF's
   * "delivery vocabulary" deviation). */
  extraCanonicalMeasures?: OnboardedMeasure[];
}

/** Up to this many readings are considered; the schema asks for 1–3. */
export const MAX_CANDIDATES = 3;

export const REFUSAL_KIND_BY_QUESTION_KIND = {
  forecast_request: 'forecast',
  causal_question: 'causal',
  out_of_scope: 'out_of_scope',
  compound: 'compound',
  smalltalk_or_other: 'smalltalk',
} as const;

/** The extra canonical KEYS the onboarded measures contribute — the string set
 * the schema/JSON-schema widen with (design §3.6). Empty when no onboarded
 * measures are injected. */
export function extraKeysOf(measures: OnboardedMeasure[] | undefined): string[] {
  return (measures ?? []).map((m) => m.measure.key);
}

export function buildIntentRequest(
  question: string,
  options: Pick<ParseQuestionOptions, 'model' | 'maxTokens' | 'extraCanonicalMeasures'> = {},
): IntentLlmRequest {
  const extraKeys = extraKeysOf(options.extraCanonicalMeasures);
  return {
    model: options.model ?? INTENT_MODEL,
    maxTokens: options.maxTokens ?? 2048,
    temperature: 0,
    // Empty extra → byte-identical Phase-0 prompt + schema (the fixture-hash
    // guarantee): buildSystemPrompt([]) and rawParseJsonSchema([]) both return
    // the pre-WP16-sub-2 bytes.
    system: buildSystemPrompt(options.extraCanonicalMeasures ?? []),
    question,
    jsonSchema: rawParseJsonSchema(extraKeys),
  };
}

export async function parseQuestion(
  db: Db,
  question: string,
  options: ParseQuestionOptions,
): Promise<ParseOutcome> {
  const request = buildIntentRequest(question, options);
  const response = await options.client.complete(request);
  // Validate against the SAME (possibly widened) vocabulary the request
  // advertised — the onboarded keys are legal here for the delivery re-run.
  const raw = validateRawParse(response.outputText, extraKeysOf(options.extraCanonicalMeasures));

  const context: OutcomeContext = {
    question,
    raw,
    model: response.model,
    usage: response.usage,
  };

  if (raw.kind !== 'data_query') {
    return {
      kind: 'refusal',
      ...context,
      refusalKind: REFUSAL_KIND_BY_QUESTION_KIND[raw.kind],
      note: raw.note,
    };
  }

  if (raw.candidates.length === 0) return resolveUnmatched(context, options.tableFinder);

  const resolutions = await Promise.all(
    raw.candidates
      .slice(0, MAX_CANDIDATES)
      .map((candidate) => resolveCandidate(db, candidate, options.referenceDate)),
  );
  return decide(
    context,
    resolutions,
    options.config ?? DEFAULT_PARSER_CONFIG,
    (intent) => echoServability(db, intent),
    options.tableFinder,
  );
}
