// Deterministic Dutch number formatting + numeric-token scanning — the
// foundation of R3 (verbatim numbers) and R1's answer-side scan.
//
// Design: values are formatted HERE, once, and handed to both the LLM prompt
// (which is told to copy the strings) and the template. The validator then
// parses every numeric token in the produced text back to a number and checks
// it against the result's cells and registered derivations. Formatting may
// localize; the value may not change (R3).
import type { ValidatedResult } from '../../query/index.ts';
import { resolveSource } from '../../sources/registry.ts';

/** Canonical form for scanning: NFKC folds fullwidth/compatibility digits
 * (９→9, ¹→1) into ASCII so no digit shape escapes the tokenizer, and
 * zero-width characters are stripped so they cannot split a token. Applied
 * ONCE at the validator entry; all indices below refer to this form.
 * (Adversarial-review finding, 2026-07-03: fullwidth digits were invisible.) */
export function normalizeForScan(text: string): string {
  // U+2212 (true minus) folds to '-' so a sign always survives tokenization \u2014
  // NFKC does not map it (session-30 review: negative cell values). En/em
  // dashes are NOT folded: between digits they are range punctuation.
  return text.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\u2212/g, '-');
}

/** Dutch-locale formatting: thousands '.', decimal ','. `decimals` comes from
 * the CBS cell metadata (R10) — never chosen here. */
export function formatValueNl(value: number, decimals: number): string {
  const fixed = Math.abs(value).toFixed(decimals);
  const [intPart, fracPart] = fixed.split('.');
  const grouped = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const sign = value < 0 ? '-' : '';
  return sign + (fracPart ? `${grouped},${fracPart}` : grouped);
}

/** Parse a Dutch-formatted numeric token back to a number. */
export function parseNlNumber(token: string): number {
  return Number.parseFloat(token.replaceAll('.', '').replace(',', '.'));
}

/** Numeric tokens in Dutch prose: '18.044.027', '3,3', '2024', '-24'. The
 * dotted alternative must come first so grouped numbers match whole. A
 * leading '-' belongs to the token ONLY when it does not follow a digit: a
 * '-' between digits is a range ('2019-2024'), never a sign. Sign-aware
 * since the session-30 review: the previously unsigned tokenizer meant a
 * negative CELL value ('-24', the live consumentenvertrouwen answer) could
 * never match its cell — every negative-valued answer failed R3, the LLM
 * phrasing rung was permanently dead for them, and R8 re-validation failed
 * on the stored body. With the sign captured, '-24' matches the -24 cell
 * exactly; a sign-DROPPED display ('24' for a -24 cell, or '-24' for a +24
 * cell) stays unbacked and fails R3 — strictly stricter, never looser.
 * Negative DERIVATION values keep the additional absolute-value +
 * direction-word path (scanBody's matchedAbsolute). The lookbehind guards
 * ONLY the sign (a '-' after a letter is compound punctuation, 'top-3');
 * bare digit runs tokenize exactly as before ('CO2' still yields '2', so a
 * number can never hide inside a compound). */
const NUMBER_TOKEN = /(?:(?<![\p{L}\d])-)?\d{1,3}(?:\.\d{3})+(?:,\d+)?|(?:(?<![\p{L}\d])-)?\d+(?:,\d+)?/gu;

export interface NumericToken {
  token: string;
  /** Start index in the (masked) text — masking is same-length, so indices
   * are valid in the original text too. */
  index: number;
  value: number;
}

export function findNumericTokens(text: string): NumericToken[] {
  const tokens: NumericToken[] = [];
  for (const match of text.matchAll(NUMBER_TOKEN)) {
    tokens.push({ token: match[0], index: match.index, value: parseNlNumber(match[0]) });
  }
  return tokens;
}

/** Same-length masking: replaces every occurrence of `phrase` (case-insensitive,
 * whitespace-tolerant) with NULs so the tokenizer skips digits that belong to
 * a unit string ('x 1 000', '1 000 euro') rather than to a data claim. Token
 * indices stay valid in the original text. */
export function maskPhrases(text: string, phrases: string[]): string {
  let masked = text;
  // Longest first, so 'x 1 000 euro' wins over '1 000 euro'.
  const ordered = [...new Set(phrases)].sort((a, b) => b.length - a.length);
  for (const phrase of ordered) {
    if (phrase.length === 0) continue;
    const pattern = new RegExp(
      phrase
        .split(/\s+/)
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[\\s\\u00a0]+'),
      'gi',
    );
    // Written as an ESCAPE, never a raw NUL byte: a raw byte makes grep and
    // friends treat this whole source file as binary (task_e718f60d).
    masked = masked.replace(pattern, (m) => '\u0000'.repeat(m.length));
  }
  return masked;
}

