// ADR 058 (English answers, Task 6): the orchestrator. Wires Tasks 1–5 into
// one step — mask the validated Dutch answer (no digit ever reaches the
// model), ask the model to translate the digit-free text, gate the output
// with checkTranslation's deterministic checks, fill numbers back in
// English notation, and build the English structural lines — with a
// fail-closed-to-Dutch fallback at every failure point (principle c: never
// guess, never serve an unchecked translation).
//
// `prepareTranslation` is exported on its own (Controller ruling 1) because
// it is EVERYTHING deterministic that precedes the model call, re-derivable
// from the stored AnswerResponse alone — a later task's R8 reconstruction
// calls the SAME function to recompute maskedDutch/caveats/glossary and
// compare against what was recorded, so it must depend on nothing but its
// argument.
import type { ValidatedResult } from '../../query/index.ts';
import { resolveSourceForTable } from '../../sources/registry.ts';
import type { LlmClient } from '../llm/client.ts';
import type { AnswerResponse, ComposedResponse } from '../respond/types.ts';
import { checkTranslation, type TranslationItems } from './check.ts';
import { glossaryForResult, periodLabelPairs, type GlossaryEntry } from './glossary.ts';
import {
  assembleEnglishText,
  buildEnglishLines,
  dutchAlternateLabels,
  dutchDefinitionContent,
  translateStalenessWarning,
} from './lines.ts';
import { createMasker, fillPlaceholders, hasDigitOutsidePlaceholders, type MaskEntry } from './mask.ts';
import { buildTranslateRequest, TRANSLATE_PROMPT_VERSION } from './prompt.ts';
import { ENGLISH_RENDERING_SCHEMA_VERSION, type EnglishAttempt, type EnglishRendering } from './types.ts';

/** ADR 058 §3.2: the registry's own verbatim `provisionalDisplay` suffixes,
 * paired with their fixed English form. A caveat marker is a fixed registry
 * string — never a rewording — so this table is hand-maintained here rather
 * than derived, exactly like lines.ts's DERIVED_DATA_MARKING_EN. The generic
 * ' (voorlopig cijfer)' fallback (template.ts's provisionalSuffix, used for
 * ANY status a source's provisionalDisplay map has no entry for) is included
 * unconditionally below, not just when a source's own map happens to list it.
 *
 * tests/answer/translate/translate.test.ts pins that every registered
 * source's provisionalDisplay VALUE has an entry here — an unmapped value
 * would otherwise silently fall through caveatsForResult's throw only when a
 * result happens to use that source, which is exactly the kind of gap that
 * only shows up in production (principle c: never guess, catch it in CI).
 */
export const CAVEAT_TRANSLATIONS: Readonly<Record<string, string>> = {
  ' (voorlopig cijfer)': ' (provisional figure)',
  ' (nader voorlopig cijfer)': ' (revised provisional figure)',
  ' (schatting)': ' (estimate)',
  ' (schatting door Eurostat)': ' (estimate by Eurostat)',
  ' (prognose)': ' (forecast)',
  ' (methodebreuk)': ' (break in series)',
  ' (vertrouwelijk)': ' (confidential)',
  ' (afwijkende definitie)': ' (different definition)',
  ' (lage betrouwbaarheid)': ' (low reliability)',
  ' (niet significant)': ' (not significant)',
};

/** Thrown by `caveatsForResult` when a registry `provisionalDisplay` value has
 * no entry in `CAVEAT_TRANSLATIONS` — caught by `translateAnswer` and turned
 * into a fallback with problem `'unknown caveat marker'` (never surfaced to a
 * caller as a raw exception; principle c: an untranslatable caveat means we
 * fall back to Dutch, not that we guess or crash the whole answer path). */
class UnknownCaveatError extends Error {
  constructor(dutch: string) {
    super(`unknown caveat marker: '${dutch}'`);
  }
}

/** Every distinct `provisionalDisplay` value of every source the result's
 * cells use, paired with its English form. The FULL value set of each
 * used source's map is taken — not just the values the cells' actual
 * statuses happen to trigger — because the masker must recognize any
 * caveat string the Dutch template could have produced for that source
 * (template.ts's provisionalSuffix falls back to the generic marker for an
 * unmapped status, so that marker is always included too). */
function caveatsForResult(result: ValidatedResult): { dutch: string; english: string }[] {
  const dutchValues = new Set<string>([' (voorlopig cijfer)']);
  for (const cell of result.cells) {
    const source = resolveSourceForTable(cell.tableId);
    for (const value of Object.values(source.provisionalDisplay)) dutchValues.add(value);
  }
  return [...dutchValues].map((dutch) => {
    const english = CAVEAT_TRANSLATIONS[dutch];
    if (english === undefined) throw new UnknownCaveatError(dutch);
    return { dutch, english };
  });
}

