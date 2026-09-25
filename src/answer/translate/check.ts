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

function pairs(t: TranslationItems): [string, string][] {
  return [
    ['body', t.body],
    ...t.chips.map((c, i): [string, string] => [`chip ${i + 1}`, c]),
    ...(t.definition === null ? [] : [['definition', t.definition] as [string, string]]),
    ...t.alternates.map((a, i): [string, string] => [`alternate ${i + 1}`, a]),
  ];
}

export function checkTranslation(input: {
  maskedDutch: TranslationItems;
  dutch: TranslationItems;
  english: TranslationItems;
  glossary: GlossaryEntry[];
}): string[] {
  const { maskedDutch, dutch, english, glossary } = input;
  const problems: string[] = [];
  // C6 — shape first; later checks index items by position.
  if (english.chips.length !== maskedDutch.chips.length) problems.push(`C6: expected ${maskedDutch.chips.length} chips, got ${english.chips.length}`);
  if (english.alternates.length !== maskedDutch.alternates.length) problems.push('C6: alternate count differs');
  if ((english.definition === null) !== (maskedDutch.definition === null)) problems.push('C6: definition presence differs');
  for (const [name, text] of pairs(english)) if (text.trim().length === 0) problems.push(`C6: ${name} is empty`);
  if (problems.length > 0) return problems;

  const masked = pairs(maskedDutch);
  const dutchPairs = pairs(dutch);
  const out = pairs(english);
  out.forEach(([name, text], i) => {
    const want = placeholders(masked[i]![1]).join(' ');
    const got = placeholders(text).join(' ');
    if (want !== got) problems.push(`C1: ${name} placeholders differ (expected [${want}], got [${got}])`);
    if (hasDigitOutsidePlaceholders(text)) problems.push(`C2: ${name} contains a digit outside placeholders`);
    for (const g of glossary) {
      if (mentions(dutchPairs[i]![1], g.dutch) && !mentions(text, g.english)) {
        problems.push(`C5: ${name} must name '${g.english}' (for '${g.dutch}')`);
      }
    }
  });

  const nlDir = [...dutchDirections(dutch.body)].sort().join(',');
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
