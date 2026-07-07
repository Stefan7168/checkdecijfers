// The blocking post-generation validator — R3 (verbatim numbers, digit form),
// R9 (semantic binding + direction/comparison words), R10 (unit adjacency),
// R11 (provisional marking). docs/05-data-rules.md.
//
// Fail-closed by design: any problem found here costs at most one LLM
// regeneration and then a template answer — a false positive is an ugly
// answer, a false negative is a fabricated number. When in doubt, reject.
//
// What is scanned: the BODY only. Attribution, definition and marking lines
// are assembled structurally from validated fields (R1's structural
// exemption) and never pass through the LLM, so they are not scanned.
import type { DerivationRecord, ResultCell, ValidatedResult } from '../../query/index.ts';
import {
  findNumericTokens,
  maskPhrases,
  normalizeForScan,
  numbersInText,
  periodCodeNumbers,
  unitMaskPhrases,
} from './format.ts';
import type { AnswerValidationReport } from './types.ts';

const EPSILON = 1e-9;

function eq(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

/** Region label as prose uses it: "Utrecht (gemeente)" → "Utrecht". */
export function baseRegionLabel(label: string): string {
  return label.replace(/\s*\(.*\)\s*$/, '').trim();
}

/** Typographic apostrophes must not defeat region matching ('s-Gravenhage). */
function normalizeQuotes(text: string): string {
  return text.replace(/[‘’]/g, "'");
}

function mentions(text: string, label: string): boolean {
  return normalizeQuotes(text).toLowerCase().includes(normalizeQuotes(label).toLowerCase());
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Token classification (R3 / R1 answer half)
// ---------------------------------------------------------------------------

export type TokenKind = 'cell' | 'derivation' | 'period' | 'metadata' | 'count' | 'unbacked';

export interface ClassifiedToken {
  token: string;
  index: number;
  value: number;
  kind: TokenKind;
  /** For 'cell': every cell whose value matches (ties possible). */
  cells: ResultCell[];
  /** For 'derivation': the record whose value/netChange matches. */
  derivation: DerivationRecord | null;
  /** True when the token matched the absolute value of a signed derivation
   * ("daalde met 12.438" for netChange -12438) — the direction-word check
   * must then confirm the sign in prose. */
  matchedAbsolute: boolean;
}

function derivationNumbers(d: DerivationRecord): number[] {
  switch (d.kind) {
    case 'difference':
      return [d.value];
    case 'max':
      return [d.value];
    case 'direction':
      return [d.netChange];
    case 'first_last':
      return [];
  }
}

interface AllowedNumbers {
  periodNumbers: number[];
  metadataNumbers: number[];
  countNumbers: number[];
}

function buildAllowedNumbers(result: ValidatedResult): AllowedNumbers {
  const periodNumbers: number[] = [];
  for (const cell of result.cells) {
    periodNumbers.push(...periodCodeNumbers(cell.periodCode));
    periodNumbers.push(...numbersInText(cell.periodLabel));
  }
  periodNumbers.push(...periodCodeNumbers(result.attribution.coveredPeriods.from));
  periodNumbers.push(...periodCodeNumbers(result.attribution.coveredPeriods.to));

  const metadataNumbers: number[] = [];
  metadataNumbers.push(...numbersInText(result.attribution.definitionLabel));
  metadataNumbers.push(...numbersInText(result.attribution.periodSemantics));
  for (const cell of result.cells) {
    metadataNumbers.push(...numbersInText(cell.measureTitle));
    metadataNumbers.push(...numbersInText(cell.regionLabel));
    for (const label of Object.values(cell.dimLabels)) metadataNumbers.push(...numbersInText(label));
  }

  const countNumbers = [
    result.cells.length,
    new Set(result.cells.map((c) => c.regionCode)).size,
    new Set(result.cells.map((c) => c.periodCode)).size,
  ];

  return { periodNumbers, metadataNumbers, countNumbers };
}

/** Classify every numeric token in a body against the validated result — the
 * R1 answer-half scan. Unit strings containing digits are masked first so
 * 'x 1 000' never reads as a data claim. */
export function scanBody(body: string, result: ValidatedResult): ClassifiedToken[] {
  const normalized = normalizeForScan(body);
  const masks = result.cells.flatMap((cell) => unitMaskPhrases(cell.unit));
  const masked = maskPhrases(normalized, masks);
  const allowed = buildAllowedNumbers(result);

  // A count number ('van de 4 gemeenten') is only structural when it is
  // immediately followed by a structure noun — a bare integer that happens to
  // equal the cell count is otherwise a data claim (adversarial-review
  // finding, 2026-07-03: 'gemiddeld 4 personen per woning' passed as count).
  const countContext = (index: number, length: number): boolean =>
    /^\s*(?:vergeleken\s+)?(?:gemeenten?|regio's|regio’s|provincies|steden|perioden|periodes|jaren|kwartalen|maanden|waarden|cijfers|cellen)\b/i.test(
      masked.slice(index + length, index + length + 40),
    );

  return findNumericTokens(masked).map((token) => {
    // A digit run glued to a letter ('4e kwartaal', '1e') is an ordinal or
    // embedded marker, never a standalone value: it may only ground as
    // period/metadata (found live: the '4' in periodLabel '2025 4e kwartaal'
    // collided with the cell value 4,0 and demanded a % sign).
    const nextChar = masked[token.index + token.token.length] ?? '';
    if (/\p{L}/u.test(nextChar)) {
      if (Number.isInteger(token.value) && allowed.periodNumbers.some((n) => eq(n, token.value))) {
        return { ...token, kind: 'period' as const, cells: [], derivation: null, matchedAbsolute: false };
      }
      if (allowed.metadataNumbers.some((n) => eq(n, token.value))) {
        return { ...token, kind: 'metadata' as const, cells: [], derivation: null, matchedAbsolute: false };
      }
      return { ...token, kind: 'unbacked' as const, cells: [], derivation: null, matchedAbsolute: false };
    }
    const cells = result.cells.filter((c) => c.value !== null && eq(c.value, token.value));
    if (cells.length > 0) {
      return { ...token, kind: 'cell' as const, cells, derivation: null, matchedAbsolute: false };
    }
    for (const d of result.derivations) {
      for (const value of derivationNumbers(d)) {
        if (eq(value, token.value)) {
          return { ...token, kind: 'derivation' as const, cells: [], derivation: d, matchedAbsolute: false };
        }
        if (eq(Math.abs(value), token.value) && value < 0) {
          return { ...token, kind: 'derivation' as const, cells: [], derivation: d, matchedAbsolute: true };
        }
      }
    }
    if (Number.isInteger(token.value) && allowed.periodNumbers.some((n) => eq(n, token.value))) {
      return { ...token, kind: 'period' as const, cells: [], derivation: null, matchedAbsolute: false };
    }
    if (allowed.metadataNumbers.some((n) => eq(n, token.value))) {
      return { ...token, kind: 'metadata' as const, cells: [], derivation: null, matchedAbsolute: false };
    }
    if (
      Number.isInteger(token.value) &&
      allowed.countNumbers.some((n) => eq(n, token.value)) &&
      countContext(token.index, token.token.length)
    ) {
      return { ...token, kind: 'count' as const, cells: [], derivation: null, matchedAbsolute: false };
    }
    return { ...token, kind: 'unbacked' as const, cells: [], derivation: null, matchedAbsolute: false };
  });
}

// ---------------------------------------------------------------------------
// Word-form fabrications (R3)
// ---------------------------------------------------------------------------

/** Dutch scale/fraction/multiple words that smuggle quantities past the digit
 * scan ("zeventien miljoen", "een kwart", "verdubbeld", "anderhalf keer").
 * No registered derivation produces word forms, so these are rejected
 * outright. ('mln' inside the verbatim CBS unit 'mln kWh' is fine: units are
 * validated against metadata, and 'mln' is not on this list.) */
const QUANTITY_WORD_FORMS =
  /\b(duizend\w*|miljoen\w*|miljard\w*|biljoen\w*|(?:drie)?kwart|helft|anderhal(?:f|ve)|dubbel\w*|verdubbel\w*|verdrievoudig\w*|halveer\w*|gehalveerd\w*)\b/gi;

/** Dutch cardinal number-words, INCLUDING compounds ("zeshonderdzeventigduizend",
 * "tweeëntwintig"): quantities must be digits (R3), and a spelled-out number
 * produces no numeric token, so it would otherwise be invisible to the whole
 * scan (adversarial-review finding, 2026-07-03 — a fabricated word-form value
 * passed the validator silently). The morpheme lookarounds require the WHOLE
 * word to be number-composed, so 'achter', 'vierde' (ordinal) and 'zestiger'
 * never match. 'een' is deliberately absent (indefinite article; 'een
 * miljoen'/'een kwart' are caught by the scale/fraction list above). This
 * also rejects honest count words ("vier gemeenten") — write digits instead;
 * fail-closed strictness the template and prompt both already follow. */
const CARDINAL_WORD_FORMS =
  /(?<![\p{L}])(?:(?:twee|drie|vier|vijf|zes|zeven|acht|negen|tien|elf|twaalf|dertien|veertien|vijftien|zestien|zeventien|achttien|negentien|twintig|dertig|veertig|vijftig|zestig|zeventig|tachtig|negentig|honderd|duizend|miljoen|miljard|biljoen)(?:en|ën)?)+(?![\p{L}])/giu;

/** Equality claims between compared values ("ongeveer evenveel") — accepted
 * only when the compared cell values are actually equal. Fail-closed:
 * "roughly equal" is a quantitative claim no derivation backs. */
const EQUALITY_CLAIM = /\b(?:ongeveer\s+|vrijwel\s+|nagenoeg\s+)?(?:evenveel|even\s+(?:veel|hoog|groot|laag|klein))\b/i;

// ---------------------------------------------------------------------------
// Unit adjacency (R10)
// ---------------------------------------------------------------------------

// Suffix-oriented: a unit belongs DIRECTLY after its value ("4,0%",
// "450.985 euro", "8.204 (x 1 000)"), with a small prefix allowance for
// '€ 450.985' style. A wide symmetric window let one distant unit word vouch
// for several values at once (adversarial-review finding, 2026-07-03).
const UNIT_PREFIX = 10;
const UNIT_SUFFIX = 24;

function windowAround(text: string, index: number, length: number): string {
  return text.slice(Math.max(0, index - UNIT_PREFIX), index + length + UNIT_SUFFIX);
}

function containsPhrase(text: string, phrase: string): boolean {
  const pattern = new RegExp(
    phrase
      .split(/\s+/)
      .map((part) => escapeRegExp(part))
      .join('[\\s\\u00a0]+'),
    'i',
  );
  return pattern.test(text);
}

/** Is this token a difference-of-values (procentpunt semantics) rather than a
 * level? True for difference values and direction netChange. */
function isDifferenceToken(token: ClassifiedToken): boolean {
  return (
    token.kind === 'derivation' &&
    token.derivation !== null &&
    (token.derivation.kind === 'difference' || token.derivation.kind === 'direction')
  );
}

function checkUnitAdjacency(body: string, token: ClassifiedToken, unit: string): string[] {
  const problems: string[] = [];
  const window = windowAround(body, token.index, token.token.length);
  const label = `'${token.token}'`;

  // A unit PHRASE longer than the suffix window could never fit inside it —
  // the #115 onboarded case ('gemiddelde saldo van de deelvragen', 34 chars
  // vs the 24-char window) made every such answer fail R10 structurally
  // (session-30 review). Extending the window by the phrase's own length
  // preserves the actual adjacency rule — the unit must START within
  // UNIT_SUFFIX chars after its value — for every unit length; short units
  // keep the exact pre-existing window (byte-identical behavior).
  const phraseWindow =
    unit.trim().length >= UNIT_SUFFIX
      ? body.slice(
          Math.max(0, token.index - UNIT_PREFIX),
          token.index + token.token.length + UNIT_SUFFIX + unit.trim().length,
        )
      : window;

  if (/^aantal$/i.test(unit.trim())) return [];

  if (unit.trim() === '%') {
    // What sits IMMEDIATELY after the token decides %-vs-procentpunt — a
    // difference phrase may legitimately share the wider window with a level.
    const suffix = body.slice(token.index + token.token.length, token.index + token.token.length + 16);
    if (isDifferenceToken(token)) {
      // A difference between %-levels is procentpunt, never % (R10 guard).
      if (!/procentpunt/i.test(window)) {
        problems.push(`R10: verschilwaarde ${label} moet 'procentpunt' als eenheid dragen (niveaus zijn %, verschillen procentpunt)`);
      }
      if (/^\s*(%|procent\b(?!punt))/i.test(suffix)) {
        problems.push(`R10: verschilwaarde ${label} draagt '%' — een verschil tussen %-niveaus is procentpunt`);
      }
    } else {
      if (!/%|procent(?!punt)/i.test(window)) {
        problems.push(`R10: bij ${label} ontbreekt de eenheid '%' (of 'procent')`);
      }
      if (/^\s*procentpunt/i.test(suffix)) {
        problems.push(`R10: niveauwaarde ${label} draagt 'procentpunt' — dat is een verschil-eenheid`);
      }
    }
    return problems;
  }

  if (/^euro$/i.test(unit.trim())) {
    if (!/€|euro/i.test(window)) problems.push(`R10: bij ${label} ontbreekt de eenheid 'euro'`);
    return problems;
  }

  if (/\d/.test(unit)) {
    // Factor units ('x 1 000', '1 000 euro'): the verbatim factor string must
    // sit next to the value — the ×1.000 misreading guard.
    const variants = unitMaskPhrases(unit);
    if (!variants.some((v) => containsPhrase(phraseWindow, v))) {
      problems.push(`R10: bij ${label} ontbreekt de letterlijke eenheid '${unit}' (factor-eenheid mag nooit wegvallen)`);
    }
    return problems;
  }

  if (!containsPhrase(phraseWindow, unit.trim())) {
    problems.push(`R10: bij ${label} ontbreekt de eenheid '${unit}'`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Sentences, binding (R9)
// ---------------------------------------------------------------------------

export interface Sentence {
  text: string;
  start: number;
  end: number;
}

/** Sentence boundaries: terminal punctuation followed by whitespace/end —
 * dots inside '18.044.027' never split (no whitespace follows them). */
export function splitSentences(text: string): Sentence[] {
  const sentences: Sentence[] = [];
  let start = 0;
  const re = /[.!?](?=\s|$)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const end = match.index + 1;
    if (text.slice(start, end).trim().length > 0) sentences.push({ text: text.slice(start, end), start, end });
    start = end;
  }
  if (start < text.length && text.slice(start).trim().length > 0) {
    sentences.push({ text: text.slice(start), start, end: text.length });
  }
  return sentences;
}

function sentenceOf(sentences: Sentence[], index: number): Sentence | null {
  return sentences.find((s) => index >= s.start && index < s.end) ?? null;
}

/** Direction words are judged per CLAUSE, not per sentence: honest series
 * prose combines a net claim and a sub-period counter-movement in one
 * sentence ("steeg per saldo …, maar daalde in 2023"). Clause boundaries:
 * ';', ':' and ', ' followed by a non-digit (decimal commas like '1,3' and
 * enumerations of numbers never split). */
export function splitClauses(sentence: Sentence): Sentence[] {
  const clauses: Sentence[] = [];
  let start = sentence.start;
  const re = /[;:]|,(?=\s+\D)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sentence.text)) !== null) {
    const end = sentence.start + match.index;
    if (end > start) clauses.push({ text: sentence.text.slice(start - sentence.start, match.index), start, end });
    start = sentence.start + match.index + match[0].length;
  }
  if (start < sentence.end) {
    clauses.push({ text: sentence.text.slice(start - sentence.start), start, end: sentence.end });
  }
  return clauses.filter((c) => c.text.trim().length > 0);
}

function yearOf(cell: ResultCell): number {
  return Number.parseInt(cell.periodCode.slice(0, 4), 10);
}

function sentenceMentionsCellPeriod(sentence: string, cell: ResultCell): boolean {
  // Word-boundary match: '1,2024' (a decimal value) must not count as a
  // mention of the year 2024 (adversarial-review finding, 2026-07-03).
  const year = new RegExp(`(?<![\\d.,])${yearOf(cell)}(?![\\d.,])`);
  return year.test(sentence) || sentence.includes(cell.periodLabel);
}

function sentenceMentionsCellRegion(sentence: string, cell: ResultCell): boolean {
  if (cell.regionLabel === null) return true;
  return mentions(sentence, baseRegionLabel(cell.regionLabel));
}

/** The cells a derivation's value is computed from — its R9 binding targets. */
function derivationSourceCells(d: DerivationRecord, cellsById: Map<string, ResultCell>): ResultCell[] {
  const ids =
    d.kind === 'difference'
      ? [d.subtrahendResultId, d.minuendResultId]
      : d.kind === 'direction' || d.kind === 'first_last'
        ? [d.firstResultId, d.lastResultId]
        : [d.winnerResultId];
  return ids.map((id) => cellsById.get(id)).filter((c): c is ResultCell => c !== undefined);
}

function checkBinding(body: string, sentences: Sentence[], tokens: ClassifiedToken[], result: ValidatedResult): string[] {
  const problems: string[] = [];
  const cellsById = new Map(result.cells.map((c) => [c.resultId, c]));
  const distinctRegions = new Set(result.cells.map((c) => c.regionCode)).size;
  const distinctPeriods = new Set(result.cells.map((c) => c.periodCode)).size;

  for (const token of tokens) {
    const sentence = sentenceOf(sentences, token.index);
    const scope = sentence ? sentence.text : body;

    if (token.kind === 'cell') {
      if (distinctRegions > 1 && !token.cells.some((c) => sentenceMentionsCellRegion(scope, c))) {
        problems.push(`R9: waarde '${token.token}' staat niet in één zin met de regio waar hij bij hoort (${token.cells.map((c) => c.regionLabel).join('/')})`);
      }
      if (distinctPeriods > 1 && !token.cells.some((c) => sentenceMentionsCellPeriod(scope, c))) {
        problems.push(`R9: waarde '${token.token}' staat niet in één zin met zijn periode (${token.cells.map((c) => c.periodLabel).join('/')})`);
      }
    } else if (token.kind === 'derivation' && token.derivation !== null) {
      // Derived values sit with THEIR coordinates too (adversarial-review
      // finding, 2026-07-03: a bare 'het verschil bedroeg 0,5 procentpunt'
      // with no period at all passed).
      const sources = derivationSourceCells(token.derivation, cellsById);
      if (token.derivation.kind === 'max') {
        const winner = sources[0];
        if (winner && !sentenceMentionsCellRegion(scope, winner)) {
          problems.push(`R9: maximumwaarde '${token.token}' staat niet in één zin met de regio die hem draagt (${winner.regionLabel})`);
        }
      } else if (sources.length > 0) {
        if (!sources.some((c) => sentenceMentionsCellPeriod(scope, c))) {
          problems.push(`R9: verschil-/veranderingswaarde '${token.token}' staat niet in één zin met een van zijn periodes (${sources.map((c) => c.periodLabel).join('/')})`);
        }
        for (const c of sources) {
          if (!sentenceMentionsCellPeriod(body, c)) {
            problems.push(`R9: de periode '${c.periodLabel}' waarop de bewerking '${token.token}' is gebaseerd ontbreekt in het antwoord`);
          }
        }
      }
    }
  }

  // Single-axis binding: with exactly one region/period, the answer as a
  // whole must still name it (docs/02: each value bound to region + period).
  const dataShown = tokens.some((t) => t.kind === 'cell' || t.kind === 'derivation');
  const firstCell = result.cells[0];
  if (dataShown && firstCell) {
    if (distinctRegions === 1 && firstCell.regionLabel !== null && !sentenceMentionsCellRegion(body, firstCell)) {
      problems.push(`R9: het antwoord noemt de regio '${baseRegionLabel(firstCell.regionLabel)}' nergens`);
    }
    if (distinctPeriods === 1 && !sentenceMentionsCellPeriod(body, firstCell)) {
      problems.push(`R9: het antwoord noemt de periode '${firstCell.periodLabel}' nergens`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Direction / comparison words (R9)
// ---------------------------------------------------------------------------

// Separable verbs ('nam toe', 'namen af', 'neemt toe') and the plain nouns
// ('daling') were missing — both let a real increase read as a decrease
// (adversarial-review findings, 2026-07-03).
const UP_WORDS =
  /\b(stijg\w*|steeg|gestegen|toenam\w*|toegenomen|toename\w*|groei\w*|gegroeid|omhoog|klom|geklommen)\b|\bn(?:am|amen|eemt|emen)\b[^.!?;:]{0,30}?\btoe\b/i;
const DOWN_WORDS =
  /\b(daal\w*|dalen\w*|daling\w*|gedaald|afnam\w*|afgenomen|afname\w*|krimp\w*|kromp|gekrompen|zakte|gezakt|omlaag|terugliep|teruggelopen)\b|\bn(?:am|amen|eemt|emen)\b[^.!?;:]{0,30}?\baf\b|\bliep\w*\b[^.!?;:]{0,30}?\bterug\b/i;
const FLAT_WORDS = /\b(gelijk gebleven|stabiel|onveranderd|ongewijzigd|constant gebleven)\b|\b(?:vrijwel|nagenoeg)\s+gelijk\b/i;
const SUPERLATIVE_WORDS = /\b(meeste|hoogste|grootste|laagste|minste)\b/i;
const COMPARATIVE = /\b(meer|hoger|groter|minder|lager|kleiner)\b[^.!?]{0,60}?\bdan\b/i;

type Trend = 'up' | 'down' | 'flat';

function trendBacking(result: ValidatedResult): { kind: 'direction' | 'difference'; net: Trend; monotonic: boolean } | null {
  const direction = result.derivations.find((d) => d.kind === 'direction');
  if (direction && direction.kind === 'direction') {
    return { kind: 'direction', net: direction.direction, monotonic: direction.monotonic };
  }
  const difference = result.derivations.find((d) => d.kind === 'difference');
  if (difference && difference.kind === 'difference') {
    const net: Trend = difference.value > EPSILON ? 'up' : difference.value < -EPSILON ? 'down' : 'flat';
    return { kind: 'difference', net, monotonic: true };
  }
  return null;
}

function sign(delta: number): Trend {
  return delta > EPSILON ? 'up' : delta < -EPSILON ? 'down' : 'flat';
}

/** Expected trend inside one clause. Grounding rules, most specific first:
 *  1. ≥2 bound cell values in the clause → their textual order decides.
 *  2. two known years: 'van/tussen X naar/tot/en Y' spans X→Y; 'ten opzichte
 *     van / t.o.v. / vergeleken met Y' makes Y the base; otherwise the
 *     per-year steps of the mentioned years must agree — if they do, that
 *     shared direction; if not, the net (which then rejects a single-
 *     direction claim about disagreeing steps — fail-closed).
 *  3. one known year with a predecessor cell → that year's step; with
 *     'sinds/vanaf X' → span from X to the series end.
 *  4. otherwise → the net direction.
 * Fail-closed: prose these rules can't ground is judged against the net
 * direction, not tolerated. */
function expectedTrendForClause(
  clause: Sentence,
  tokens: ClassifiedToken[],
  result: ValidatedResult,
  net: Trend,
): Trend {
  const cellTokensInClause = tokens
    .filter((t) => t.kind === 'cell' && t.index >= clause.start && t.index < clause.end)
    .sort((a, b) => a.index - b.index);
  if (cellTokensInClause.length >= 2) {
    return sign(cellTokensInClause[cellTokensInClause.length - 1]!.value - cellTokensInClause[0]!.value);
  }

  const orderedCells = [...result.cells].filter((c) => c.value !== null);
  const cellsByYear = new Map(orderedCells.map((c) => [yearOf(c), c]));
  const value = (year: number) => cellsByYear.get(year)!.value!;
  const yearsInClause = [...new Set(
    [...clause.text.matchAll(/\b(?:19|20)\d{2}\b/g)]
      .map((m) => Number.parseInt(m[0], 10))
      .filter((y) => cellsByYear.has(y)),
  )];

  if (yearsInClause.length === 2) {
    const [first, second] = yearsInClause as [number, number];
    const spanned = new RegExp(`\\b(?:van|tussen)\\b[^.!?]*?\\b${first}\\b[^.!?]*?\\b(?:naar|tot|en)\\b[^.!?]*?\\b${second}\\b`, 'i');
    if (spanned.test(clause.text)) return sign(value(second) - value(first));
    const secondIsBase = new RegExp(`(?:ten opzichte van|t\\.o\\.v\\.|vergeleken met)\\s+(?:\\w+\\s+){0,3}?${second}\\b`, 'i');
    if (secondIsBase.test(clause.text)) return sign(value(first) - value(second));
    const steps = yearsInClause.filter((y) => cellsByYear.has(y - 1)).map((y) => sign(value(y) - value(y - 1)));
    if (steps.length > 0 && steps.every((s) => s === steps[0])) return steps[0]!;
    return net;
  }

  if (yearsInClause.length === 1) {
    const year = yearsInClause[0]!;
    const since = new RegExp(`\\b(?:sinds|vanaf)\\s+(?:\\w+\\s+){0,3}?${year}\\b`, 'i');
    if (since.test(clause.text)) {
      const last = orderedCells[orderedCells.length - 1]!;
      return sign(last.value! - value(year));
    }
    if (cellsByYear.has(year - 1)) return sign(value(year) - value(year - 1));
  }

  return net;
}

function checkDirectionWords(
  body: string,
  sentences: Sentence[],
  tokens: ClassifiedToken[],
  result: ValidatedResult,
): string[] {
  const problems: string[] = [];
  const backing = trendBacking(result);
  const maxDerivation = result.derivations.find((d) => d.kind === 'max');
  const cellsById = new Map(result.cells.map((c) => [c.resultId, c]));

  for (const sentence of sentences) {
    const saysSuperlative = SUPERLATIVE_WORDS.test(sentence.text);
    const comparative = COMPARATIVE.exec(sentence.text);

    for (const clause of splitClauses(sentence)) {
      const saysUp = UP_WORDS.test(clause.text);
      const saysDown = DOWN_WORDS.test(clause.text);
      const saysFlat = FLAT_WORDS.test(clause.text);
      if (!saysUp && !saysDown && !saysFlat) continue;
      if (!backing) {
        problems.push(`R9: trendwoord in "${clause.text.trim()}" zonder direction/difference-derivatie om aan te binden`);
        continue;
      }
      // Both families in one clause of a non-monotonic series ("na de
      // stijging in 2022 daalde ... daarna"): both movements factually
      // occurred; temporal attribution is beyond deterministic reach, and
      // the numbers themselves stay verbatim-checked either way.
      if (saysUp && saysDown && !backing.monotonic) continue;
      const expected = expectedTrendForClause(clause, tokens, result, backing.net);
      if (saysUp && expected !== 'up') problems.push(`R9: zinsdeel claimt stijging maar de gevalideerde richting is '${expected}': "${clause.text.trim()}"`);
      if (saysDown && expected !== 'down') problems.push(`R9: zinsdeel claimt daling maar de gevalideerde richting is '${expected}': "${clause.text.trim()}"`);
      if (saysFlat && expected !== 'flat') problems.push(`R9: zinsdeel claimt 'gelijk gebleven' maar de gevalideerde richting is '${expected}': "${clause.text.trim()}"`);
    }

    if (saysSuperlative) {
      if (!maxDerivation || maxDerivation.kind !== 'max') {
        problems.push(`R9: overtreffende trap zonder ranking-derivatie: "${sentence.text.trim()}"`);
      } else {
        const winner = cellsById.get(maxDerivation.winnerResultId);
        const winnerLabel = winner?.regionLabel ? baseRegionLabel(winner.regionLabel) : null;
        const isLowSuperlative = /\b(laagste|minste)\b/i.test(sentence.text);
        if (isLowSuperlative) {
          const lastId = maxDerivation.rankingResultIds[maxDerivation.rankingResultIds.length - 1];
          const loser = lastId ? cellsById.get(lastId) : undefined;
          const loserLabel = loser?.regionLabel ? baseRegionLabel(loser.regionLabel) : null;
          if (loserLabel && !mentions(sentence.text, loserLabel)) {
            problems.push(`R9: 'laagste/minste' zonder de regio die onderaan de ranking staat (${loserLabel}): "${sentence.text.trim()}"`);
          }
        } else if (winnerLabel && !mentions(sentence.text, winnerLabel)) {
          problems.push(`R9: overtreffende trap zonder de winnaar van de ranking (${winnerLabel}): "${sentence.text.trim()}"`);
        }
      }
    }

    if (comparative) {
      // normalizeQuotes is length-preserving, so positions remain valid.
      const sentenceForSearch = normalizeQuotes(sentence.text).toLowerCase();
      const regionsInSentence = result.cells
        .filter((c) => c.regionLabel !== null && c.value !== null)
        .map((c) => ({
          cell: c,
          pos: sentenceForSearch.indexOf(normalizeQuotes(baseRegionLabel(c.regionLabel!)).toLowerCase()),
        }))
        .filter((r) => r.pos >= 0)
        .sort((a, b) => a.pos - b.pos);
      if (regionsInSentence.length >= 2) {
        if (!maxDerivation || maxDerivation.kind !== 'max') {
          problems.push(`R9: regiovergelijking zonder ranking-derivatie: "${sentence.text.trim()}"`);
        } else {
          const wordPos = comparative.index;
          const before = [...regionsInSentence].reverse().find((r) => r.pos < wordPos) ?? regionsInSentence[0]!;
          const after = regionsInSentence.find((r) => r.pos > wordPos) ?? regionsInSentence[regionsInSentence.length - 1]!;
          const lessWord = /\b(minder|lager|kleiner)\b/i.test(comparative[0]);
          const beforeValue = before.cell.value!;
          const afterValue = after.cell.value!;
          const holds = lessWord ? beforeValue < afterValue : beforeValue > afterValue;
          if (before.cell.resultId === after.cell.resultId) {
            problems.push(`R9: vergelijking waarvan maar één kant een regio noemt: "${sentence.text.trim()}"`);
          } else if (!holds) {
            problems.push(`R9: vergelijking klopt niet met de gevalideerde waarden (${baseRegionLabel(before.cell.regionLabel!)}=${beforeValue} vs ${baseRegionLabel(after.cell.regionLabel!)}=${afterValue}): "${sentence.text.trim()}"`);
          }
        }
      } else if (UP_WORDS.test(sentence.text) || DOWN_WORDS.test(sentence.text)) {
        // 'steeg … hoger dan vorig jaar' — the clause-level trend branch
        // above already judged this sentence's direction claims.
      } else if (/\b(hoger|lager|meer|minder|groter|kleiner)\b/i.test(comparative[0]) && backing) {
        const expected = expectedTrendForClause(sentence, tokens, result, backing.net);
        const claimsUp = /\b(meer|hoger|groter)\b/i.test(comparative[0]);
        if (claimsUp && expected !== 'up') problems.push(`R9: vergelijkend 'meer/hoger dan' strookt niet met richting '${expected}': "${sentence.text.trim()}"`);
        if (!claimsUp && expected !== 'down') problems.push(`R9: vergelijkend 'minder/lager dan' strookt niet met richting '${expected}': "${sentence.text.trim()}"`);
      } else {
        problems.push(`R9: vergelijking zonder gevalideerde basis: "${sentence.text.trim()}"`);
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// The blocking validator
// ---------------------------------------------------------------------------

export function validateAnswerBody(rawBody: string, result: ValidatedResult): AnswerValidationReport {
  const problems: string[] = [];
  // One canonical text for every check below: NFKC-folded, zero-width
  // stripped — no digit shape or invisible character escapes the scan.
  const body = normalizeForScan(rawBody);

  // R3: quantity word-forms are rejected — digits only, and no registered
  // derivation emits word forms.
  for (const match of body.matchAll(QUANTITY_WORD_FORMS)) {
    problems.push(`R3: kwantiteitswoord '${match[0]}' — hoeveelheden alleen in cijfers`);
  }
  for (const match of body.matchAll(CARDINAL_WORD_FORMS)) {
    problems.push(`R3: telwoord '${match[0]}' — hoeveelheden alleen in cijfers`);
  }

  // R3/R1: every numeric token must be backed.
  const tokens = scanBody(body, result);
  for (const token of tokens) {
    if (token.kind === 'unbacked') {
      problems.push(`R3: getal '${token.token}' komt in geen enkele gevalideerde cel of geregistreerde bewerking voor`);
    }
  }

  const cellOrDerivation = tokens.filter((t) => t.kind === 'cell' || t.kind === 'derivation');
  if (result.cells.some((c) => c.value !== null) && cellOrDerivation.length === 0) {
    problems.push('R3: het antwoord bevat geen enkele gevalideerde waarde — een antwoord zonder het gevraagde cijfer is geen antwoord');
  }

  // R10: unit adjacency for every data token.
  const unit = result.cells[0]?.unit ?? '';
  for (const token of cellOrDerivation) {
    problems.push(...checkUnitAdjacency(body, token, token.derivation?.unit ?? unit));
  }

  // R9: binding + direction/comparison words.
  const sentences = splitSentences(body);
  problems.push(...checkBinding(body, sentences, tokens, result));
  problems.push(...checkDirectionWords(body, sentences, tokens, result));

  // Equality claims must hold exactly (no derivation backs 'roughly equal').
  for (const sentence of sentences) {
    if (!EQUALITY_CLAIM.test(sentence.text)) continue;
    const values = result.cells.filter((c) => c.value !== null && sentenceMentionsCellRegion(sentence.text, c) && c.regionLabel !== null);
    const mentioned = values.filter((c) => mentions(sentence.text, baseRegionLabel(c.regionLabel!)));
    if (mentioned.length >= 2 && !mentioned.every((c) => eq(c.value!, mentioned[0]!.value!))) {
      problems.push(`R9: gelijkheidsclaim terwijl de waarden verschillen: "${sentence.text.trim()}"`);
    }
  }

  // R11: every shown provisional value needs the marking IN ITS OWN SENTENCE
  // — a stray 'voorlopig' elsewhere in the body marks nothing (adversarial-
  // review finding, 2026-07-03). Derivations computed from provisional source
  // cells count as provisional themselves.
  const cellsById = new Map(result.cells.map((c) => [c.resultId, c]));
  for (const token of tokens) {
    const provisional =
      token.kind === 'cell'
        ? token.cells.some((c) => c.provisional)
        : token.kind === 'derivation' && token.derivation !== null
          ? derivationSourceCells(token.derivation, cellsById).some((c) => c.provisional)
          : false;
    if (!provisional) continue;
    const sentence = sentenceOf(sentences, token.index);
    if (!/voorlopig/i.test(sentence?.text ?? body)) {
      problems.push(`R11: voorlopige waarde '${token.token}' zonder de markering 'voorlopig cijfer' in dezelfde zin`);
    }
  }

  // A negative derivation shown as a positive number ('met 0,5 procentpunt')
  // needs a decline word somewhere, or two cell values in its sentence that
  // show the direction themselves — magnitude alone hides the sign.
  for (const token of tokens) {
    if (token.kind !== 'derivation' || !token.matchedAbsolute) continue;
    const sentence = sentenceOf(sentences, token.index);
    const cellPairInSentence =
      sentence !== null &&
      tokens.filter((t) => t.kind === 'cell' && t.index >= sentence.start && t.index < sentence.end).length >= 2;
    if (!DOWN_WORDS.test(body) && !cellPairInSentence) {
      problems.push(`R9: negatieve verandering '${token.token}' getoond zonder dalingswoord of expliciete van-naar-waarden`);
    }
  }

  return { ok: problems.length === 0, problems };
}
