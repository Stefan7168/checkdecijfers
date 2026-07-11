// WP7 orchestrator: ValidatedResult → ComposedAnswer.
//
// The R3 fail-closed ladder: one LLM attempt → blocking validator → one
// stricter regeneration → validator → deterministic template. Any API error
// or refusal on the LLM path drops straight down the ladder — the pipeline
// never throws an answer away and never serves an unvalidated one.
//
// Attribution (R4), the definition statement (canonical-default transparency)
// and the CC BY derived-data marking (R5) are assembled HERE, from validated
// fields, after the body is settled — no LLM output can add, alter or drop
// them.
import type { ValidatedResult } from '../../query/index.ts';
import { DERIVED_DATA_MARKING } from '../../query/index.ts';
import type { LlmClient, LlmUsage } from '../llm/client.ts';
import { applyUnitExpansions } from './expand.ts';
import { buildAttributionLine, buildDefinitionLine } from './format.ts';
import { buildPhrasingRequest, COMPOSE_PROMPT_VERSION, PHRASING_MODEL } from './prompt.ts';
import { renderTemplateBody } from './template.ts';
import { validateAnswerBody } from './validate.ts';
import type { AnswerSource, ComposeAttempt, ComposedAnswer } from './types.ts';
import { ANSWER_SCHEMA_VERSION } from './types.ts';

export interface ComposeOptions {
  client: LlmClient;
  model?: string;
  maxTokens?: number;
}

function assemble(result: ValidatedResult, rawBody: string, source: AnswerSource, extras: {
  model: string | null;
  usage: LlmUsage;
  attempts: ComposeAttempt[];
}): ComposedAnswer {
  // #125a (ADR 031 D4): once the body is settled — validated LLM prose or the
  // by-construction-valid template — splice the registered unit expansions in
  // ("390,2 x 1000 (= 390.200)"). The helper re-validates the spliced body and
  // falls back to the untouched one on any doubt; the SPLICED body is what
  // gets stored, so R8 reconstruction re-validates exactly what was shown.
  const body = applyUnitExpansions(rawBody, result);
  // The "Definitie:" line — built by the single shared source of truth in
  // format.ts (buildDefinitionLine), which audit/reconstruct.ts also uses to
  // RE-DERIVE it for R8 verification, so the two can never drift (#115 review).
  // It prefers a real captured CBS definition (definitionText, lever b) and
  // otherwise falls back to the short definitionLabel with the circular-title
  // suppression (lever a).
  const definitionLine = buildDefinitionLine(result);
  const markingLine = result.derivations.length > 0 ? `— ${DERIVED_DATA_MARKING}` : null;
  const attribution = buildAttributionLine(result);
  const text = [body, '', ...(definitionLine ? [definitionLine] : []), ...(markingLine ? [markingLine] : []), attribution].join('\n');
  return {
    schemaVersion: ANSWER_SCHEMA_VERSION,
    source,
    body,
    definitionLine,
    markingLine,
    attributionLine: attribution,
    text,
    model: extras.model,
    promptVersion: COMPOSE_PROMPT_VERSION,
    usage: extras.usage,
    attempts: extras.attempts,
    validation: validateAnswerBody(body, result),
  };
}

export async function composeAnswer(result: ValidatedResult, options: ComposeOptions): Promise<ComposedAnswer> {
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  const attempts: ComposeAttempt[] = [];

  // Results with null-valued cells skip the LLM entirely: the honest answer
  // is the CBS reason, which the template states deterministically — an LLM
  // adds phrasing risk to an answer that contains no number to phrase.
  const hasNullCells = result.cells.some((c) => c.value === null);

  if (!hasNullCells) {
    for (const strict of [false, true]) {
      const kind = strict ? ('llm_retry' as const) : ('llm' as const);
      try {
        const request = buildPhrasingRequest(result, {
          model: options.model,
          maxTokens: options.maxTokens,
          strict,
        });
        const response = await options.client.complete(request);
        usage.inputTokens += response.usage.inputTokens;
        usage.outputTokens += response.usage.outputTokens;
        const body = response.outputText.trim();
        const validation = validateAnswerBody(body, result);
        attempts.push({ kind, ok: validation.ok, problems: validation.problems, error: null });
        if (validation.ok) {
          return assemble(result, body, kind, {
            model: response.model,
            usage,
            attempts,
          });
        }
      } catch (error) {
        attempts.push({
          kind,
          ok: false,
          problems: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // Fail closed: the deterministic template (R3).
  return assemble(result, renderTemplateBody(result), 'template', {
    model: null,
    usage,
    attempts,
  });
}

export { PHRASING_MODEL };
