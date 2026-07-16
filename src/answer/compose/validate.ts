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
  type MetadataNumberAnchor,
  metadataNumberAnchors,
  normalizeForScan,
  numbersInText,
  periodCodeNumbers,
  tokenContext,
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
    case 'unit_expansion':
      // The exact expanded figure ("= 390.200") — backed so the display
      // splice's token classifies as derivation, never unbacked (ADR 031 D5).
      return [d.value];
  }
}

interface AllowedNumbers {
  periodNumbers: number[];
  /** The cells' verbatim period labels (scan-normalized, lowercased): a body
   * number sitting INSIDE a verbatim label echo ("2025 4e kwartaal") is always
   * a temporal reference — the label-containment leg of periodEcho (#141). */
  periodLabels: string[];
  /** Metadata numbers WITH their source-side context anchors — a body number
   * is exempted as a metadata echo only when it reappears next to one of the
   * same anchors (see metadataEcho), closing the "digit buried in metadata
   * prose whitelists a coincidental fabrication" hole. */
  metadataAnchors: MetadataNumberAnchor[];
  /** Structural counts, AXIS-BOUND (#142): each count may only be echoed next
   * to its OWN axis's structure noun — the pooled version let "in 4
   * gemeenten" ground as 'count' when 4 was the PERIOD count of a
   * single-region result (a wrong-axis claim, hunt-confirmed). */
  countEntries: { value: number; nouns: RegExp }[];
  /** Letter-words of the result's own unit strings ("mln kWh" → mln/kwh) —
   * part of the quantity-noun veto in periodEcho (#141): a period number
   * immediately followed by the result's own unit word is a value claim. */
  unitWords: Set<string>;
}