export interface PreparedTranslation {
  glossary: GlossaryEntry[];
  caveats: { dutch: string; english: string }[];
  maskedDutch: TranslationItems;
  maskTable: MaskEntry[];
  dutch: TranslationItems;
  untranslatedNames: string[];
  digitSurvived: boolean;
}

/** Everything deterministic that precedes the model call (Controller ruling
 * 1) — pure over `response`, no I/O, no model call. Re-derivable byte-for-
 * byte from a stored AnswerResponse alone. */
export function prepareTranslation(response: AnswerResponse): PreparedTranslation {
  const result = response.result;
  const glossary = glossaryForResult(result);
  // Regions that read the same in both languages are not "untranslated" —
  // only a name the shared list has genuinely no English form for counts.
  const untranslatedNames = glossary.filter((g) => !g.translated && g.kind !== 'region').map((g) => g.dutch);
  const caveats = caveatsForResult(result);
  const masker = createMasker({ periodLabels: periodLabelPairs(result), caveats });

  const dutch: TranslationItems = {
    body: response.answer.body,
    chips: response.suggestions,
    definition: dutchDefinitionContent(result),
    alternates: dutchAlternateLabels(result),
  };
  // Masked in the fixed order body, chips…, definition, alternates… so
  // placeholder ids are stable and readable (mask.ts assigns ids in mask()
  // call order).
  const maskedDutch: TranslationItems = {
    body: masker.mask(dutch.body),
    chips: dutch.chips.map((chip) => masker.mask(chip)),
    definition: dutch.definition === null ? null : masker.mask(dutch.definition),
    alternates: dutch.alternates.map((alt) => masker.mask(alt)),
  };
  const maskTable = masker.entries;
  const digitSurvived = [
    maskedDutch.body,
    ...maskedDutch.chips,
    ...(maskedDutch.definition === null ? [] : [maskedDutch.definition]),
    ...maskedDutch.alternates,
  ].some(hasDigitOutsidePlaceholders);

  return { glossary, caveats, maskedDutch, maskTable, dutch, untranslatedNames, digitSurvived };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const EMPTY_ITEMS: TranslationItems = { body: '', chips: [], definition: null, alternates: [] };

function fallbackRendering(input: {
  model: string | null;
  maskedDutch: TranslationItems;
  maskTable: MaskEntry[];
  rawTranslation: TranslationItems | null;
  attempts: EnglishAttempt[];
  untranslatedNames: string[];
}): EnglishRendering {
  return {
    schemaVersion: ENGLISH_RENDERING_SCHEMA_VERSION,
    status: 'fallback',
    promptVersion: TRANSLATE_PROMPT_VERSION,
    model: input.model,
    maskedDutch: input.maskedDutch,
    maskTable: input.maskTable,
    rawTranslation: input.rawTranslation,
    attempts: input.attempts,
    body: null,
    lines: null,
    stalenessWarning: null,
    text: null,
    chips: [],
    untranslatedNames: input.untranslatedNames,
  };
}

/** The Task 6 orchestrator (ADR 058 §3): mask → translate (up to 2 attempts)
 * → check → fill → assemble, fail-closed to Dutch at every step. NEVER
 * throws by design (every known failure mode below produces a `fallback`
 * rendering); `attachEnglish` additionally wraps the call as a last-resort
 * net for anything unanticipated. */
export async function translateAnswer(
  response: AnswerResponse,
  client: LlmClient,
  opts: { model?: string } = {},
): Promise<EnglishRendering> {
  let prep: PreparedTranslation;
  try {
    prep = prepareTranslation(response);
  } catch (error) {
    const message = errorMessage(error);
    const problems = error instanceof UnknownCaveatError ? ['unknown caveat marker'] : [];
    return fallbackRendering({
      model: null,
      maskedDutch: EMPTY_ITEMS,
      maskTable: [],
      rawTranslation: null,
      attempts: [{ ok: false, problems, error: problems.length > 0 ? null : message }],
      untranslatedNames: [],
    });
  }

  const { glossary, maskedDutch, maskTable, dutch, untranslatedNames, digitSurvived } = prep;

  if (digitSurvived) {
    return fallbackRendering({
      model: null,
      maskedDutch,
      maskTable,
      rawTranslation: null,
      attempts: [{ ok: false, problems: ['C2: digit survived masking'], error: null }],
      untranslatedNames,
    });
  }

  const attempts: EnglishAttempt[] = [];
  let model: string | null = null;
  let rawTranslation: TranslationItems | null = null;
  let retryProblems: string[] | undefined;

  // Up to 2 attempts (one fresh, one retry naming the failed checks) — the
  // same R3-style ladder compose.ts uses for the Dutch body, just shorter
  // (no template rung: the fallback here is the ALREADY-VALIDATED Dutch
  // answer, never a fabricated English one).
  for (let attempt = 0; attempt < 2; attempt++) {
    const request = buildTranslateRequest(maskedDutch, glossary, { model: opts.model, retryProblems });
    let llmResponse;
    try {
      llmResponse = await client.complete(request);
    } catch (error) {
      attempts.push({ ok: false, problems: [], error: errorMessage(error) });
      break;
    }
    model = llmResponse.model;

    let parsed: TranslationItems;
    try {
      parsed = JSON.parse(llmResponse.outputText) as TranslationItems;
    } catch {
      attempts.push({ ok: false, problems: ['unparseable output'], error: null });
      retryProblems = ['unparseable output'];
      continue;
    }
    rawTranslation = parsed;

    const problems = checkTranslation({ maskedDutch, dutch, english: parsed, glossary });
    if (problems.length > 0) {
      attempts.push({ ok: false, problems, error: null });
      retryProblems = problems;
      continue;
    }

    // Passed every deterministic check — fill placeholders and assemble.
    // Still inside a try/catch: an unexpected throw here (a placeholder
    // fillPlaceholders somehow can't resolve, a staleness shape it doesn't
    // recognize) falls back to Dutch rather than escaping (never throws).
    try {
      const filledBody = fillPlaceholders(parsed.body, maskTable);
      const filledChips = parsed.chips.map((chip) => fillPlaceholders(chip, maskTable));
      const filledDefinition = parsed.definition === null ? null : fillPlaceholders(parsed.definition, maskTable);
      const filledAlternates = parsed.alternates.map((alt) => fillPlaceholders(alt, maskTable));

      let stalenessWarning: string | null = null;
      if (response.stalenessWarning !== null) {
        stalenessWarning = translateStalenessWarning(response.stalenessWarning);
        if (stalenessWarning === null) {
          attempts.push({ ok: false, problems: ['staleness warning shape unknown'], error: null });
          return fallbackRendering({ model, maskedDutch, maskTable, rawTranslation, attempts, untranslatedNames });
        }
      }

      const lines = buildEnglishLines(response.result, { definition: filledDefinition, alternates: filledAlternates });
      const text = assembleEnglishText(filledBody, lines, stalenessWarning);
      const chips = filledChips.map((label, i) => ({ label, submit: response.suggestions[i]! }));

      attempts.push({ ok: true, problems: [], error: null });
      return {
        schemaVersion: ENGLISH_RENDERING_SCHEMA_VERSION,
        status: 'verified',
        promptVersion: TRANSLATE_PROMPT_VERSION,
        model,
        maskedDutch,
        maskTable,
        rawTranslation,
        attempts,
        body: filledBody,
        lines,
        stalenessWarning,
        text,
        chips,
        untranslatedNames,
      };
    } catch (error) {
      attempts.push({ ok: false, problems: [], error: errorMessage(error) });
      return fallbackRendering({ model, maskedDutch, maskTable, rawTranslation, attempts, untranslatedNames });
    }
  }

  return fallbackRendering({ model, maskedDutch, maskTable, rawTranslation, attempts, untranslatedNames });
}

/** Attaches an `EnglishRendering` to an answer response when English was
 * asked for and a translating client was supplied — returns the SAME object
 * (never a copy) otherwise, so a caller that doesn't opt in pays no cost and
 * sees byte-identical behavior. NEVER throws: `translateAnswer` already
 * fails closed to a `fallback` rendering at every known failure point; this
 * try/catch is the last-resort net for anything unanticipated, so a thrown
 * error becomes a `fallback` rendering with the message recorded rather than
 * an unhandled rejection reaching the caller. */
export async function attachEnglish(
  response: ComposedResponse,
  opts: { lang?: 'nl' | 'en'; client?: LlmClient } = {},
): Promise<ComposedResponse> {
  if (opts.lang !== 'en' || !opts.client || response.kind !== 'answer') return response;
  try {
    const english = await translateAnswer(response, opts.client, {});
    return { ...response, english };
  } catch (error) {
    const english = fallbackRendering({
      model: null,
      maskedDutch: EMPTY_ITEMS,
      maskTable: [],
      rawTranslation: null,
      attempts: [{ ok: false, problems: [], error: errorMessage(error) }],
      untranslatedNames: [],
    });
    return { ...response, english };
  }
}