/** Unit strings that contain digits must be masked before token scanning,
 * in every spelling the prose may reasonably use. Units without digits need
 * no masking (the tokenizer only sees digits). */
export function unitMaskPhrases(unit: string): string[] {
  if (!/\d/.test(unit)) return [];
  const bare = unit.trim();
  const variants = new Set<string>([bare]);
  // 'x 1 000' / '1 000 euro' style factor units: tolerate ×, dots and a
  // leading 'x ' the CBS string may or may not carry.
  const withX = bare.startsWith('x ') || bare.startsWith('× ') ? bare : `x ${bare}`;
  variants.add(withX);
  variants.add(withX.replace(/^x /, '× '));
  for (const v of [...variants]) {
    variants.add(v.replaceAll('1 000', '1.000'));
  }
  return [...variants];
}

/** Numbers that legitimately appear in prose because they come from validated
 * metadata text (period labels, definition labels, measure titles, region
 * labels, period semantics) — R1's structural exemption, matched against the
 * validated result, so a year that belongs to neither data nor metadata still
 * fails. */
export function numbersInText(text: string | null | undefined): number[] {
  if (!text) return [];
  return findNumericTokens(text).map((t) => t.value);
}

/** The alphanumeric run nearest a boundary — the last one before `end` of the
 * fragment ('before') or the first one after its start ('after') — skipping up
 * to 4 non-alnum separator chars (space, '=', ',', '(', etc.). Lowercased; ''
 * when there is no alnum run within reach. */
function adjacentAlnum(fragment: string, side: 'before' | 'after'): string {
  const m =
    side === 'before'
      ? fragment.match(/([\p{L}\p{N}]+)[^\p{L}\p{N}]{0,4}$/u)
      : fragment.match(/^[^\p{L}\p{N}]{0,4}([\p{L}\p{N}]+)/u);
  return m ? m[1]!.toLowerCase() : '';
}

/** A metadata number paired with the words that sit immediately on either side
 * of it in the SOURCE metadata prose — its context anchor. `strict` sources
 * (periodSemantics guidance prose) require a full both-side phrase echo; label
 * sources allow a single distinctive word (validate.ts metadataEcho). */
export interface MetadataNumberAnchor {
  value: number;
  before: string;
  after: string;
  strict: boolean;
}

/** Metadata numbers WITH their source-side context anchors. The validator
 * (validate.ts) may only exempt a body number as a metadata echo when it
 * reappears next to one of these same anchors through a DISTINCTIVE word — so a
 * fabricated value that merely COINCIDES with a digit buried in metadata prose
 * (the "2024" inside a "2024JJ00" period code, the "100" inside an index base
 * "2015=100", a bare-numeral neighbour) is NOT whitelisted, while a genuine echo
 * ("op 1 januari" → the "1" beside "januari") still is. `strict` marks a
 * guidance-prose source (periodSemantics) that requires both sides to match. */
export function metadataNumberAnchors(
  text: string | null | undefined,
  strict = false,
): MetadataNumberAnchor[] {
  if (!text) return [];
  return findNumericTokens(text).map((t) => ({
    value: t.value,
    before: adjacentAlnum(text.slice(0, t.index), 'before'),
    after: adjacentAlnum(text.slice(t.index + t.token.length), 'after'),
    strict,
  }));
}

/** The body-side context of a numeric token — the alnum runs immediately
 * before/after it (same extraction as the source anchors), for matching
 * against a MetadataNumberAnchor. Exported so validate.ts can reuse it. */
export function tokenContext(text: string, index: number, length: number): { before: string; after: string } {
  return {
    before: adjacentAlnum(text.slice(0, index), 'before'),
    after: adjacentAlnum(text.slice(index + length), 'after'),
  };
}

/** Ensure a definition blurb ends as a sentence — appends a terminal period when
 * one is missing, never altering CBS's words (principle a). */
function withTerminalPunctuation(text: string): string {
  return /[.?!]$/.test(text) ? text : `${text}.`;
}

/** The answer's "Definitie:" line — the SINGLE source of truth, used both to
 * BUILD the line (compose.ts) and to RE-DERIVE it for R8 audit verification
 * (audit/reconstruct.ts), so the two can never drift (a drift the #115 review
 * caught). Priority:
 *  (b) a real, verbatim CBS definition captured for an on-demand-onboarded
 *      measure (attribution.definitionText, #115 lever b) — its meaning + any
 *      scale, in CBS's own words; else
 *      the short definitionLabel (the curated Phase-0 phrase), SUPPRESSED when
 *      it merely echoes the measure's own title (the circular onboarded case,
 *      #115 lever a). Case-SENSITIVE: the seed 'population' label differs from
 *      its title only in case and must survive (see compose history). */
