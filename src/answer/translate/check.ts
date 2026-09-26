// ADR 058 §3.4: deterministic gates on the model's English output. Run BEFORE
// filling placeholders. An empty problem list is the only pass.
import { DOWN_WORDS, FLAT_WORDS, splitClauses, splitSentences, UP_WORDS } from '../compose/validate.ts';
import type { GlossaryEntry } from './glossary.ts';
import { hasDigitOutsidePlaceholders, PLACEHOLDER_RE, type MaskEntry } from './mask.ts';

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
  return classes(text, [...NL_DIRECTION_TABLES.trend, ...NL_DIRECTION_TABLES.comparative]);
}

export function englishDirections(text: string): Set<Direction> {
  return classes(text, [...EN_DIRECTION_TABLES.trend, ...EN_DIRECTION_TABLES.comparative]);
}

/** Trend words (up/down/flat) are read per CLAUSE, comparatives (more/less
 * … than) per SENTENCE — exactly how the Dutch validator's
 * checkDirectionWords reads them (a comparative's 'dan'/'than' may sit past
 * a comma, 'meer inwoners, namelijk ⟦Na⟧, dan Zeeland'). */
interface DirectionTables {
  trend: [Direction, RegExp][];
  comparative: [Direction, RegExp][];
}
const NL_DIRECTION_TABLES: DirectionTables = {
  trend: [['up', UP_WORDS], ['down', DOWN_WORDS], ['flat', FLAT_WORDS]],
  comparative: [['more', NL_MORE], ['less', NL_LESS]],
};
const EN_DIRECTION_TABLES: DirectionTables = {
  trend: [['up', EN_UP], ['down', EN_DOWN], ['flat', EN_FLAT]],
  comparative: [['more', EN_MORE], ['less', EN_LESS]],
};

/** The Dutch validator's negation-in-clause rule (src/answer/compose/
 * validate.ts NEGATION_WORDS + negatedMatch, not exported there): a trend
 * word with 'zonder'/'geen'/'niet' EARLIER in the same clause is negated.
 * Copied verbatim (tests/answer/translate/check.test.ts pins the copy
 * against validate.ts's source) rather than exported, so the Dutch validator
 * stays byte-identical. */
export const NL_NEGATION = /\b(zonder|geen|niet)\b/i;
/** The English mirror: 'not'/'no'/'never'/'without'/'cannot' or an "n't"
 * contraction earlier in the same clause ('did not rise', 'no longer
 * fell', "hasn't fallen", 'without interim declines'). */
const EN_NEGATION = /\b(?:not|no|never|without|cannot)\b|n't\b/i;

/** Final bounded round (ruling 23B): the English checks' OWN Dutch scan
 * (never validate.ts) also treats 'nooit' as a negator before the verb
 * ('is nooit gedaald') — the copied validator rule above lacks it. English
 * 'never' is already in EN_NEGATION. */
export const NL_NEGATION_BEFORE = /\b(zonder|geen|niet|nooit)\b/i;

/** Residual round (ruling 22.2) + final bounded round (ruling 23A): Dutch
 * places 'niet' AFTER a finite verb ('daalde niet', 'nam niet af', 'steeg in
 * ⟦Pa⟧ niet', 'daalde in Utrecht en Zeeland niet') — invisible to the
 * validator's earlier-in-the-clause rule. The English checks' OWN Dutch scan
 * also counts 'niet'/'geen'/'nooit' after the direction word, up to the
 * clause end or the next direction word in the clause. A conjunction does
 * NOT end the scan (that let 'daalde in Utrecht en Zeeland niet' through);
 * only a negation that sits between a conjunction and the NEXT direction
 * word belongs to that next word ('steeg naar ⟦Na⟧ en er was geen daling'
 * keeps the rise un-negated). */
export const NL_NEGATION_AFTER = /\b(niet|geen|nooit)\b/i;
const NL_CONJUNCTION = /\b(en|maar|of|want|terwijl)\b/gi;

export interface DirectionClaim {
  dir: Direction;
  negated: boolean;
}

