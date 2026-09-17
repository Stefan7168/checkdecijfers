// Deterministic Dutch number formatting + numeric-token scanning — the
// foundation of R3 (verbatim numbers) and R1's answer-side scan.
//
// Design: values are formatted HERE, once, and handed to both the LLM prompt
// (which is told to copy the strings) and the template. The validator then
// parses every numeric token in the produced text back to a number and checks
// it against the result's cells and registered derivations. Formatting may
// localize; the value may not change (R3).
import type { PeriodGrain, RegionScope, ValidatedResult } from '../../query/index.ts';
import { EUROSTAT_SOURCE_KEY, resolveSource } from '../../sources/registry.ts';

/** Region label as prose uses it: "Utrecht (gemeente)" → "Utrecht". Lives
 * here (not in validate.ts, which re-exports it) so the structural line
 * builders below can name a region exactly as the body does, without the
 * builders importing the validator that in turn imports this file. */
export function baseRegionLabel(label: string): string {
  return label.replace(/\s*\(.*\)\s*$/, '').trim();
}

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
  if (result.periodDefaulted ?? false) {
    // The window's end is named from the CELLS themselves (the last period we
    // actually served), never from a computed "today" — so the sentence can
    // only ever describe data that is really in the answer.
    const last = result.cells[result.cells.length - 1];
    const until = last === undefined ? null : last.periodLabel;
    parts.push(
      until === null
        ? 'Dit is het recente verloop.'
        : `Dit is het verloop over de afgelopen jaren, t/m ${until}.`,
    );
    parts.push('Vraag gerust naar alleen het laatste cijfer of naar een andere periode.');
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

// ---------------------------------------------------------------------------
// #253 — the region-class coverage disclosure (RegionSetCoverage → one line)
// ---------------------------------------------------------------------------

/** The Dutch noun for each region class, singular + plural. CBS's own class
 * names, never reworded (principle a). */
const REGION_SET_NOUNS: Record<RegionScope['kind'], readonly [string, string]> = {
  all_provincies: ['provincie', 'provincies'],
  all_landsdelen: ['landsdeel', 'landsdelen'],
  all_gemeenten: ['gemeente', 'gemeenten'],
  gemeenten_in_provincie: ['gemeente', 'gemeenten'],
};

/** The class noun for the STRUCTURAL disclosure line, which no validator
 * scans — so it may name the class exactly as CBS does. */
export function regionSetNoun(scope: RegionScope, count: number): string {
  const [singular, plural] = REGION_SET_NOUNS[scope.kind];
  return count === 1 ? singular : plural;
}

/** The class noun the BODY may use, which is NOT the same question: a count in
 * the scanned body is only structural when the word right after it is one of
 * validate.ts's own REGION_COUNT_NOUNS ("gemeenten", "provincies", "regio's",
 * "steden"). 'landsdelen' is not among them — deliberately, since that set is
 * the granularities the product actually serves — so a landsdeel class counts
 * itself as "regio's" rather than smuggling a new noun into the validator.
 * `count` only ever distinguishes the counted plural ("Van de 26 gemeenten",
 * always ≥ 2 — run.ts refuses below two applicable members) from the
 * uncounted singular of a "per gemeente" header. */
export function regionSetBodyNoun(scope: RegionScope, count: number): string {
  if (scope.kind === 'all_landsdelen') return count === 1 ? 'regio' : "regio's";
  return regionSetNoun(scope, count);
}

/** How many excluded members are named rather than merely counted. Above this,
 * a list stops informing and starts being a wall of text (a 342-gemeente class
 * can exclude dozens); the count itself is never dropped. */
const REGION_SET_NAMED_LIMIT = 5;

/** A roster member's display name. The SERVED members carry their verbatim CBS
 * region label on their own cell; an excluded member has no cell (and the
 * coverage record stores codes, not labels), so it is named by its CBS region
 * code — a real, checkable identifier rather than a guessed name.
 * **Assumption:** a CBS region code is an acceptable display name for an
 * excluded member. Carrying the roster's labels in the coverage record would
 * remove the assumption; nothing today needs them. (#253 task 8 owns the
 * open-questions row — this task's own doc scope is the plan's as-built note.) */
function regionMemberName(code: string, result: ValidatedResult): string {
  const cell = result.cells.find((c) => c.regionCode === code);
  return cell?.regionLabel ? baseRegionLabel(cell.regionLabel) : code;
}

function namedSuffix(codes: string[], result: ValidatedResult): string {
  if (codes.length > REGION_SET_NAMED_LIMIT) return '';
  return ` (${codes.map((code) => regionMemberName(code, result)).join(', ')})`;
}

/** #253: the region-class coverage disclosure — which members of the class the
 * answer actually covers, and which it could not.
 *
 * The SINGLE source of truth, exactly like buildAssumptionLine above:
 * compose.ts builds the line with it and audit/reconstruct.ts re-derives it
 * byte-identically from the stored result (R8), so the shown disclosure and
 * the audited one can never drift.
 *
 * Why it is a structural line and not prose in the body: it is the one part of
 * a region-class answer whose digits describe the ROSTER (42 members, 16 of
 * them excluded) rather than any CBS cell. R1's exemptions are structural,
 * never pattern-based — a roster count inside the scanned body would be an
 * unbacked number and would rightly fail. Outside it, assembled by
 * deterministic code from the validated coverage record, it is the same class
 * of line as the definition, assumption and attribution lines.
 *
 * `?? null` (A1, docs/13): every non-region-set result, and every row stored
 * before #253, carries no `regionSet` key at all. */
export function buildRegionSetLine(result: ValidatedResult): string | null {
  const coverage = result.regionSet ?? null;
  if (coverage === null) return null;
  const scope = coverage.scope;
  const noun = (n: number): string => regionSetNoun(scope, n);
  // "Applicable" is a property of the served cells, not of the buckets: a
  // withheld member IS a cell (R11 keeps it, with its reason) but carries no
  // number.
  const applicable = result.cells.filter((c) => c.value !== null).length;

  const parts: string[] = [
    applicable === coverage.rosterSize
      ? `Dekking: alle ${coverage.rosterSize} ${noun(coverage.rosterSize)} in deze tabel hebben een cijfer.`
      : `Dekking: ${applicable} van de ${coverage.rosterSize} ${noun(coverage.rosterSize)} hebben een cijfer.`,
  ];

  if (coverage.notApplicable.length > 0) {
    const n = coverage.notApplicable.length;
    parts.push(
      `${n} ${noun(n)} ${n === 1 ? 'bestond' : 'bestonden'} in deze periode niet volgens het CBS` +
        `${namedSuffix(coverage.notApplicable, result)}.`,
    );
  }
  if (coverage.withheld.length > 0) {
    const n = coverage.withheld.length;
    // The REASON per withheld member is stated in the body itself: a withheld
    // member always makes the class incomplete, and an incomplete class
    // renders the per-member lines (template.ts renderRegionSet), each with
    // its own CBS reason (R11). This line counts and names them.
    parts.push(`Voor ${n} ${noun(n)} publiceert het CBS geen waarde${namedSuffix(coverage.withheld, result)}.`);
  }
  if (coverage.missing.length > 0) {
    const n = coverage.missing.length;
    parts.push(
      `Van ${n} ${noun(n)} hebben wij geen cijfer in onze database${namedSuffix(coverage.missing, result)}.`,
    );
  }
  if (!coverage.complete) {
    // RS1, said out loud. Deliberately phrased WITHOUT the words it is
    // explaining the absence of ("hoogste"/"laagste"): those belong to a claim
    // this answer is not making.
    parts.push('Daarom noemt dit antwoord geen rangorde.');
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// ADR 055 — the multi-region-series coverage disclosure
// (RegionSeriesCoverage → one line)
// ---------------------------------------------------------------------------

/** The Dutch noun for the period grain, singular + plural — the unit the
 * coverage sentence counts in ("in 2 van de 6 gevraagde jaren"). CBS's own
 * grain, never reworded (principle a). */
const PERIOD_GRAIN_NOUNS: Record<PeriodGrain, readonly [string, string]> = {
  JJ: ['jaar', 'jaren'],
  KW: ['kwartaal', 'kwartalen'],
  MM: ['maand', 'maanden'],
};

/** ADR 055 / **MS1**: the per-region coverage disclosure of a multi-region
 * series — which named region could not be given a development, and why.
 *
 * The SINGLE source of truth, exactly like buildRegionSetLine above:
 * compose.ts builds the line with it and audit/reconstruct.ts re-derives it
 * byte-identically from the stored result (R8), so the shown disclosure and
 * the audited one can never drift.
 *
 * Why it is a structural line and not prose in the body: its digits count
 * REQUESTED PERIODS and MISSING CELLS — the coverage record's own facts —
 * rather than any CBS cell value. R1's exemptions are structural, never
 * pattern-based, so those digits inside the scanned body would be unbacked
 * numbers and would rightly fail. Outside it, assembled by deterministic code
 * from the validated coverage record, it is the same class of line as the
 * definition, assumption and region-set lines.
 *
 * `null` when the coverage is COMPLETE — there is nothing to disclose, and
 * every answer of another shape (and every row stored before ADR 055) carries
 * no `regionSeries` key at all (`?? null`, A1, docs/13).
 *
 * A `partial` region has cells, so it is named by its verbatim CBS label; an
 * `excluded` region has none, so it is named by its bare CBS region code —
 * the same **Assumption** ADR 054 D6 recorded for the region-set line's
 * excluded members, which open-questions #266 already mirrors. */
export function buildRegionSeriesLine(result: ValidatedResult): string | null {
  const coverage = result.regionSeries ?? null;
  if (coverage === null) return null;
  if (coverage.complete) return null;
  // The requested periods: every SERVED region carries a cell at each of them
  // (a region missing a row is excluded entirely, never shortened), so the
  // distinct period codes of the served cells ARE the asked window.
  const requestedPeriods = new Set(result.cells.map((c) => c.periodCode)).size;
  const [singular, plural] = PERIOD_GRAIN_NOUNS[result.cells[0]?.grain ?? 'JJ'];
  const noun = (n: number): string => (n === 1 ? singular : plural);
  const parts: string[] = [];
  for (const code of coverage.partial) {
    // R11 keeps a withheld cell present WITH its CBS reason, so the count is a
    // fact about the served cells, not a guess.
    const missing = result.cells.filter((c) => c.regionCode === code && c.value === null).length;
    parts.push(
      `Voor ${regionMemberName(code, result)} ontbreekt een cijfer in ${missing} van de ${requestedPeriods} ` +
        `gevraagde ${noun(requestedPeriods)}; daarom noemt dit antwoord geen ontwikkeling voor die regio.`,
    );
  }
  if (coverage.excluded.length > 0) {
    // Said out loud because the user NAMED this region: it is absent from the
    // answer entirely, and the reason is ours (no rows), not a CBS judgement.
    const names = coverage.excluded.map((code) => regionMemberName(code, result)).join(', ');
    parts.push(
      `Over ${names} zegt dit antwoord niets: in onze database ontbreken cijfers voor een of meer van de ` +
        `gevraagde ${noun(requestedPeriods)}.`,
    );
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

/** #39: a registry alternate label, cleaned for display. The curated labels
 * double as intent-parser prompt notes and some carry a registry-internal
 * cross-reference ("eigen key: gdp_growth_yoy_volume", "key
 * average_existing_home_sale_price") that means nothing to a reader. This
 * strips exactly that cross-reference — a deterministic REMOVAL, never a
 * rewording (principle a: code may drop internal notation, it may not invent
 * words) — and tidies the separators the removal leaves behind. */
export function displayAlternateLabel(label: string): string {
  return (
    label
      // the internal cross-reference: "eigen key: x_y" / "key x_y" — an
      // underscore_key never occurs in real Dutch copy, so this can only
      // match the registry's own notation.
      .replace(/(?:eigen\s+)?key:?\s+[a-z0-9]+(?:_[a-z0-9]+)+/gi, '')
      // an emptied parenthetical: "(  )" / "(; )" / "(: )"
      .replace(/\(\s*[;,:]?\s*\)/g, '')
      // a dangling separator left before a closing paren: "(de headline; )"
      .replace(/\s*[;,:]+\s*\)/g, ')')
      // a colon that now introduces nothing but a parenthetical:
      // "lezing:  (85773NED)" → "lezing (85773NED)"
      .replace(/:\s+\(/g, ' (')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .replace(/[;,:]+$/, '')
      .trim()
  );
}

/** #39 (owner policy, 2026-07-04): when the answer used a canonical default
 * that has registry-recorded alternate readings, SAY that those readings
 * exist — never silently pick a definition. Like buildDefinitionLine and
 * buildAssumptionLine above, this is the SINGLE source of truth: compose.ts
 * builds the line with it and audit/reconstruct.ts re-derives it
 * byte-identically from the stored result (R8). It is deterministic code over
 * validated Attribution data, sits OUTSIDE the LLM-scanned body (R1's
 * structural exemption), and carries no data value — it names readings, not
 * numbers. `?? null` (A1, docs/13): rows stored before #39 and answers whose
 * default has no alternates serialize no key at all. */
export function buildAlternatesLine(result: ValidatedResult): string | null {
  const alternates = result.attribution.alternates ?? null;
  if (alternates === null || alternates.length === 0) return null;
  const labels = alternates
    .map((a) => displayAlternateLabel(a.label))
    .filter((label) => label.length > 0);
  if (labels.length === 0) return null;
  return labels.length === 1
    ? `Er is ook een andere lezing beschikbaar: ${labels[0]}.`
    : `Er zijn ook andere lezingen beschikbaar: ${labels.join('; ')}.`;
}

/** WP30c D7(a): the native Eurostat dataset code, stripped of the
 * `'eurostat:'` identity prefix (D4) — only ever called once the caller has
 * already confirmed `source === EUROSTAT_SOURCE_KEY`, so a colon is always
 * present. Mirrors registry.ts's own (private) `nativeIdFrom`, kept local
 * here since that module is a pure leaf with no exports beyond the lookup
 * functions themselves (see its header comment). */
function eurostatDatasetCode(tableId: string): string {
  const colon = tableId.indexOf(':');
  return colon >= 0 ? tableId.slice(colon + 1) : tableId;
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
  const syncedAt = a.syncedAt.slice(0, 10);
  // WP30c D7(a) (ADR 048): a Eurostat-sourced answer renders its own
  // dataset-shaped sentence (the literal ADR 048 D7(a) template — no
  // "Periode:" clause, unlike CBS's) instead of the CBS-shaped one below,
  // for every row whose source genuinely resolves to eurostat — determined
  // exactly once, via resolveSource (A1's absent→'cbs' fallback keeps every
  // pre-Eurostat stored envelope on the CBS branch, byte-identical). The
  // "(DOI ...)" clause is itself conditional on `doi` being present: never
  // throw on a missing DOI — a Eurostat row whose DOI wasn't captured still
  // renders the Eurostat sentence, just without that clause (R8-safe,
  // matching the ADR's own "an absent DOI renders no DOI clause").
  if (resolveSource(a.source).key === EUROSTAT_SOURCE_KEY) {
    const doiClause = a.doi ? ` (DOI ${a.doi})` : '';
    return (
      `Bron: Eurostat, dataset ${eurostatDatasetCode(a.tableId)} — ${a.tableTitle}${doiClause}. ` +
      `Gegevens gesynchroniseerd op ${syncedAt}. Licentie: ${a.license}.`
    );
  }
  // WP30a (ADR 030 D3): the label comes from the source registry; absent
  // source (every pre-WP30a stored row) resolves to 'cbs' (A1) — the line is
  // byte-identical to the pre-WP30a literal. The license stays the STORED
  // field: old rows re-derive from their own bytes, never from live config.
  return (
    `Bron: ${resolveSource(a.source).attributionLabel}, tabel ${a.tableId} — ${a.tableTitle}. ` +
    `Gegevens gesynchroniseerd op ${syncedAt}. Periode: ${period}. Licentie: ${a.license}.`
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
