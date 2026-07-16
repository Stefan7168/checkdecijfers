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
import { runSemanticCheck, type SemanticCheckOptions, type SemanticCheckOutcome } from './semantic-check.ts';
import { renderTemplateBody } from './template.ts';
import { validateAnswerBody } from './validate.ts';
import type { AnswerSource, ComposeAttempt, ComposedAnswer, SemanticCheckRecord } from './types.ts';
import { ANSWER_SCHEMA_VERSION } from './types.ts';

export interface ComposeOptions {
  client: LlmClient;
  model?: string;
  maxTokens?: number;
  /** #144 (ADR 034): the additive, reject-only semantic checker. Absent = off
   * (benchmark, tests, CLI — zero behavior and zero envelope-byte changes).
   * When present, an LLM body that passed the deterministic validator but
   * leaned on a residual-prone exemption gets one cheap-tier second read; a
   * fabricated verdict drops down the SAME R3 ladder (regenerate, then
   * template). The checker can only reject — never approve (principle a). */
  semanticCheck?: SemanticCheckOptions;
}

function assemble(result: ValidatedResult, rawBody: string, source: AnswerSource, extras: {
  model: string | null;
  usage: LlmUsage;
  attempts: ComposeAttempt[];
  /** #144: the checker's verdict on THIS served body — the key is only
   * serialized when the checker actually ran its gate (feature on, LLM body),
   * so pre-feature envelopes stay byte-identical (A1). */
  semanticCheck?: SemanticCheckRecord;
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
    ...(extras.semanticCheck !== undefined ? { semanticCheck: extras.semanticCheck } : {}),
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
        if (!validation.ok) {
          attempts.push({ kind, ok: false, problems: validation.problems, error: null });
          continue;
        }
        // #144 (ADR 034): the semantic second pass — only when configured, and
        // runSemanticCheck itself only calls the LLM when the body leaned on a
        // residual-prone exemption (most answers skip the call). A rejection
        // takes the SAME ladder rung a deterministic failure would; the
        // verdict is stored only with the body it cleared. The check runs on
        // the SPLICED body — the exact string assemble() stores as
        // answer.body (applyUnitExpansions is deterministic and idempotent:
        // its double-render belt skips an already-present figure) — so R8 can
        // re-derive the suspect list from the stored row byte-exactly.
        let check: SemanticCheckOutcome | null = null;
        if (options.semanticCheck) {
          check = await runSemanticCheck(applyUnitExpansions(body, result), result, options.semanticCheck);
          usage.inputTokens += check.usage.inputTokens;
          usage.outputTokens += check.usage.outputTokens;
          if (check.reject) {
            attempts.push({ kind, ok: false, problems: check.problems, error: null });
            continue;
          }
        }
        attempts.push({ kind, ok: true, problems: validation.problems, error: null });
        return assemble(result, body, kind, {
          model: response.model,
          usage,
          attempts,
          ...(check !== null ? { semanticCheck: check.record } : {}),
        });
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