/** Final-review fix wave (ruling 18): direction claims as an ORDERED
 * sequence — per sentence (the Dutch validator's own splitSentences), each
 * claim placed by its position in the sentence and marked negated when the
 * negation rule fires earlier in ITS clause (splitClauses). Consecutive
 * identical claims collapse, so 'groeide …, een groei van …' ≡ 'grew …
 * growth of'. */
function directionSequence(
  text: string,
  tables: DirectionTables,
  negation: RegExp,
  negationAfter: RegExp | null = null,
): DirectionClaim[] {
  const out: DirectionClaim[] = [];
  for (const sentence of splitSentences(normalizeQuotes(text))) {
    const clauses = splitClauses(sentence);
    const found: (DirectionClaim & { index: number; clauseEnd: number })[] = [];
    for (const clause of clauses) {
      const offset = clause.start - sentence.start;
      for (const [dir, re] of tables.trend) {
        const m = re.exec(clause.text);
        if (m) {
          found.push({ dir, index: offset + m.index, clauseEnd: clause.end - sentence.start, negated: negation.test(clause.text.slice(0, m.index)) });
        }
      }
    }
    for (const [dir, re] of tables.comparative) {
      const m = re.exec(sentence.text);
      if (!m) continue;
      const clause = clauses.find((c) => m.index >= c.start - sentence.start && m.index < c.end - sentence.start);
      const clauseStart = clause ? clause.start - sentence.start : 0;
      const clauseEnd = clause ? clause.end - sentence.start : sentence.text.length;
      found.push({ dir, index: m.index, clauseEnd, negated: negation.test(sentence.text.slice(clauseStart, m.index)) });
    }
    found.sort((a, b) => a.index - b.index);
    if (negationAfter !== null) {
      found.forEach((f, i) => {
        if (f.negated) return;
        // The window runs from the direction word itself (so 'nam niet af',
        // whose match spans the 'niet', counts) to the clause end, or to the
        // next direction word in the same clause.
        const nextInClause = found.slice(i + 1).find((g) => g.index < f.clauseEnd);
        const windowEnd = Math.min(f.clauseEnd, nextInClause?.index ?? Infinity);
        let window = sentence.text.slice(f.index, windowEnd);
        if (nextInClause) {
          // With a NEXT direction word in the clause, a negation after the
          // last conjunction before it belongs to that next word — cut there.
          const firstWordEnd = /^\S*/.exec(window)![0].length;
          const conjunctions = [...window.slice(firstWordEnd).matchAll(NL_CONJUNCTION)];
          const last = conjunctions.at(-1);
          if (last) window = window.slice(0, firstWordEnd + last.index);
        }
        if (negationAfter.test(window)) f.negated = true;
      });
    }
    for (const f of found) {
      const last = out[out.length - 1];
      if (!last || last.dir !== f.dir || last.negated !== f.negated) out.push({ dir: f.dir, negated: f.negated });
    }
  }
  return out;
}

export function dutchDirectionSequence(text: string): DirectionClaim[] {
  return directionSequence(text, NL_DIRECTION_TABLES, NL_NEGATION_BEFORE, NL_NEGATION_AFTER);
}

export function englishDirectionSequence(text: string): DirectionClaim[] {
  return directionSequence(text, EN_DIRECTION_TABLES, EN_NEGATION);
}

/** Collapse consecutive duplicates of a key. */
function collapse(keys: string[]): string[] {
  return keys.filter((k, i) => i === 0 || keys[i - 1] !== k);
}

// ---------------------------------------------------------------------------
// Word-boundary name matching (final-review fold-in 4): the Dutch
// validator's `mentions` is a case-insensitive SUBSTRING test, so 'Ede'
// matched inside 'exceeded' and 'Nederland'. Here a name must stand on
// Unicode word boundaries (quote-normalized, case-insensitive).
// ---------------------------------------------------------------------------

