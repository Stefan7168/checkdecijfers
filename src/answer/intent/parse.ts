// WP6 orchestrator: Dutch question → ParseOutcome. One LLM call behind the
// client seam, schema validation at the call site (R7), then deterministic
// resolution and the threshold policy. The reference date is a caller input
// so relative periods stay testable (clock-injected, docs/05 staleness rule).
import type { Db } from '../../db/types.ts';
import { buildSystemPrompt } from './prompt.ts';
import { rawParseJsonSchema, validateRawParse } from './schema.ts';
import { INTENT_MODEL, type IntentLlmClient, type IntentLlmRequest } from './client.ts';
import { resolveCandidate } from './resolve.ts';
import { buildUnmatchedClarification, decide, type OutcomeContext } from './policy.ts';
import { DEFAULT_PARSER_CONFIG, type ParseOutcome, type ParserConfig } from './types.ts';

export interface ParseQuestionOptions {
  client: IntentLlmClient;
  /** YYYY-MM-DD "today" for relative periods ("vorige maand") — injected,
   * never read from the wall clock inside the pipeline. */
  referenceDate: string;
  config?: ParserConfig;
  model?: string;
  maxTokens?: number;
}

/** Up to this many readings are considered; the schema asks for 1–3. */
const MAX_CANDIDATES = 3;

const REFUSAL_KIND_BY_QUESTION_KIND = {
  forecast_request: 'forecast',
  causal_question: 'causal',
  out_of_scope: 'out_of_scope',
  compound: 'compound',
  smalltalk_or_other: 'smalltalk',
} as const;

export function buildIntentRequest(
  question: string,
  options: Pick<ParseQuestionOptions, 'model' | 'maxTokens'> = {},
): IntentLlmRequest {
  return {
    model: options.model ?? INTENT_MODEL,
    maxTokens: options.maxTokens ?? 2048,
    temperature: 0,
    system: buildSystemPrompt(),
    question,
    jsonSchema: rawParseJsonSchema(),
  };
}

export async function parseQuestion(
  db: Db,
  question: string,
  options: ParseQuestionOptions,
): Promise<ParseOutcome> {
  const request = buildIntentRequest(question, options);
  const response = await options.client.complete(request);
  const raw = validateRawParse(response.outputText);

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

  if (raw.candidates.length === 0) return buildUnmatchedClarification(context);

  const resolutions = await Promise.all(
    raw.candidates
      .slice(0, MAX_CANDIDATES)
      .map((candidate) => resolveCandidate(db, candidate, options.referenceDate)),
  );
  return decide(context, resolutions, options.config ?? DEFAULT_PARSER_CONFIG);
}
