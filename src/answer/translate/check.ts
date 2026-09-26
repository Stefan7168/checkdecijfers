// ADR 058 §3.4: deterministic gates on the model's English output. Run BEFORE
// filling placeholders. An empty problem list is the only pass.
import { DOWN_WORDS, FLAT_WORDS, mentions, UP_WORDS } from '../compose/validate.ts';
import type { GlossaryEntry } from './glossary.ts';
import { hasDigitOutsidePlaceholders, PLACEHOLDER_RE } from './mask.ts';

export interface TranslationItems {
  body: string;
  chips: string[];
  definition: string | null;
  alternates: string[];
}

export type Direction = 'up' | 'down' | 'flat' | 'more' | 'less';

const NL_MORE = /\b(meer|hoger|groter)\b[^.!?]{0,60}?\bdan\b/i;
const NL_LESS = /\b(minder|lager|kleiner)\b[^.!?]{0,60}?\bdan\b/i;
const EN_UP = /\b(rise|rises|rose|risen|rising|increas\w*|grew|grow|grows|growing|grown|growth|climb\w*|went up|gone up)\b/i;
const EN_DOWN = /\b(fall|falls|fell|fallen|falling|decreas\w*|declin\w*|drop\w*|shr[aiu]nk\w*|went down|gone down)\b/i;
const EN_FLAT = /\b(unchanged|stable|flat|constant|remained the same|stayed the same|virtually the same|about the same)\b/i;
const EN_MORE = /\b(more|higher|larger|greater|bigger)\b[^.!?]{0,60}?\bthan\b/i;
const EN_LESS = /\b(less|fewer|lower|smaller)\b[^.!?]{0,60}?\bthan\b/i;

function classes(text: string, table: [Direction, RegExp][]): Set<Direction> {
  return new Set(table.filter(([, re]) => re.test(text)).map(([d]) => d));
}

export function dutchDirections(text: string): Set<Direction> {
  return classes(text, [['up', UP_WORDS], ['down', DOWN_WORDS], ['flat', FLAT_WORDS], ['more', NL_MORE], ['less', NL_LESS]]);
}

export function englishDirections(text: string): Set<Direction> {
  return classes(text, [['up', EN_UP], ['down', EN_DOWN], ['flat', EN_FLAT], ['more', EN_MORE], ['less', EN_LESS]]);
}

const CAVEAT_WORDS: [string, string][] = [
  ['nader voorlopig', 'revised provisional'],
  ['voorlopig', 'provisional'],
  ['schatting', 'estimate'],
  ['prognose', 'forecast'],
];

function placeholders(text: string): string[] {
  return (text.match(PLACEHOLDER_RE) ?? []).sort();
}

/** Extract number placeholders (⟦N[a-z]+⟧) in order of appearance. */
function numberPlaceholders(text: string): string[] {
  return text.match(/⟦N[a-z]+⟧/g) ?? [];
}

/** Extract period placeholders (⟦P[a-z]+⟧) in order of appearance. */
function periodPlaceholders(text: string): string[] {
  return text.match(/⟦P[a-z]+⟧/g) ?? [];
}

function pairs(t: TranslationItems): [string, string][] {
  return [
    ['body', t.body],
    ...t.chips.map((c, i): [string, string] => [`chip ${i + 1}`, c]),
    ...(t.definition === null ? [] : [['definition', t.definition] as [string, string]]),
    ...t.alternates.map((a, i): [string, string] => [`alternate ${i + 1}`, a]),
  ];
}

/** C7: Number placeholders must appear in the same relative order in English as in
 * masked Dutch. A swapped number (e.g., "Utrecht ⟦Na⟧ and Zeeland ⟦Nb⟧" →
 * "Utrecht ⟦Nb⟧ and Zeeland ⟦Na⟧") attaches values to the wrong region,
 * fabricating claims about which value belongs where. Period and caveat
 * placeholders may move; only number order is deterministic. */
function checkNumberOrder(
  maskedDutch: string,
  english: string,
  name: string,
): string | null {
  const dutchNumbers = numberPlaceholders(maskedDutch);
  const englishNumbers = numberPlaceholders(english);
  if (dutchNumbers.join(' ') !== englishNumbers.join(' ')) {
    return `C7: ${name} number placeholders are reordered (expected [${dutchNumbers.join(' ')}], got [${englishNumbers.join(' ')}])`;
  }
  return null;
}

/** C8: Sentence binding for number placeholders. Each number in a Dutch sentence
 * must keep its companion period placeholders and region mentions in the English
 * sentence. A lost companion (e.g., periods swapped across sentences) breaks the
 * binding guarantee and attaches a number to the wrong period or region,
 * fabricating a false claim.
 *
 * Controller ruling 15 (Task 6b): region companions are read from the MASKED
 * Dutch sentence, the same text the model saw — reading them from an
 * independently split unmasked body (the pre-fix behaviour) can misalign
 * sentence-for-sentence with the masked split, and a region name is plain
 * text in maskedDutch regardless (only digit-bearing names are ⟦G…⟧-masked),
 * so nothing is lost by reading it there instead. */