function normalizeQuotes(text: string): string {
  return text.replace(/[‘’]/g, "'");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nameRe(label: string, flags = 'iu'): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(normalizeQuotes(label))}(?![\\p{L}\\p{N}])`, flags);
}

export function mentionsName(text: string, label: string): boolean {
  return label.length > 0 && nameRe(label).test(normalizeQuotes(text));
}

/** The glossary region entries in order of FIRST mention in `text`, reading
 * each entry's `side` name. Longest names first, each blanked once found,
 * so a region nested in a longer one ('Holland' in 'Noord-Holland') never
 * counts as its own mention. */
function regionFirstMentions(text: string, regions: GlossaryEntry[], side: 'dutch' | 'english'): GlossaryEntry[] {
  let working = normalizeQuotes(text);
  const firsts: { entry: GlossaryEntry; index: number }[] = [];
  for (const entry of [...regions].sort((a, b) => b[side].length - a[side].length)) {
    if (entry[side].length === 0) continue;
    const re = nameRe(entry[side], 'giu');
    let first = -1;
    working = working.replace(re, (match, offset: number) => {
      if (first === -1 || offset < first) first = offset;
      return ' '.repeat(match.length);
    });
    if (first !== -1) firsts.push({ entry, index: first });
  }
  return firsts.sort((a, b) => a.index - b.index).map((f) => f.entry);
}

/** Every glossary region mention in `text`, in text order (longest names
 * first, each blanked once found — same nesting rule as above), consecutive
 * repeats collapsed. */
function regionMentionSequence(text: string, regions: GlossaryEntry[], side: 'dutch' | 'english'): GlossaryEntry[] {
  let working = normalizeQuotes(text);
  const hits: { entry: GlossaryEntry; index: number }[] = [];
  for (const entry of [...regions].sort((a, b) => b[side].length - a[side].length)) {
    if (entry[side].length === 0) continue;
    working = working.replace(nameRe(entry[side], 'giu'), (match, offset: number) => {
      hits.push({ entry, index: offset });
      return ' '.repeat(match.length);
    });
  }
  const ordered = hits.sort((a, b) => a.index - b.index).map((h) => h.entry);
  return ordered.filter((e, i) => i === 0 || ordered[i - 1] !== e);
}

const CAVEAT_WORDS: [string, string][] = [
  ['nader voorlopig', 'revised provisional'],
  ['voorlopig', 'provisional'],
  ['schatting', 'estimate'],
  ['prognose', 'forecast'],
];

// ---------------------------------------------------------------------------
// C9 (final-review fix wave, ruling 17b): number, scale, fraction, multiple
// and percent WORDS. The model never sees a digit, but it could still write
// a quantity in words ("roughly double", "ten years before", "billion",
// "percent") — a fabricated number the digit checks cannot see. Every such
// English word, outside placeholders, must have its Dutch counterpart in the
// masked Dutch item (the text the model saw). The map is deliberately small
// and explicit; anything not on it is not a quantity word.
// ---------------------------------------------------------------------------

const WORD_START = '(?<![\\p{L}\\p{N}])';
const WORD_END = '(?![\\p{L}\\p{N}])';
const wordRe = (src: string, flags = 'iu'): RegExp => new RegExp(`${WORD_START}(?:${src})${WORD_END}`, flags);

/** Dutch cardinal morphemes — the same list as the Dutch validator's
 * CARDINAL_WORD_FORMS (src/answer/compose/validate.ts), longest first so a
 * compound parses into its real parts ('zeventien', never 'zeven' + 'tien'). */
export const NL_CARDINAL_MORPHEMES = [
  'twee', 'drie', 'vier', 'vijf', 'zes', 'zeven', 'acht', 'negen', 'tien', 'elf', 'twaalf', 'dertien', 'veertien',
  'vijftien', 'zestien', 'zeventien', 'achttien', 'negentien', 'twintig', 'dertig', 'veertig', 'vijftig', 'zestig',
  'zeventig', 'tachtig', 'negentig', 'honderd', 'duizend', 'miljoen', 'miljard', 'biljoen',
].sort((a, b) => b.length - a.length);
const NL_CARDINAL_WORD = wordRe(`(?:(?:${NL_CARDINAL_MORPHEMES.join('|')})(?:en|ën)?)+`, 'giu');
const NL_MORPHEME = new RegExp(NL_CARDINAL_MORPHEMES.join('|'), 'giu');

function dutchCardinalMorphemes(dutch: string): Set<string> {
  const out = new Set<string>();
  for (const word of dutch.matchAll(NL_CARDINAL_WORD)) {
    for (const m of word[0].matchAll(NL_MORPHEME)) out.add(m[0].toLowerCase());
  }
  return out;
}

const EN_CARDINALS: [string, string][] = [
  ['two', 'twee'], ['three', 'drie'], ['four', 'vier'], ['five', 'vijf'], ['six', 'zes'], ['seven', 'zeven'],
  ['eight', 'acht'], ['nine', 'negen'], ['ten', 'tien'], ['eleven', 'elf'], ['twelve', 'twaalf'],
  ['thirteen', 'dertien'], ['fourteen', 'veertien'], ['fifteen', 'vijftien'], ['sixteen', 'zestien'],
  ['seventeen', 'zeventien'], ['eighteen', 'achttien'], ['nineteen', 'negentien'], ['twenty', 'twintig'],
  ['thirty', 'dertig'], ['forty', 'veertig'], ['fifty', 'vijftig'], ['sixty', 'zestig'], ['seventy', 'zeventig'],
  ['eighty', 'tachtig'], ['ninety', 'negentig'],
];

/** Residual round (ruling 22.3): fractions fourth…tenth, only as a FRACTION
 * ('a fifth', 'two tenths', 'fifths') — the ordinal ('the fifth year') is not
 * a quantity claim — paired with their Dutch counterpart. */
const EN_FRACTIONS: [string, string][] = [
  ['fourth', 'vierde'], ['fifth', 'vijfde'], ['sixth', 'zesde'], ['seventh', 'zevende'],
  ['eighth', 'achtste'], ['ninth', 'negende'], ['tenth', 'tiende'],
];

interface QuantityWord {
  en: RegExp;
  /** The Dutch counterpart, tested on the masked Dutch item outside placeholders. */
  nl: (dutch: string, morphemes: Set<string>) => boolean;
}

const has = (re: RegExp) => (dutch: string) => re.test(dutch);

const QUANTITY_WORDS: QuantityWord[] = [
  // Residual round (ruling 22.3): bare 'one' needs the ACCENTED numeral
  // 'één' — the unaccented 'een' is the Dutch indefinite article and was
  // satisfying every ', one of the largest rises' out of thin air.
  { en: wordRe('one'), nl: has(wordRe('één|eén')) },
  ...EN_CARDINALS.map(([en, nl]): QuantityWord => ({ en: wordRe(en), nl: (_d, morphemes) => morphemes.has(nl) })),
  { en: wordRe('hundreds?'), nl: (_d, m) => m.has('honderd') },
  { en: wordRe('thousands?'), nl: (_d, m) => m.has('duizend') },
  { en: wordRe('millions?'), nl: (d, m) => m.has('miljoen') || wordRe('mln').test(d) },
  { en: wordRe('billions?'), nl: (d, m) => m.has('miljard') || wordRe('mld').test(d) },
  { en: wordRe('dozens?'), nl: has(wordRe('dozijn\\p{L}*')) },
  { en: wordRe('half|halves|halved|halving'), nl: has(wordRe('helft\\p{L}*|half|halve\\p{L}*|halveer\\p{L}*|gehalveerd\\p{L}*|anderhal(?:f|ve)')) },
  { en: wordRe('quarters?'), nl: has(wordRe('(?:drie)?kwart\\p{L}*')) },
  // 'third' only as a FRACTION ('a third', 'two thirds') — the ordinal
  // ('the third quarter') is not a quantity claim.
  { en: wordRe('(?:a|one|two)[\\s-]+thirds?|thirds'), nl: has(wordRe('derde\\p{L}*')) },
  ...EN_FRACTIONS.map(([en, nl]): QuantityWord => ({
    en: wordRe(`(?:a|one|two|three|four|five|six|seven|eight|nine)[\\s-]+${en}s?|${en}s`),
    nl: has(wordRe(`${nl}\\p{L}*`)),
  })),
  { en: wordRe('decades?'), nl: has(wordRe('decenni\\p{L}*|tien\\s+jaar')) },
  { en: wordRe('century|centuries'), nl: has(wordRe('eeuw\\p{L}*')) },
  { en: wordRe('twice|doubl\\p{L}*'), nl: has(wordRe('dubbel\\p{L}*|verdubbel\\p{L}*|tweemaal|twee\\s+(?:keer|maal)')) },
  { en: wordRe('thrice|tripl\\p{L}*'), nl: has(wordRe('drievoudig\\p{L}*|verdrievoudig\\p{L}*|driemaal|drie\\s+(?:keer|maal)')) },
  { en: wordRe('quadrupl\\p{L}*'), nl: has(wordRe('viervoudig\\p{L}*|verviervoudig\\p{L}*|viermaal|vier\\s+(?:keer|maal)')) },
  { en: wordRe('\\p{L}+-?fold'), nl: has(wordRe('\\p{L}*voudig\\p{L}*')) },
  // A unit swap is a fabricated number too: 'percentage point(s)' needs a
  // Dutch 'procentpunt', and 'percent'/'per cent'/'%' needs a Dutch 'procent'
  // or '%' — never each other ('procentpunt' → 'percent' is exactly R10).
  { en: wordRe('percentage\\s+points?'), nl: has(wordRe('procentpunt\\p{L}*')) },
  { en: new RegExp(`${WORD_START}per\\s?cent${WORD_END}|%`, 'iu'), nl: has(new RegExp(`${WORD_START}procent(?:en)?${WORD_END}|%`, 'iu')) },
];

function outsidePlaceholders(text: string): string {
  return text.replace(PLACEHOLDER_RE, ' ');
}

/** Residual round (ruling 22.4), part of C9: a number placeholder whose
 * mask entry already carries its unit ('0,5 procentpunt' → '0.5 percentage
 * points', '450.985 euro' → '450,985 euros', '3,5%') must not be followed by a
 * unit or scale word the model wrote itself — '⟦Na⟧ points' or '⟦Na⟧ euros'
 * would fill as a doubled (or swapped) unit. Needs the mask table (only the
 * table knows which placeholders carry a unit); translateAnswer and the R8
 * reconstruction both pass it. */
const UNIT_WORD_AFTER = /^[\s\u00a0]*(%|per\s?cent\b|percent\p{L}*|percentage\b|points?\b|millions?\b|billions?\b|thousands?\b|mln\b|bn\b)/iu;

function checkUnitAfterPlaceholder(english: string, name: string, maskTable: MaskEntry[]): string[] {
  const byPlaceholder = new Map(maskTable.map((e) => [e.placeholder, e]));
  const problems: string[] = [];
  for (const m of english.matchAll(/⟦N[a-z]+⟧/g)) {
    const entry = byPlaceholder.get(m[0]);
    if (!entry || /^-?[\d.,]+$/.test(entry.dutch)) continue; // a bare number: no unit to double
    const after = english.slice(m.index + m[0].length);
    const fixed = UNIT_WORD_AFTER.exec(after);
    const unitLast = /(\p{L}+)\s*$/u.exec(entry.english)?.[1];
    const nextWord = /^[\s\u00a0]*(\p{L}+)/u.exec(after)?.[1];
    const stem = (w: string) => w.toLowerCase().replace(/s$/, '');
    const repeated = unitLast !== undefined && nextWord !== undefined && stem(unitLast) === stem(nextWord);
    if (fixed || repeated) {
      problems.push(`C9: ${name} writes '${(fixed?.[1] ?? nextWord)!}' after ${m[0]}, which already carries its unit`);
    }
  }
  return problems;
}

/** C9: every quantity word in `english` (outside placeholders) needs its
 * Dutch counterpart in `maskedDutch` (outside placeholders). */
function checkQuantityWords(maskedDutch: string, english: string, name: string): string[] {
  const dutch = outsidePlaceholders(maskedDutch);
  const en = outsidePlaceholders(english);
  const morphemes = dutchCardinalMorphemes(dutch);
  const problems: string[] = [];
  for (const q of QUANTITY_WORDS) {
    const match = q.en.exec(en);
    if (match && !q.nl(dutch, morphemes)) {
      problems.push(`C9: ${name} says '${match[0]}' but the Dutch has no counterpart for it`);
    }
  }
  return problems;
}

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

/** C7, extended (final-review fix wave, ruling 18): per item, PERIOD
 * placeholders keep their relative order too, and the glossary's REGION
 * names keep the relative order of their first mentions. With numbers
 * already in order, a period or region swapped within one sentence
 * ('In ⟦Pa⟧ … ⟦Na⟧, in ⟦Pb⟧ … ⟦Nb⟧' → 'In ⟦Pb⟧ … ⟦Na⟧, in ⟦Pa⟧ …') would
 * bind a number to the wrong period or region — C8, being sentence-level,
 * cannot see that. Only the relative order WITHIN a kind is pinned: a period
 * moving past its number ('In ⟦Pa⟧ was X ⟦Na⟧' → 'X was ⟦Na⟧ in ⟦Pa⟧') is
 * ordinary English word order. */
function checkCompanionOrder(maskedDutch: string, english: string, name: string, glossary: GlossaryEntry[]): string[] {
  const problems: string[] = [];
  const dutchPeriods = periodPlaceholders(maskedDutch).join(' ');
  const englishPeriods = periodPlaceholders(english).join(' ');
  if (dutchPeriods !== englishPeriods) {
    problems.push(`C7: ${name} period placeholders are reordered (expected [${dutchPeriods}], got [${englishPeriods}])`);
  }
  const regions = glossary.filter((g) => g.kind === 'region');
  const dutchOrder = regionFirstMentions(maskedDutch, regions, 'dutch');
  const englishOrder = regionFirstMentions(english, regions, 'english');
  // Compare only regions both sides mention — a region missing on one side
  // is C5's finding, not an order problem.
  const inBoth = (xs: GlossaryEntry[], ys: GlossaryEntry[]) => xs.filter((x) => ys.includes(x)).map((x) => x.english);
  const nl = inBoth(dutchOrder, englishOrder);
  const en = inBoth(englishOrder, dutchOrder);
  if (nl.join('|') !== en.join('|')) {
    problems.push(`C7: ${name} regions are reordered (expected [${nl.join(', ')}], got [${en.join(', ')}])`);
  }
  return problems;
}

/** C7, residual round (ruling 22.1): per ALIGNED sentence group, the ordered
 * sequence of ALL region mentions must match — C7's per-item first-mention
 * order cannot see a swap in a LATER sentence ('In ⟦Pb⟧ Zeeland had ⟦Ne⟧ and
 * Utrecht ⟦Nf⟧'), and C8 is a set per sentence. Alignment is C8's: a Dutch
 * sentence maps to the English sentence(s) holding its number placeholders;
 * Dutch sentences whose English sentences overlap (a merge) form one group,
 * compared as a whole. With the number order already pinned, a region
 * re-paired with a different number then fails; a region moved after its
 * own number in the same order ('⟦Nc⟧ in Utrecht and ⟦Nd⟧ in Zeeland') passes. */
function checkRegionSentenceOrder(
  maskedDutch: string,
  english: string,
  name: string,
  glossary: GlossaryEntry[],
): string | null {
  const regions = glossary.filter((g) => g.kind === 'region');
  if (regions.length === 0) return null;
  const dutchSentences = maskedDutch.split(/(?<=[.!?])\s+/);
  const englishSentences = english.split(/(?<=[.!?])\s+/);
  const groups: { dutch: Set<number>; english: Set<number> }[] = [];
  if (dutchSentences.length === englishSentences.length) {
    // Final bounded round (ruling 23C): equal sentence counts ⇒ align EVERY
    // sentence by position, so a number-free sentence ('Utrecht had meer
    // inwoners dan Zeeland.') has its region order pinned too — the
    // number-placeholder grouping below never reaches such a sentence.
    dutchSentences.forEach((_, i) => groups.push({ dutch: new Set([i]), english: new Set([i]) }));
  } else {
    dutchSentences.forEach((sentence, d) => {
      const targets = new Set<number>();
      for (const ph of numberPlaceholders(sentence)) {
        const e = englishSentences.findIndex((es) => es.includes(ph));
        if (e !== -1) targets.add(e);
      }
      if (targets.size === 0) return;
      const group = { dutch: new Set([d]), english: targets };
      for (const other of [...groups]) {
        if ([...other.english].some((e) => group.english.has(e))) {
          other.dutch.forEach((x) => group.dutch.add(x));
          other.english.forEach((x) => group.english.add(x));
          groups.splice(groups.indexOf(other), 1);
        }
      }
      groups.push(group);
    });
  }
  for (const group of groups) {
    const nlText = [...group.dutch].sort((a, b) => a - b).map((i) => dutchSentences[i]).join(' ');
    const enText = [...group.english].sort((a, b) => a - b).map((i) => englishSentences[i]).join(' ');
    const nlSeq = regionMentionSequence(nlText, regions, 'dutch');
    const enSeq = regionMentionSequence(enText, regions, 'english');
    // Only regions both sides mention (a missing one is C5/C8's finding).
    const keep = (xs: GlossaryEntry[], ys: GlossaryEntry[]) => {
      const kept = xs.filter((x) => ys.includes(x));
      return kept.filter((e, i) => i === 0 || kept[i - 1] !== e).map((e) => e.english);
    };
    const nl = keep(nlSeq, enSeq);
    const en = keep(enSeq, nlSeq);
    if (nl.join('|') !== en.join('|')) {
      return `C7: ${name} regions are re-paired within a sentence (expected [${nl.join(', ')}], got [${en.join(', ')}])`;
    }
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
      const regionCompanions = glossary.filter((g) => g.kind === 'region' && mentionsName(dlSentence ?? '', g.dutch));

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
        if (!mentionsName(englishSentenceWithNumber, region.english)) {
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
  /** Residual round (ruling 22.4): the mask table, for C9's "unit written
   * after a unit-carrying placeholder" leg. Optional only for unit tests of
   * other checks; translateAnswer and reconstruction always pass it. */
  maskTable?: MaskEntry[];
}): string[] {
  const { maskedDutch, english, glossary, maskTable } = input;
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
      if (mentionsName(masked[i]![1], g.dutch) && !mentionsName(text, g.english)) {
        problems.push(`C5: ${name} must name '${g.english}' (for '${g.dutch}')`);
      }
    }
    // C7 and C8 after C6 passes
    const c7 = checkNumberOrder(masked[i]![1], text, name);
    if (c7) problems.push(c7);
    problems.push(...checkCompanionOrder(masked[i]![1], text, name, glossary));
    const c7r = checkRegionSentenceOrder(masked[i]![1], text, name, glossary);
    if (c7r) problems.push(c7r);
    problems.push(...checkQuantityWords(masked[i]![1], text, name));
    if (maskTable) problems.push(...checkUnitAfterPlaceholder(text, name, maskTable));
  });

  // C8 for body only
  const c8 = checkSentenceBinding(maskedDutch.body, english.body, glossary);
  if (c8) problems.push(c8);

  // C3 also reads the masked Dutch (ruling 15) — direction words are never
  // masked, so the scan is unaffected, and it keeps every check in this
  // function reading the one text the model actually saw.
  // Final-review fix wave (ruling 18): an ORDERED sequence, not a set — a
  // set let 'Utrecht steeg…, Zeeland daalde…' → 'Utrecht fell…, Zeeland
  // rose…' pass. C10 then compares each claim's negation (the Dutch
  // validator's negation-in-clause rule and its English mirror): 'niet
  // gedaald' → 'has fallen' is a reversed claim.
  const nlSeq = dutchDirectionSequence(maskedDutch.body);
  const enSeq = englishDirectionSequence(english.body);
  const nlDir = collapse(nlSeq.map((c) => c.dir)).join(',');
  const enDir = collapse(enSeq.map((c) => c.dir)).join(',');
  if (nlDir !== enDir) {
    problems.push(`C3: direction claims differ (Dutch [${nlDir}], English [${enDir}])`);
  } else {
    const key = (c: DirectionClaim) => `${c.negated ? 'not ' : ''}${c.dir}`;
    const nlNeg = collapse(nlSeq.map(key)).join(',');
    const enNeg = collapse(enSeq.map(key)).join(',');
    if (nlNeg !== enNeg) problems.push(`C10: negation of a direction claim differs (Dutch [${nlNeg}], English [${enNeg}])`);
  }

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
