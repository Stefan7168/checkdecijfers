// ADR 058 (English answers) — module barrel, mirroring compose/index.ts's
// shape: everything outside src/answer/translate/ imports through here.
export {
  createMasker,
  fillPlaceholders,
  hasDigitOutsidePlaceholders,
  toEnglishNumberToken,
  parseEnNumber,
  PLACEHOLDER_RE,
} from './mask.ts';
export type { Masker, MaskEntry } from './mask.ts';

export { glossaryForResult, periodLabelPairs } from './glossary.ts';
export type { GlossaryEntry } from './glossary.ts';

export { checkTranslation, dutchDirections, englishDirections } from './check.ts';
export type { Direction, TranslationItems } from './check.ts';

export {
  assembleEnglishText,
  buildEnglishLines,
  dutchAlternateLabels,
  dutchDefinitionContent,
  translateStalenessWarning,
} from './lines.ts';
export type { EnglishLines } from './lines.ts';

export { ENGLISH_RENDERING_SCHEMA_VERSION } from './types.ts';
export type { EnglishAttempt, EnglishRendering } from './types.ts';

export { buildTranslateRequest, TRANSLATE_JSON_SCHEMA, TRANSLATE_PROMPT_VERSION, TRANSLATE_SYSTEM_PROMPT } from './prompt.ts';

export {
  attachEnglish,
  CAVEAT_TRANSLATIONS,
  isTranslationItemsShape,
  prepareTranslation,
  translateAnswer,
} from './translate.ts';
export type { PreparedTranslation } from './translate.ts';

export {
  meaningCheckScopeProblems,
  meaningItems,
  MEANING_CHECK_MODEL,
  MEANING_CHECK_PROMPT_VERSION,
  runMeaningCheck,
} from './meaning-check.ts';
export type { MeaningCheckRecord, MeaningItem, MeaningVerdict } from './meaning-check.ts';
