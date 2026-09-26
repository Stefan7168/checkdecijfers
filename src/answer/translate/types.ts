// ADR 058 (English answers, Task 6): the English rendering envelope —
// everything translateAnswer produces, whether it lands `verified` (a
// checked, filled-in English answer) or `fallback` (Dutch is served; see
// AnswerResponse.answer for the Dutch text). Rides AnswerResponse.english
// (additive, present only when translation was attempted — A1), never
// replacing the Dutch envelope fields.
import type { MaskEntry } from './mask.ts';
import type { TranslationItems } from './check.ts';
import type { EnglishLines } from './lines.ts';

export const ENGLISH_RENDERING_SCHEMA_VERSION = 1 as const;

/** Final-review fix wave (ruling 19): the WHOLE translate step (both
 * attempts) is capped at this many milliseconds. It runs after the full
 * Dutch pipeline and after the credit is reserved, inside a page with a 90 s
 * maxDuration — an uncapped step could get the function killed (charged,
 * no answer, no audit row). On expiry the answer falls back to Dutch with
 * attempt error 'timeout'. Lives here (not translate.ts) so the web layer
 * can size its SDK request timeout without importing the translator. */
export const TRANSLATE_TIMEOUT_MS = 20_000;

export interface EnglishAttempt {
  ok: boolean;
  problems: string[];
  error: string | null;
}

export interface EnglishRendering {
  schemaVersion: typeof ENGLISH_RENDERING_SCHEMA_VERSION;
  status: 'verified' | 'fallback';
  promptVersion: number;
  model: string | null;
  maskedDutch: TranslationItems;
  maskTable: MaskEntry[];
  /** The accepted model output (pre-fill) when verified; the last attempt's output when fallback; null on a model error before any output. */
  rawTranslation: TranslationItems | null;
  attempts: EnglishAttempt[];
  body: string | null;
  lines: EnglishLines | null;
  stalenessWarning: string | null;
  text: string | null;
  chips: { label: string; submit: string }[];
  untranslatedNames: string[];
}
