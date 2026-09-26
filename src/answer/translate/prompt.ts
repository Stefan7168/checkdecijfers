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

const SYSTEM_PROMPT = [
  'You translate short Dutch statistical texts from checkdecijfers.nl into clear, natural British English for a general reader.',
  'Input: JSON with "items" (body, chips, definition, alternates) and "glossary" (Dutch name -> required English name).',
  'Rules:',
  '1. Keep every placeholder of the form ⟦Na⟧, ⟦Pb⟧, ⟦Cc⟧ exactly as written, each exactly as many times as in the input. Never add, drop, merge or alter a placeholder. They stand for numbers, periods and status notes that are filled in later.',
  '2. Never write any digit. All numbers are already placeholders.',
  '3. Translate meaning faithfully: keep every direction (rose, fell, unchanged, higher than, lower than) and every caveat (provisional, estimate, forecast) exactly as the Dutch states it. Add no claim, explanation or opinion.',
  '4. When a glossary name occurs, use its English form exactly as given, including capitalisation.',
  '5. "chips" are follow-up questions a reader can click: translate each as a natural English question, same order, same count.',
  '6. Return "definition": null when the input definition is null.',
  '7. Output only the JSON object.',
].join('\n');

/** Appended on a retry (up to 1, translateAnswer's ladder): names the
 * deterministic checks the previous attempt failed, in the model's own
 * problem-report vocabulary — never a digit (checkTranslation's problem
 * strings never carry one; a test in translate.test.ts asserts this holds
 * for the request as a whole). */
function retrySuffix(problems: string[]): string {
  return [
    '',
    'STRICTER: your previous attempt failed these automatic checks. Fix every one, without changing anything else:',
    ...problems.map((p) => `- ${p}`),
  ].join('\n');
}

export function buildTranslateRequest(
  items: TranslationItems,
  glossary: GlossaryEntry[],
  opts: { model?: string; retryProblems?: string[] } = {},
): LlmRequest {
  const system = SYSTEM_PROMPT + (opts.retryProblems && opts.retryProblems.length > 0 ? retrySuffix(opts.retryProblems) : '');
  return {
    model: opts.model ?? PHRASING_MODEL,
    maxTokens: 1200,
    temperature: 0,
    system,
    question: JSON.stringify({ items, glossary: glossary.map((g) => ({ dutch: g.dutch, english: g.english })) }),
    jsonSchema: TRANSLATE_JSON_SCHEMA,
  };
}
