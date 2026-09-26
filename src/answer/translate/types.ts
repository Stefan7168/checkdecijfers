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