export function buildDefinitionLine(result: ValidatedResult): string | null {
  // `?? null` (not a bare read): audit rows stored before this field existed
  // (session 29, #115 lever b) serialize their `attribution` object WITHOUT
  // a `definitionText` key at all — `undefined` at runtime despite the
  // `string | null` type. Absent must resolve exactly like `null` (the same
  // A1 fail-safe discipline WP30a applied to `attribution.source`), or R8
  // reconstruction crashes instead of falling back to `definitionLabel`.
  const definitionText = result.attribution.definitionText ?? null;
  const definitionLabel = result.attribution.definitionLabel;
  const measureTitle = result.cells[0]?.measureTitle ?? null;
  if (definitionText !== null && definitionText.trim().length > 0) {
    return `Definitie: ${withTerminalPunctuation(definitionText.trim())}`;
  }
  const isCircular =
    definitionLabel !== null &&
    measureTitle !== null &&
    definitionLabel.replace(/\s+/g, ' ').trim() === measureTitle;
  return definitionLabel === null || isCircular ? null : `Definitie: ${definitionLabel}.`;
}

/** WP26 mechanism B (ADR 024 decision 2 + the owner-approved safelist): the
 * disclosure sentence for an answer that filled in a structurally-determined
 * axis the question left open. The SINGLE source of truth, like
 * buildDefinitionLine above — compose.ts builds the line with it and
 * audit/reconstruct.ts RE-DERIVES it from the stored result, so the shown
 * assumption and the audited one can never drift.
 *
 * Three properties make this the honest side of the principle-(c) line:
 *  - it is assembled by CODE from validated result state, never by the LLM, and
 *    sits OUTSIDE the body the answer validator scans (R1's structural
 *    exemption, exactly like the definition and attribution lines);
 *  - it carries NO number — it names the assumption, not a value;
 *  - it states the correction path in the same breath, so the reader is never
 *    stuck with a reading they did not ask for.
 *
 * `?? false` on every flag: pre-WP26 rows serialize no key at all, and
 * `undefined !== false` would otherwise fabricate a disclosure on ~every
 * historical row (the lesson the WP16 `onboarding` field taught). */
export function buildAssumptionLine(result: ValidatedResult): string | null {
  const parts: string[] = [];
  if (result.regionDefaulted ?? false) {
    parts.push(
      'Dit is het landelijke cijfer voor heel Nederland. ' +
        'Noem een gemeente of provincie in je vraag als je een specifieke regio wilt.',
    );
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

/** The R4 attribution sentence — the single builder for every surface that
 * displays it: answer text (compose) and chart specs (WP8). One source of
 * truth so the two can never drift apart. */
export function buildAttributionLine(result: ValidatedResult): string {
  const a = result.attribution;
  const labelByCode = new Map(result.cells.map((c) => [c.periodCode, c.periodLabel]));
  const from = labelByCode.get(a.coveredPeriods.from) ?? a.coveredPeriods.from;
  const to = labelByCode.get(a.coveredPeriods.to) ?? a.coveredPeriods.to;
  const period = from === to ? from : `${from} t/m ${to}`;
  // WP30a (ADR 030 D3): the label comes from the source registry; absent
  // source (every pre-WP30a stored row) resolves to 'cbs' (A1) — the line is
  // byte-identical to the pre-WP30a literal. The license stays the STORED
  // field: old rows re-derive from their own bytes, never from live config.
  return (
    `Bron: ${resolveSource(a.source).attributionLabel}, tabel ${a.tableId} — ${a.tableTitle}. ` +
    `Gegevens gesynchroniseerd op ${a.syncedAt.slice(0, 10)}. Periode: ${period}. Licentie: ${a.license}.`
  );
}

/** Decompose a CBS period code into the integers prose may cite: year, and
 * quarter/month number when present. '2025KW04' → [2025, 4]. */
export function periodCodeNumbers(code: string): number[] {
  const year = Number.parseInt(code.slice(0, 4), 10);
  const numbers = Number.isNaN(year) ? [] : [year];
  const grain = code.slice(4, 6);
  const seq = Number.parseInt(code.slice(6, 8), 10);
  if ((grain === 'KW' || grain === 'MM') && !Number.isNaN(seq) && seq > 0) {
    numbers.push(seq);
  }
  return numbers;
}
