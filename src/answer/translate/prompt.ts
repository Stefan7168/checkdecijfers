// ADR 058 (English answers, Task 6): the translate-prompt. The model NEVER
// sees a digit (mask.ts already replaced every number, period and caveat
// marker with a digit-free placeholder before this request is built) — its
// only job is fluent English prose around placeholders it must copy
// verbatim, and a glossary of names it must use exactly. Numbers are filled
// back in by deterministic code (mask.ts's fillPlaceholders) AFTER the
// model's output has passed checkTranslation (principle a: the LLM never
// computes or interprets a number, here it never even sees one).
import type { LlmRequest } from '../llm/client.ts';
import { PHRASING_MODEL } from '../compose/prompt.ts';
import type { GlossaryEntry } from './glossary.ts';
import type { TranslationItems } from './check.ts';

/** Bump when the prompt's structure or rules change meaningfully — recorded
 * on the EnglishRendering (R8-equivalent for the English path). */
export const TRANSLATE_PROMPT_VERSION = 1;

/** output_config.format JSON schema (src/answer/llm/client.ts): forces the
 * model's output into exactly the shape checkTranslation expects — the same
 * four keys as TranslationItems, no more, no less. */
export const TRANSLATE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    body: { type: 'string' },
    chips: { type: 'array', items: { type: 'string' } },
    definition: { type: ['string', 'null'] },
    alternates: { type: 'array', items: { type: 'string' } },
  },
  required: ['body', 'chips', 'definition', 'alternates'],
  additionalProperties: false,
};

/** Exported (ruling 9c, Task 6 fix round 1) so translate.ts's pre-call digit
 * gate can check ONLY what a retry APPENDS to this fixed text — the base
 * prompt is audited once, here, as digit-free except its own rule numbers
 * ('1.'–'7.'). */
export const TRANSLATE_SYSTEM_PROMPT = [
  'You translate short Dutch statistical texts from checkdecijfers.nl into clear, natural British English for a general reader.',
  'Input: JSON with "items" (body, chips, definition, alternates) and "glossary" (Dutch name -> required English name).',
  'Rules:',
  '1. Keep every placeholder of the form ⟦Na⟧, ⟦Pb⟧, ⟦Cc⟧, ⟦Gd⟧ exactly as written, each exactly as many times as in the input. Never add, drop, merge or alter a placeholder. They stand for numbers, periods, status notes and names that are filled in later.',
  '2. Never write any digit. All numbers are already placeholders, and a number placeholder already includes its unit: never write a unit or scale word (percent, percentage point, million, billion) next to one. Never add a number word, fraction or multiple (ten, half, double, twice) that the Dutch does not contain.',
  '3. Translate meaning faithfully: keep every direction (rose, fell, unchanged, higher than, lower than) and every caveat (provisional, estimate, forecast) exactly as the Dutch states it. Add no claim, explanation or opinion.',
  '4. When a glossary name occurs, use its English form exactly as given, including capitalisation.',
  '5. "chips" are follow-up questions a reader can click: translate each as a natural English question, same order, same count.',
  '6. Return "definition": null when the input definition is null.',
  '7. Output only the JSON object.',
].join('\n');

/** Ruling 10 (Task 6 fix round 1): checkTranslation's raw `problems` strings
 * are AUDIT text, not model-safe text — they quote item names/indices/counts
 * and, since some of those are drawn from the Dutch source (a glossary name,
 * a chip index), can themselves carry a digit (e.g. a problem naming
 * 'Bevolking op 1 januari', or 'chip 1'). Sending them verbatim in a retry
 * would smuggle a digit past the mask straight into the model's own prompt —
 * exactly the class of bug ruling 9 fixes for the glossary. So the retry
 * suffix below never quotes a problem string: it maps each one to a FIXED,
 * digit-free English sentence naming which CHECK KIND failed (deduped), and
 * the original problem strings stay where they belong — `attempts[].problems`
 * (audit only, never sent to the model). */
const PROBLEM_KIND_SENTENCE: [RegExp, string][] = [
  [/^C1:/, 'Some placeholders were dropped, duplicated or invented.'],
  [/^C2:/, 'A digit was written.'],
  [/^C3:/, 'A direction word was changed.'],
  [/^C4:/, 'A caveat word was dropped.'],
  [/^C5:/, 'A required name was not used exactly.'],
  [/^C6:/, 'The number of chips or alternates changed.'],
  [/^C7:/, 'Numbers, periods or regions were reordered.'],
  [/^C8:/, 'A number was moved away from its period or region.'],
  [/^C9:/, 'A number word, fraction, multiple, scale word or unit was written that the Dutch does not contain.'],
  [/^C10:/, 'A negation was added or dropped.'],
];
const JSON_SHAPE_PROBLEM_SENTENCE = 'The output was not valid JSON of the required shape.';
const FALLBACK_PROBLEM_SENTENCE = 'A translation check failed.';

/** Ruling 11 (Task 6 fix round 1): translateAnswer also uses the exact
 * literal problem strings below for a malformed/unparseable model response —
 * mapped here to the same fixed JSON-shape sentence as any other shape
 * failure. */
function problemSentence(problem: string): string {
  if (problem === 'unparseable output' || problem === 'malformed output') return JSON_SHAPE_PROBLEM_SENTENCE;
  const match = PROBLEM_KIND_SENTENCE.find(([re]) => re.test(problem));
  return match ? match[1] : FALLBACK_PROBLEM_SENTENCE;
}

function retrySuffix(problems: string[]): string {
  const sentences = [...new Set(problems.map(problemSentence))];
  return [
    '',
    'STRICTER: your previous attempt failed these automatic checks. Fix every one, without changing anything else:',
    ...sentences.map((s) => `- ${s}`),
  ].join('\n');
}

export function buildTranslateRequest(
  items: TranslationItems,
  glossary: GlossaryEntry[],
  opts: { model?: string; retryProblems?: string[] } = {},
): LlmRequest {
  const system =
    TRANSLATE_SYSTEM_PROMPT + (opts.retryProblems && opts.retryProblems.length > 0 ? retrySuffix(opts.retryProblems) : '');
  return {
    model: opts.model ?? PHRASING_MODEL,
    maxTokens: 1200,
    temperature: 0,
    system,
    question: JSON.stringify({ items, glossary: glossary.map((g) => ({ dutch: g.dutch, english: g.english })) }),
    jsonSchema: TRANSLATE_JSON_SCHEMA,
  };
}
