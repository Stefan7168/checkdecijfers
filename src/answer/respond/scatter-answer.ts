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
import { buildAttributionLine, buildDefinitionLine } from '../compose/format.ts';
import { COMPOSE_PROMPT_VERSION } from '../compose/prompt.ts';
import { ANSWER_SCHEMA_VERSION } from '../compose/types.ts';
import type { ComposedAnswer } from '../compose/types.ts';
import type { ParseOutcome } from '../intent/types.ts';
import { checkStaleness } from './staleness.ts';
import type { AnswerResponse, ComposedResponse } from './types.ts';
import { RESPONSE_SCHEMA_VERSION } from './types.ts';

/** A scatter answer, by envelope shape: THE one discriminator every consumer
 * (the audited wrappers, write.ts, reconstruct.ts) keys on. True when EITHER
 * present-only scatter key is on the envelope — respond always sets both
 * together, and reconstruct fails a row carrying only one of the two, so
 * keying on "either" routes a half-tampered row to the check that catches it.
 * Readers still read the data itself with `?? null` (A1). */
export function isScatterAnswer(response: ComposedResponse): boolean {
  return response.kind === 'answer' && (response.scatter !== undefined || response.pairedResult !== undefined);
}

/** The x leg of a scatter answer as stored (null on every other response,
 * and on a half-tampered scatter row missing it) — read through the SAME
 * predicate, so every consumer agrees on what a scatter answer is. */
export function pairedResultOf(response: ComposedResponse): ValidatedResult | null {
  return isScatterAnswer(response) ? ((response as AnswerResponse).pairedResult ?? null) : null;
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
  // docs/05: an answer always states the chosen definition — here BOTH
  // measures', y first, through the same builder the one-measure answer uses.
  // No alternatesLine: alternate readings belong to the one-measure answer
  // (a scatter pairs the two canonical defaults, nothing to toggle).
  const definitionLine = buildDefinitionLine(result);
  const pairedDefinitionLine = buildDefinitionLine(pairedResult);
  const attributionLine = buildAttributionLine(result);
  const pairedAttributionLine = buildAttributionLine(pairedResult);
  // The compose.ts assemble() join: the body, a blank line, then the
  // structural lines one per line in assemble()'s slot order — the coverage
  // line (the slot regionSetLine takes), the definitions (y, then x), then
  // the R4 attribution sentences, y leg first (two tables, two sentences —
  // spec D7). A staleness warning is NOT part of answer.text:
  // respondToIntent appends it to the response `text` after a blank line,
  // exactly as the one-measure path does.
  const text = [
    body,
    '',
    scatterLine,
    ...(definitionLine ? [definitionLine] : []),
    ...(pairedDefinitionLine ? [pairedDefinitionLine] : []),
    attributionLine,
    pairedAttributionLine,
  ].join('\n');
  const answer: ComposedAnswer = {
    schemaVersion: ANSWER_SCHEMA_VERSION,
    source: 'template',
    body,
    scatterLine,
    definitionLine,
    pairedDefinitionLine,
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
    // Named: two tables, so each warning says which one it is about.
    const check = await checkStaleness(db, leg, referenceDate, { namedTable: true });
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