// #142 axis noun sets (typographic apostrophe variants included — prose may
// carry either). 'vergeleken' may sit between the number and its noun
// (template max: "Van de 4 vergeleken regio's"). Deliberately ONLY the
// granularities the product actually serves: adding 'wijken'/'buurten' here
// let a body describe a 4-GEMEENTE comparison as "4 vergeleken wijken"
// (review-confirmed bypass — the intent schema has no wijk/buurt kind and
// the policy refuses buurt-level questions outright).
const REGION_COUNT_NOUNS = /^\s{0,3}(?:vergeleken\s{1,3})?(?:gemeenten?|regio's|regio’s|provincies|steden)\b/i;
const PERIOD_COUNT_NOUNS = /^\s{0,3}(?:vergeleken\s{1,3})?(?:perioden|periodes|jaren|kwartalen|maanden)\b/i;
const CELL_COUNT_NOUNS = /^\s{0,3}(?:vergeleken\s{1,3})?(?:waarden|cijfers|cellen)\b/i;

function buildAllowedNumbers(result: ValidatedResult): AllowedNumbers {
  const periodNumbers: number[] = [];
  const periodLabels = new Set<string>();
  for (const cell of result.cells) {
    periodNumbers.push(...periodCodeNumbers(cell.periodCode));
    periodNumbers.push(...numbersInText(cell.periodLabel));
    periodLabels.add(normalizeForScan(cell.periodLabel).toLowerCase());
  }
  periodNumbers.push(...periodCodeNumbers(result.attribution.coveredPeriods.from));
  periodNumbers.push(...periodCodeNumbers(result.attribution.coveredPeriods.to));

  const unitWords = new Set<string>();
  for (const unit of [...result.cells.map((c) => c.unit), ...result.derivations.map((d) => d.unit)]) {
    for (const word of unit.toLowerCase().match(/\p{L}{2,}/gu) ?? []) unitWords.add(word);
  }

  // periodSemantics IS a source — for onboarded/explicit results definitionLabel
  // can be null and the "1 januari"-type descriptor lives only here — but it is
  // internal guidance prose ("(B13's groei-in-2024 leunt hierop)", M-codes,
  // revision years), so its anchors are STRICT (both sides must match): a single
  // guidance word never exempts. Label sources are lenient (single distinctive
  // word binds).
  const metadataAnchors: MetadataNumberAnchor[] = [];
  metadataAnchors.push(...metadataNumberAnchors(result.attribution.definitionLabel));
  metadataAnchors.push(...metadataNumberAnchors(result.attribution.periodSemantics, true));
  for (const cell of result.cells) {
    metadataAnchors.push(...metadataNumberAnchors(cell.measureTitle));
    metadataAnchors.push(...metadataNumberAnchors(cell.regionLabel));
    for (const label of Object.values(cell.dimLabels)) {
      metadataAnchors.push(...metadataNumberAnchors(label));
    }
  }

  const countEntries = [
    { value: result.cells.length, nouns: CELL_COUNT_NOUNS },
    { value: new Set(result.cells.map((c) => c.regionCode)).size, nouns: REGION_COUNT_NOUNS },
    { value: new Set(result.cells.map((c) => c.periodCode)).size, nouns: PERIOD_COUNT_NOUNS },
  ];

  return { periodNumbers, periodLabels: [...periodLabels], metadataAnchors, countEntries, unitWords };
}

/** Common Dutch connector/function words that carry no real binding on their
 * own: a body number sitting next to one could coincidentally match an
 * unrelated metadata occurrence (the fix-review's "in 2024" bypass, where
 * "2024" from "groei-in-2024" was anchored by the stopword "in"). A
 * single-sided anchor match THROUGH a stopword therefore does not exempt. */
const ANCHOR_STOPWORDS = new Set([
  'in', 'op', 'de', 'het', 'een', 'en', 'van', 'per', 'met', 'tot', 'voor',
  'bij', 'is', 'dit', 'dat', 'te', 'of', 'aan', 'om', 'als', 'uit', 'over',
  'naar', 'door', 'was', 'zijn', 'nog', 'ook', 'the',
]);

/** A binding anchor must be a real WORD: non-empty, containing a letter (a bare
 * digit run like "2015" or "000" is never distinctive — the fix-review showed
 * CBS's space-grouped labels "20 000 tot 30 000" and index bases "(2015=100)"
 * let a numeral anchor launder a fabricated number), and not a common stopword. */
function isBindingAnchor(word: string): boolean {
  return word !== '' && /\p{L}/u.test(word) && !ANCHOR_STOPWORDS.has(word);
}

/** A body number counts as a metadata echo only when its value matches a
 * metadata number AND it reappears in the body next to the SAME word it sat
 * beside in the source, through a DISTINCTIVE (letter-bearing, non-stopword)
 * word on at least one side, OR the same word on BOTH sides. A bare
 * coincidence, a single common stopword ("in 2024"), or a bare-numeral anchor
 * ("2015=100" / "20 000") never exempts. periodSemantics (`strict`) guidance
 * prose additionally requires BOTH sides to match — a single guidance word
 * ("2024 leunt") never exempts. `ctx` is the body token's before/after runs.
 *
 * KNOWN BOUNDED RESIDUAL (open-questions #140): a fabricated number that equals
 * one of the RESULT's OWN descriptor numbers (an age/income-bracket coordinate,
 * "1 januari") AND is placed next to that descriptor's own distinctive word can
 * still be exempted — the legit coordinate echo and such a fabrication are
 * textually identical, so a deterministic validator cannot separate them.
 * Making the rule strict enough to catch it (both-sides for ALL sources) breaks
 * legit single-sided echoes in real stored answers (measured: 4 R8 reconstruct
 * regressions). This is a major narrowing of the original "any metadata digit
 * exempts" hole, not a full close; the residual is tracked for a later
 * semantic-level fix. */
function metadataEcho(
  value: number,
  ctx: { before: string; after: string },
  anchors: MetadataNumberAnchor[],
): boolean {
  return anchors.some((a) => {
    if (!eq(a.value, value)) return false;
    const beforeMatch = a.before !== '' && a.before === ctx.before;
    const afterMatch = a.after !== '' && a.after === ctx.after;
    if (a.strict) return beforeMatch && afterMatch && (isBindingAnchor(a.before) || isBindingAnchor(a.after));
    if (beforeMatch && isBindingAnchor(a.before)) return true;
    if (afterMatch && isBindingAnchor(a.after)) return true;
    return beforeMatch && afterMatch;
  });
}

// ---------------------------------------------------------------------------
// #141: the period exemption requires TEMPORAL CONTEXT
// ---------------------------------------------------------------------------
// The pre-fix rule exempted ANY integer body token equal to ANY number a
// covered period contributes (years, but also the quarter/month sequence
// numbers 1–12 of KW/MM results and every digit in a period label) — with NO
// context. A fabricated value that merely coincided with one ("2024
// gemeenten" as a count; "steeg met 4 punten" in a Q4 result) passed every
// check — the same bypass class #140 closed on the metadata side. Period
// labels have no anchor word of their own ("2024" is just a bare numeral), so
// the #140 source-anchor mechanism does not transpose; instead the BODY-side
// context must look temporal. All allow-patterns below are grounded in the
// measured phrasing corpus (every stored answer fixture + benchmark +
// experience-audit body, 2026-07-16): fail-closed, a rejected rare phrasing
// costs one regeneration, a tolerated fabrication breaks the core promise.
//
// KNOWN ACCEPTED RESIDUALS (mirror the #140/#144 deterministic ceiling):
// (a) a fabrication that BOTH follows a temporal marker AND precedes a noun
// outside the quantity-noun list ("na 2024 pogingen") still passes — listing
// every Dutch noun is unbounded; the semantic-level pass tracked as #144 is
// the real close. (b) a fabricated clause that exactly mimics the LIST-LABEL
// shape ("; 2025: geen waarde") is word-for-word identical to the legit
// template line and cannot be separated deterministically — but the shape
// admits no fabricated MAGNITUDE (a digit after the colon is itself scanned
// and must be backed; a wrong-year label over a real value is caught by R9
// period binding). Rare LEGIT phrasings outside the corpus ("Q4 2025", a
// year as bare sentence subject) are rejected → regenerate/template: quality
// cost, never a wrong number.
//
// Adversarial-review hardenings (2026-07-16, 5-lens + refute-verify round):
// the first version's bare-colon TEMPORAL_AFTER leg exempted "daarnaast
// 2025: extra gemeenten" (confirmed critical bypass — the list-label legs
// now ALSO require list context BEFORE the token and a value/'geen waarde'
// AFTER the colon); the noun veto now fires through a hyphen ("2024-
// gemeenten"); and every whitespace bridge is capped (\s{0,3}) so a
// window-slice boundary can never fabricate a word boundary for \b (the
// 46-spaces probe).

const MONTH_NAMES = '(?:januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)';

/** Does the text ENDING at a period number mark it as temporal? Multiword
 * chains matched right-to-left from the token ("tot en met", "ten opzichte
 * van", "het 4e kwartaal van", a span's first leg "2019 tot/en/naar"). Bare
 * "op"/"per"/"met"/"van" deliberately absent: each precedes fabricated
 * quantities as easily as periods ("een stijging van 2024", "steeg met
 * 2024"); "van" only counts led by a temporal noun, "naar"/"tot"/"en" only
 * led by another period number. "voor" IS listed — the template's own null
 * branch opens with it ("Voor 2024 in Aduard is er geen waarde") and the
 * quantity-noun veto still blocks "voor 2024 banen". "heel/geheel" is listed:
 * "in heel 2025" is idiomatic Dutch annual-total prose, and 'heel' only ever
 * reads temporally directly before a year. Whitespace bridges are capped at
 * 3 so a marker must genuinely sit next to the number (also the anti-fake-\b
 * guard: a marker can then never start exactly at the 48-char window edge —
 * that would need a 45+-char marker). */
const TEMPORAL_BEFORE = new RegExp(
  '(?:' +
    `\\b(?:in|tussen|sinds|vanaf|sedert|na|voor|gedurende|rond|omstreeks|eind|einde|ultimo|begin|medio|halverwege|jaar|kalenderjaar|vóór|heel|geheel|${MONTH_NAMES})` +
    '|\\btot\\s{1,3}en\\s{1,3}met|\\bt/m' +
    '|\\bten\\s{1,3}opzichte\\s{1,3}van|\\bt\\.o\\.v\\.|\\bvergeleken\\s{1,3}met' +
    '|\\b(?:kwartaal|kwartalen|maand|maanden|halfjaar|periode|jaren)\\s{1,3}van' +
    `|\\b(?:19|20)\\d{2}(?:\\s{1,3}${MONTH_NAMES}|\\s{1,3}[1-4]e\\s{1,3}kwartaal)?\\s{1,3}(?:en|tot(?:\\s{1,3}en\\s{1,3}met)?|t/m|naar)` +
    "|\\b(?:19|20)\\d{2}\\s{0,3}[-–/]\\s{0,3}'?" +
    ')\\s{0,3}$',
  'iu',
);

/** Does the text STARTING right after a period number mark it as temporal?
 * The CBS label order ("2026 mei", "2025 4e kwartaal") or a span/range
 * continuation onto another year. NOTE: the list-label colon forms live in
 * LIST_LABEL_AFTER + LIST_CONTEXT_BEFORE, NOT here — a bare un-vetoed ':'
 * leg here was a confirmed review bypass ("daarnaast 2025: extra
 * gemeenten"). */
const TEMPORAL_AFTER = new RegExp(
  '^\\s{0,3}(?:' +
    `${MONTH_NAMES}\\b` +
    '|[1-4]e\\s{1,3}kwartaal\\b' +
    "|(?:tot(?:\\s{1,3}en\\s{1,3}met)?|t/m|en|naar)\\s{1,3}'?(?:19|20)\\d{2}\\b" +
    "|[-–/]\\s{0,3}'?\\d{2,4}\\b" +
    ')',
  'iu',
);

/** The list-label exemption ("2024: 7.815", "2024 in Aduard: geen waarde —
 * …", "…per periode: 2019: 7.815 (x 1 000); 2020: …") needs BOTH sides: the
 * year must OPEN a list item (body start, or right after ';' / ':' / a line
 * break — never mid-clause), and the colon must introduce a VALUE (itself
 * scanned and R3-checked) or the template's literal 'geen waarde'. This is
 * what keeps "daarnaast 2025: extra gemeenten" (review bypass) out while the
 * template's own list lines pass by construction. */
const LIST_CONTEXT_BEFORE = /(?:^|[;:\n])\s{0,3}$/;
const LIST_LABEL_AFTER = new RegExp(
  "^\\s{0,3}(?:in\\s{1,3}[^:;.\\n]{1,40}\\s{0,3})?:\\s{0,3}(?:-?\\d|geen\\s{1,3}waarde\\b)",
  'iu',
);

/** Quantity nouns that turn "TEMPORAL year" into a value claim anyway:
 * "in 2024 gemeenten steeg het aantal" reads temporally up to the year but
 * claims a count. Structure nouns (countContext's list), person/thing nouns
 * CBS answers actually count, units and scale words. Checked as the token's
 * IMMEDIATE next word — across whitespace or a hyphen ("2024-gemeenten",
 * review hardening), but not across a comma ("2024, gemeenten" is clause
 * structure, not a claim) — together with the result's own unit words
 * (AllowedNumbers.unitWords). */
const QUANTITY_NOUN_AFTER = new RegExp(
  '^(?:' +
    "euro|cent|dollar|procent\\w*|punt|punten|gemeente|gemeenten|regio's|provincies|steden|wijken|buurten" +
    '|perioden|periodes|jaren|kwartalen|maanden|weken|dagen|uren|keer|maal' +
    '|inwoners|personen|mensen|huishoudens|woningen|banen|bedrijven|instellingen|vestigingen' +
    "|faillissementen|uitkeringen|werklozen|werknemers|leerlingen|studenten|migranten|asielzoekers" +
    "|voertuigen|auto's|eenheden|stuks|gevallen|meldingen|aanvragen|transacties|verkopen" +
    '|hectare|kilometer|meter|ton|kilo|kilogram|gram|liter|kwh|mwh|gwh|mln|mld|miljoen\\w*|miljard\\w*|duizend\\w*' +
    ')$',
  'iu',
);

const YEAR_SHAPED = /^(?:19|20)\d{2}$/;

/** A sub-year sequence number (the 4 of Q4, a month 1–12) is temporal only
 * directly after its own grain word — everything else is a data claim. */
const SUBYEAR_BEFORE = /\b(?:kwartaal|kwartalen|maand|maanden)\s{0,3}$/i;

/** Glued-ordinal form ('4e kwartaal', '1ste maand'): the ordinal marker the
 * token is glued to must lead straight into a grain word. */
const ORDINAL_TEMPORAL_AFTER = /^(?:e|de|ste)\s{1,3}(?:kwartaal|kwartalen|maand|maanden|halfjaar)\b/iu;

/** Token sits inside a VERBATIM occurrence of a cell's period label ("2025 4e
 * kwartaal", a future "2019/'20") — always temporal. The label must be longer
 * than the token itself: a bare yearly label ("2024") equals every bare year
 * token and would void the context requirement. */
function insidePeriodLabel(masked: string, index: number, length: number, labels: string[]): boolean {
  const lower = masked.toLowerCase();
  return labels.some((label) => {
    if (label.length <= length) return false;
    for (let from = 0; ; ) {
      const i = lower.indexOf(label, from);
      if (i < 0) return false;
      if (index >= i && index + length <= i + label.length) return true;
      from = i + 1;
    }
  });
}

/** The #141 gate: may this periodNumbers-matching token ground as 'period'? */
function periodEcho(masked: string, token: { index: number; token: string }, allowed: AllowedNumbers): boolean {
  const end = token.index + token.token.length;
  if (insidePeriodLabel(masked, token.index, token.token.length, allowed.periodLabels)) return true;
  const before = masked.slice(Math.max(0, token.index - 48), token.index);
  const after = masked.slice(end, end + 48);
  if (!YEAR_SHAPED.test(token.token)) return SUBYEAR_BEFORE.test(before);
  // List-label form: BOTH sides must fit (review hardening — a one-sided
  // colon exemption was a confirmed bypass).
  if (LIST_CONTEXT_BEFORE.test(before) && LIST_LABEL_AFTER.test(after)) return true;
  if (TEMPORAL_AFTER.test(after)) return true;
  if (!TEMPORAL_BEFORE.test(before)) return false;
  const nextWord = after.match(/^(?:\s{1,3}|\s{0,3}[-–]\s{0,3})(\p{L}+)/u)?.[1]?.toLowerCase() ?? '';
  return nextWord === '' || (!QUANTITY_NOUN_AFTER.test(nextWord) && !allowed.unitWords.has(nextWord));
}

/** The glued variant (digits glued to letters, '4e'/'1ste'): only the ordinal
 * grain form or a verbatim label echo is temporal — '4x zo hoog' is not. */
function gluedPeriodEcho(masked: string, token: { index: number; token: string }, allowed: AllowedNumbers): boolean {
  const end = token.index + token.token.length;
  return (
    insidePeriodLabel(masked, token.index, token.token.length, allowed.periodLabels) ||
    ORDINAL_TEMPORAL_AFTER.test(masked.slice(end, end + 24))
  );
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
  // Since #142 the noun must belong to the SAME axis as the count it echoes
  // ("in 4 gemeenten" in a single-region 4-period result is a wrong-axis
  // claim, not a structural mention).
  const countContext = (index: number, length: number, nouns: RegExp): boolean =>
    nouns.test(masked.slice(index + length, index + length + 40));

  return findNumericTokens(masked).map((token) => {
    // The body-side context of this token (the alnum runs touching it) — the
    // metadata-echo check binds a whitelisted metadata number to the same word
    // it sat beside in the source, so a coincidental fabrication is not exempt.
    const ctx = tokenContext(masked, token.index, token.token.length);
    // A digit run glued to a letter ('4e kwartaal', '1e') is an ordinal or
    // embedded marker, never a standalone value: it may only ground as
    // period/metadata (found live: the '4' in periodLabel '2025 4e kwartaal'
    // collided with the cell value 4,0 and demanded a % sign).
    const nextChar = masked[token.index + token.token.length] ?? '';
    if (/\p{L}/u.test(nextChar)) {
      if (
        Number.isInteger(token.value) &&
        allowed.periodNumbers.some((n) => eq(n, token.value)) &&
        gluedPeriodEcho(masked, token, allowed)
      ) {
        return { ...token, kind: 'period' as const, cells: [], derivation: null, matchedAbsolute: false };
      }
      if (metadataEcho(token.value, ctx, allowed.metadataAnchors)) {
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
    if (
      Number.isInteger(token.value) &&
      allowed.periodNumbers.some((n) => eq(n, token.value)) &&
      periodEcho(masked, token, allowed)
    ) {
      return { ...token, kind: 'period' as const, cells: [], derivation: null, matchedAbsolute: false };
    }
    if (metadataEcho(token.value, ctx, allowed.metadataAnchors)) {
      return { ...token, kind: 'metadata' as const, cells: [], derivation: null, matchedAbsolute: false };
    }
    if (
      Number.isInteger(token.value) &&
      allowed.countEntries.some(
        (entry) => eq(entry.value, token.value) && countContext(token.index, token.token.length, entry.nouns),
      )
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
/** Exported for the #125a display splice (expand.ts): the expansion anchors
 * on the same window this validator proved the unit phrase sits in. */
export const UNIT_SUFFIX = 24;

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
        : d.kind === 'unit_expansion'
          ? d.sourceResultIds
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