function checkSentenceBinding(
  maskedDutch: string,
  english: string,
  glossary: GlossaryEntry[],
): string | null {
  // Split into sentences.
  const dutchSentences = maskedDutch.split(/(?<=[.!?])\s+/);
  const englishSentences = english.split(/(?<=[.!?])\s+/);

  for (let i = 0; i < dutchSentences.length; i++) {
    const dlSentence = dutchSentences[i];
    const numberMatches = numberPlaceholders(dlSentence);

    for (const numberPlaceholder of numberMatches) {
      // Companions: period placeholders in this Dutch sentence.
      const periodCompanions = periodPlaceholders(dlSentence);

      // Companions: region glossary entries mentioned in the masked Dutch sentence.
      const regionCompanions = glossary.filter((g) => g.kind === 'region' && mentions(dlSentence ?? '', g.dutch));

      // Find the English sentence containing this number.
      const englishSentenceWithNumber = englishSentences.find((es) => es.includes(numberPlaceholder));
      if (!englishSentenceWithNumber) {
        return `C8: ${numberPlaceholder} not found in English`;
      }

      // Check period companions are present.
      for (const period of periodCompanions) {
        if (!englishSentenceWithNumber.includes(period)) {
          return `C8: ${numberPlaceholder} lost its companion ${period} in translation`;
        }
      }

      // Check region companions are mentioned.
      for (const region of regionCompanions) {
        if (!mentions(englishSentenceWithNumber, region.english)) {
          return `C8: ${numberPlaceholder} lost its companion ${region.english} in translation`;
        }
      }
    }
  }
  return null;
}

export function checkTranslation(input: {
  maskedDutch: TranslationItems;
  english: TranslationItems;
  glossary: GlossaryEntry[];
}): string[] {
  const { maskedDutch, english, glossary } = input;
  const problems: string[] = [];
  // C6 — shape first; later checks index items by position.
  if (english.chips.length !== maskedDutch.chips.length) problems.push(`C6: expected ${maskedDutch.chips.length} chips, got ${english.chips.length}`);
  if (english.alternates.length !== maskedDutch.alternates.length) problems.push('C6: alternate count differs');
  if ((english.definition === null) !== (maskedDutch.definition === null)) problems.push('C6: definition presence differs');
  for (const [name, text] of pairs(english)) if (text.trim().length === 0) problems.push(`C6: ${name} is empty`);
  if (problems.length > 0) return problems;

  // Controller ruling 15 (Task 6b): C5 reads the MASKED Dutch — the same text
  // the model saw. A digit-free glossary name that sits inside a G-masked
  // digit-bearing name (e.g. 'Bevolking' inside 'Bevolking op 1 januari' ->
  // ⟦Ga⟧) no longer appears literally in maskedDutch, so C5 no longer demands
  // its English form from a model that only ever saw the placeholder — C1
  // already guarantees the placeholder's exact reuse.
  const masked = pairs(maskedDutch);
  const out = pairs(english);
  out.forEach(([name, text], i) => {
    const want = placeholders(masked[i]![1]).join(' ');
    const got = placeholders(text).join(' ');
    if (want !== got) problems.push(`C1: ${name} placeholders differ (expected [${want}], got [${got}])`);
    if (hasDigitOutsidePlaceholders(text)) problems.push(`C2: ${name} contains a digit outside placeholders`);
    for (const g of glossary) {
      if (mentions(masked[i]![1], g.dutch) && !mentions(text, g.english)) {
        problems.push(`C5: ${name} must name '${g.english}' (for '${g.dutch}')`);
      }
    }
    // C7 and C8 after C6 passes
    const c7 = checkNumberOrder(masked[i]![1], text, name);
    if (c7) problems.push(c7);
  });

  // C8 for body only
  const c8 = checkSentenceBinding(maskedDutch.body, english.body, glossary);
  if (c8) problems.push(c8);

  // C3 also reads the masked Dutch (ruling 15) — direction words are never
  // masked, so the scan is unaffected, and it keeps every check in this
  // function reading the one text the model actually saw.
  const nlDir = [...dutchDirections(maskedDutch.body)].sort().join(',');
  const enDir = [...englishDirections(english.body)].sort().join(',');
  if (nlDir !== enDir) problems.push(`C3: direction claims differ (Dutch [${nlDir}], English [${enDir}])`);

  // C4 reads the MASKED Dutch body: the registry's inline provisional markers are
  // already caveat placeholders there (Task 1), so only free-prose caveat words remain.
  let nlBody = maskedDutch.body.toLowerCase();
  let enBody = english.body.toLowerCase();
  for (const [nl, en] of CAVEAT_WORDS) {
    const nlHas = nlBody.includes(nl);
    if (nlHas && !enBody.includes(en)) problems.push(`C4: the Dutch body says '${nl}', the English body lacks '${en}'`);
    nlBody = nlBody.replaceAll(nl, '');
    enBody = enBody.replaceAll(en, '');
  }
  return problems;
}
