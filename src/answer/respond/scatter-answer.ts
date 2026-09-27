// Two-measure scatter (spec docs/superpowers/specs/2026-09-27-two-measure-scatter-design.md,
// open-questions #296 part 2 Task 4): the template-only scatter ANSWER.
//
// respondToIntent (respond.ts) branches here once runPairQuery has served a
// pair intent; everything that turns the two stored legs into a response lives
// in this file so respond.ts only grows by the branch itself.
//
// No LLM anywhere (spec D7, global constraints): no phrasing model, no
// semantic check, and no English translation — English for a scatter answer
// is derived at render time in the web layer from the stored (Dutch) spec, so
// the two audited wrappers skip attachEnglish for it (isScatterAnswer below).
//
// R1/R8 without the body validator: the Dutch body (scatterBodyNl) carries NO
// data value — every count lives in the structural `scatterLine`, every
// plotted number in the ScatterSpec with one result id per axis — so it is
// NOT run through validateAnswerBody, which is a SINGLE-result validator (it
// would read the x leg's measure title against the y leg's cells). What holds
// R1/R8 instead is that `composeScatterAnswer` is a pure function of the two
// stored legs, and audit/reconstruct.ts re-runs it and compares the spec,
// body, coverage line, attribution and text byte-for-byte.
import type { Db } from '../../db/types.ts';
import type { PairedResults, StructuredIntent, ValidatedResult } from '../../query/index.ts';
import { buildScatterSpec, scatterBodyNl, scatterLineNl } from '../../chart/index.ts';
import type { ScatterSpec } from '../../chart/index.ts';
import { buildAttributionLine } from '../compose/format.ts';
import { COMPOSE_PROMPT_VERSION } from '../compose/prompt.ts';
import { ANSWER_SCHEMA_VERSION } from '../compose/types.ts';
import type { ComposedAnswer } from '../compose/types.ts';
import type { ParseOutcome } from '../intent/types.ts';
import { checkStaleness } from './staleness.ts';
import type { AnswerResponse, ComposedResponse } from './types.ts';
import { RESPONSE_SCHEMA_VERSION } from './types.ts';

/** A scatter answer, by envelope shape: the one discriminator every consumer
 * (the audited wrappers, write.ts, reconstruct.ts) keys on. `?? undefined`
 * reads (A1): the keys are present-only. */
export function isScatterAnswer(response: ComposedResponse): response is AnswerResponse & { scatter: ScatterSpec } {
  return response.kind === 'answer' && response.scatter !== undefined;
}

/** The full pair intent an audited scatter answer rests on, re-derived from
 * the two stored legs: the y leg's own (pairWith-stripped) intent plus the x
 * leg's target as `pairWith` — so the audited intent (and its hash) is the
 * two-measure question that was asked, never the y leg's one-measure one. */
export function pairIntentOf(result: ValidatedResult, pairedResult: ValidatedResult): StructuredIntent {
  return { ...result.intent, pairWith: pairedResult.intent.target };
}

/** Everything the scatter answer shows, as a pure function of the two legs
 * (R6/R8) — the ONE builder respond and reconstruct both call. */
export function composeScatterAnswer(
  result: ValidatedResult,
  pairedResult: ValidatedResult,
): { scatter: ScatterSpec; answer: ComposedAnswer } {
  const scatter = buildScatterSpec(result, pairedResult);
  const body = scatterBodyNl(scatter);
  const scatterLine = scatterLineNl(scatter);
  const attributionLine = buildAttributionLine(result);
  const pairedAttributionLine = buildAttributionLine(pairedResult);
  // The compose.ts assemble() join: the body, a blank line, then the
  // structural lines one per line — the coverage line first (the slot
  // regionSetLine takes), then the R4 attribution sentences, y leg first
  // (two tables, two sentences — spec D7). A staleness warning is NOT part of
  // answer.text: respondToIntent appends it to the response `text` after a
  // blank line, exactly as the one-measure path does.
  const text = [body, '', scatterLine, attributionLine, pairedAttributionLine].join('\n');
  const answer: ComposedAnswer = {
    schemaVersion: ANSWER_SCHEMA_VERSION,
    source: 'template',
    body,
    scatterLine,
    definitionLine: null,
    markingLine: null,
    attributionLine,
    text,
    model: null,
    // The version in force, as every template-composed answer records it
    // (compose.ts assemble()'s default) — no prompt was sent.
    promptVersion: COMPOSE_PROMPT_VERSION,
    usage: { inputTokens: 0, outputTokens: 0 },
    attempts: [],
    // Truthful for a body with no data value: there is nothing for the
    // single-result validator to back (see the header), so no violation —
    // `ok` iff `problems` is empty, the validator's own contract. R1/R8 are
    // held by the byte-identical re-derivation in audit/reconstruct.ts.
    validation: { ok: true, problems: [] },
  };
  return { scatter, answer };
}

/** docs/05 staleness row, per leg: `staleLeg` is the first leg (y first)
 * whose table is past its cadence — the one a recency-implying question
 * refuses on, exactly as the one-measure path does — and `warning` joins
 * every stale leg's warning (y first, one per line) for the warn-and-serve
 * branch; null when neither leg is stale. */
export async function checkPairStaleness(
  db: Db,
  paired: PairedResults,
  referenceDate: string,
): Promise<{ staleLeg: ValidatedResult | null; warning: string | null }> {
  let staleLeg: ValidatedResult | null = null;
  const warnings: string[] = [];
  for (const leg of [paired.result, paired.pairedResult]) {
    const check = await checkStaleness(db, leg, referenceDate);
    if (!check.stale) continue;
    staleLeg ??= leg;
    if (check.warning !== null) warnings.push(check.warning);
  }
  return { staleLeg, warning: warnings.length > 0 ? warnings.join('\n') : null };
}

/** The scatter AnswerResponse: `result` = y leg, `pairedResult` = x leg,
 * `chart: null` (a scatter is its own spec, D8), no alternates, no chips and
 * no carrier (D11: no follow-ups off a scatter in v1). */
export function buildScatterAnswerResponse(
  question: string,
  parse: Extract<ParseOutcome, { kind: 'intent' }>,
  paired: PairedResults,
  stalenessWarning: string | null,
): AnswerResponse {
  const { scatter, answer } = composeScatterAnswer(paired.result, paired.pairedResult);
  return {
    schemaVersion: RESPONSE_SCHEMA_VERSION,
    question,
    text: stalenessWarning === null ? answer.text : `${answer.text}\n\n${stalenessWarning}`,
    kind: 'answer',
    answer,
    chart: null,
    chartAlternates: [],
    stalenessWarning,
    parse,
    result: paired.result,
    pairedResult: paired.pairedResult,
    scatter,
    suggestions: [],
  };
}
