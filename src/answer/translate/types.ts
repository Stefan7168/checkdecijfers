// ADR 058 (English answers, Task 6): the English rendering envelope —
// everything translateAnswer produces, whether it lands `verified` (a
// checked, filled-in English answer) or `fallback` (Dutch is served; see
// AnswerResponse.answer for the Dutch text). Rides AnswerResponse.english
// (additive, present only when translation was attempted — A1), never
// replacing the Dutch envelope fields.
import type { MaskEntry } from './mask.ts';
import type { TranslationItems } from './check.ts';
import type { EnglishLines } from './lines.ts';
import type { MeaningCheckRecord } from './meaning-check.ts';

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
  /** #325 check C12 — present only on an attempt whose translation passed
   * C1–C11 (the check never runs otherwise). Additive to schema v1: no
   * English row has ever been stored (the flag has never been on). */
  meaningCheck?: MeaningCheckRecord;
}

/** ADR 058 phase 2 (#332), Task 5: the English sibling of a REFUSAL or
 * CLARIFICATION envelope — never a translation model output (unlike
 * `EnglishRendering` above), always a deterministic template assembled at
 * the SAME site as its Dutch counterpart (refusals.ts/policy.ts, Tasks 2-4).
 * `source: 'template'` says so explicitly, so a reader can tell the two
 * English shapes apart without checking which envelope kind it rode in on.
 * Present only when respond ran for an English reader (`lang === 'en'`); a
 * Dutch or lang-less envelope (benchmark, CLI, tests) carries no `english`
 * key at all — byte-identical to a pre-#332 phase-2 run. */
export interface NonAnswerEnglish {
  source: 'template';
  /** The full English message, assembled exactly like the Dutch `text`
   * (body, offer, guidance joined the same way for a refusal; the English
   * question itself for a clarification). */
  text: string;
  /** Every chip this envelope offers: `label` shown in English, `submit` the
   * exact Dutch string that is shown/submitted today — the same {label,
   * submit} contract EnglishRendering.chips (the answer path) already
   * uses. */
  chips: { label: string; submit: string }[];
  /** Dutch fragments kept verbatim inside `text` — the intent model's own
   * free-text reading, or the user's own unmatched term (the ONE non-
   * template ingredient; design doc "Why templates, not the translation
   * model"). An honest-by-construction list: empty whenever no such
   * fragment was kept. */
  untranslated: string[];
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
