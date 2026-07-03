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

function attributionLine(result: ValidatedResult): string {
  const a = result.attribution;
  const labelByCode = new Map(result.cells.map((c) => [c.periodCode, c.periodLabel]));
  const from = labelByCode.get(a.coveredPeriods.from) ?? a.coveredPeriods.from;
  const to = labelByCode.get(a.coveredPeriods.to) ?? a.coveredPeriods.to;
  const period = from === to ? from : `${from} t/m ${to}`;
  return (
    `Bron: CBS StatLine, tabel ${a.tableId} — ${a.tableTitle}. ` +
    `Gegevens gesynchroniseerd op ${a.syncedAt.slice(0, 10)}. Periode: ${period}. Licentie: ${a.license}.`
  );
}

function assemble(result: ValidatedResult, body: string, source: AnswerSource, extras: {
  model: string | null;
  usage: LlmUsage;
  attempts: ComposeAttempt[];
}): ComposedAnswer {
  const definitionLine =
    result.attribution.definitionLabel === null ? null : `Definitie: ${result.attribution.definitionLabel}.`;
  const markingLine = result.derivations.length > 0 ? `— ${DERIVED_DATA_MARKING}` : null;
  const attribution = attributionLine(result);
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
