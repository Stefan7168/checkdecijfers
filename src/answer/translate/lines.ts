// ADR 058 (English answers, Task 5): the hand-written English structural
// lines and staleness warning. None of these words are model output — every
// function below is pure over a ValidatedResult (plus, for the two lines
// that need model-translated prose, the already-translated text/labels a
// caller obtained elsewhere), mirroring the Dutch builder it corresponds to
// in src/answer/compose/format.ts exactly in structure, null-ness and
// ordering (principle a: translate the words, never re-decide the shape).
//
// Every digit that can appear in one of these lines comes from a COUNT, a
// CBS region/dataset code, or a date already fixed in ISO/CBS form — never a
// data value — so `String(n)` and verbatim code/date strings are used
// throughout; nothing here needs toEnglishNumberToken's notation swap.
import type {
  PeriodGrain,
  RegionScope,
  ValidatedResult,
} from '../../query/index.ts';
import { isDerivedResult } from '../../query/index.ts';
import { EUROSTAT_SOURCE_KEY, resolveSource } from '../../sources/registry.ts';
import { baseRegionLabel, buildDefinitionLine, displayAlternateLabel } from '../compose/format.ts';
import { translatePeriodLabel, translateRegion, translateTableTitle } from '../../registry/english-names.ts';

export interface EnglishLines {
  assumptionLine: string | null;
  regionSetLine: string | null;
  regionSeriesLine: string | null;
  definitionLine: string | null;
  alternatesLine: string | null;
  markingLine: string | null;
  attributionLine: string;
}

// ---------------------------------------------------------------------------
// The Dutch content a caller must translate BEFORE calling buildEnglishLines
// ---------------------------------------------------------------------------

/** The text a caller must have translated for `definitionLine`: `buildDefinitionLine`'s
 * own content, with its `'Definitie: '` prefix and terminal period removed —
 * the SAME null-ness as `buildDefinitionLine` (a circular or absent
 * definition translates to nothing, not an empty sentence). */
export function dutchDefinitionContent(result: ValidatedResult): string | null {
  const line = buildDefinitionLine(result);
  if (line === null) return null;
  const withoutPrefix = line.startsWith('Definitie: ') ? line.slice('Definitie: '.length) : line;
  return withoutPrefix.endsWith('.') ? withoutPrefix.slice(0, -1) : withoutPrefix;
}

/** The labels a caller must have translated for `alternatesLine`: the exact
 * list `buildAlternatesLine` would join (same cleanup + non-empty filter),
 * before any English wording is applied. */
export function dutchAlternateLabels(result: ValidatedResult): string[] {
  const alternates = result.attribution.alternates ?? null;
  if (alternates === null || alternates.length === 0) return [];
  return alternates.map((a) => displayAlternateLabel(a.label)).filter((label) => label.length > 0);
}

// ---------------------------------------------------------------------------
// assumptionLine — mirrors buildAssumptionLine
// ---------------------------------------------------------------------------

function buildAssumptionLineEn(result: ValidatedResult): string | null {
  const parts: string[] = [];
  if (result.regionDefaulted ?? false) {
    parts.push(
      'This is the national figure for the Netherlands as a whole. ' +
        'Name a municipality or province in your question if you want a specific region.',
    );
  }
  if (result.periodDefaulted ?? false) {
    const last = result.cells[result.cells.length - 1];
    const until = last === undefined ? null : last.periodLabel;
    parts.push(
      until === null
        ? 'This is the recent development.'
        : `This is the development over recent years, up to ${translatePeriodLabel(until)}.`,
    );
    parts.push('Feel free to ask for only the latest figure or for a different period.');
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

// ---------------------------------------------------------------------------
// regionSetLine — mirrors buildRegionSetLine
// ---------------------------------------------------------------------------

const REGION_SET_NOUNS_EN: Record<RegionScope['kind'], readonly [string, string]> = {
  all_provincies: ['province', 'provinces'],
  all_landsdelen: ['region', 'regions'],
  all_gemeenten: ['municipality', 'municipalities'],
  gemeenten_in_provincie: ['municipality', 'municipalities'],
};

function regionSetNounEn(scope: RegionScope, count: number): string {
  const [singular, plural] = REGION_SET_NOUNS_EN[scope.kind];
  return count === 1 ? singular : plural;
}

/** Mirrors format.ts's private REGION_SET_NAMED_LIMIT — reimplemented rather
 * than exported (task brief: prefer a local English variant over touching
 * Dutch code). */
const REGION_SET_NAMED_LIMIT = 5;

/** Mirrors format.ts's private regionMemberName, translating the display name
 * through translateRegion when the member has a served cell to name it from —
 * an excluded member (no cell) is named by its bare CBS region code, same as
 * the Dutch line. */
function regionMemberNameEn(code: string, result: ValidatedResult): string {
  const cell = result.cells.find((c) => c.regionCode === code);
  return cell?.regionLabel ? translateRegion(baseRegionLabel(cell.regionLabel)) : code;
}

function namedSuffixEn(codes: string[], result: ValidatedResult): string {
  if (codes.length > REGION_SET_NAMED_LIMIT) return '';
  return ` (${codes.map((code) => regionMemberNameEn(code, result)).join(', ')})`;
}

function buildRegionSetLineEn(result: ValidatedResult): string | null {
  const coverage = result.regionSet ?? null;
  if (coverage === null) return null;
  const scope = coverage.scope;
  const noun = (n: number): string => regionSetNounEn(scope, n);
  const applicable = result.cells.filter((c) => c.value !== null).length;

  const parts: string[] = [
    applicable === coverage.rosterSize
      ? `Coverage: all ${coverage.rosterSize} ${noun(coverage.rosterSize)} in this table have a figure.`
      : `Coverage: ${applicable} of the ${coverage.rosterSize} ${noun(coverage.rosterSize)} have a figure.`,
  ];

  if (coverage.notApplicable.length > 0) {
    const n = coverage.notApplicable.length;
    parts.push(
      `${n} ${noun(n)} did not exist in this period according to CBS${namedSuffixEn(coverage.notApplicable, result)}.`,
    );
  }
  if (coverage.withheld.length > 0) {
    const n = coverage.withheld.length;
    parts.push(`CBS publishes no value for ${n} ${noun(n)}${namedSuffixEn(coverage.withheld, result)}.`);
  }
  if (coverage.missing.length > 0) {
    const n = coverage.missing.length;
    parts.push(
      `We have no figure in our database for ${n} ${noun(n)}${namedSuffixEn(coverage.missing, result)}.`,
    );
  }
  if (!coverage.complete) {
    parts.push('That is why this answer gives no ranking.');
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// regionSeriesLine — mirrors buildRegionSeriesLine
// ---------------------------------------------------------------------------

const PERIOD_GRAIN_NOUNS_EN: Record<PeriodGrain, readonly [string, string]> = {
  JJ: ['year', 'years'],
  KW: ['quarter', 'quarters'],
  MM: ['month', 'months'],
};

function buildRegionSeriesLineEn(result: ValidatedResult): string | null {
  const coverage = result.regionSeries ?? null;
  if (coverage === null) return null;
  if (coverage.complete) return null;
  const requestedPeriods = new Set(result.cells.map((c) => c.periodCode)).size;
  const [singular, plural] = PERIOD_GRAIN_NOUNS_EN[result.cells[0]?.grain ?? 'JJ'];
  const noun = (n: number): string => (n === 1 ? singular : plural);
  const parts: string[] = [];
  for (const code of coverage.partial) {
    const missing = result.cells.filter((c) => c.regionCode === code && c.value === null).length;
    parts.push(
      `For ${regionMemberNameEn(code, result)} a figure is missing in ${missing} of the ${requestedPeriods} ` +
        `requested ${noun(requestedPeriods)}; that is why this answer gives no development for that region.`,
    );
  }
  if (coverage.excluded.length > 0) {
    const names = coverage.excluded.map((code) => regionMemberNameEn(code, result)).join(', ');
    parts.push(
      `This answer says nothing about ${names}: our database lacks figures for one or more of the ` +
        `requested ${noun(requestedPeriods)}.`,
    );
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

// ---------------------------------------------------------------------------
// definitionLine / alternatesLine — mirror buildDefinitionLine / buildAlternatesLine
// ---------------------------------------------------------------------------

/** Ensures a translated definition reads as a sentence, exactly like
 * format.ts's private withTerminalPunctuation — reimplemented locally
 * (English side, never touches the Dutch original text). */
function withTerminalPunctuationEn(text: string): string {
  return /[.?!]$/.test(text) ? text : `${text}.`;
}

function buildDefinitionLineEn(translatedDefinition: string | null): string | null {
  return translatedDefinition === null ? null : `Definition: ${withTerminalPunctuationEn(translatedDefinition)}`;
}

function buildAlternatesLineEn(translatedAlternates: string[]): string | null {
  if (translatedAlternates.length === 0) return null;
  return translatedAlternates.length === 1
    ? `Another reading is also available: ${translatedAlternates[0]}.`
    : `Other readings are also available: ${translatedAlternates.join('; ')}.`;
}

// ---------------------------------------------------------------------------
// markingLine — mirrors compose.ts's `— ${DERIVED_DATA_MARKING}`
// ---------------------------------------------------------------------------

// A hand-written English translation of DERIVED_DATA_MARKING
// (src/query/types.ts) — a fixed literal, never a runtime transform of the
// Dutch string (principle a).
const DERIVED_DATA_MARKING_EN = 'adaptation of CBS data by checkdecijfers.nl';

// ---------------------------------------------------------------------------
// attributionLine — mirrors buildAttributionLine
// ---------------------------------------------------------------------------

/** Mirrors format.ts's private eurostatDatasetCode. */
function eurostatDatasetCode(tableId: string): string {
  const colon = tableId.indexOf(':');
  return colon >= 0 ? tableId.slice(colon + 1) : tableId;
}

function buildAttributionLineEn(result: ValidatedResult): string {
  const a = result.attribution;
  const syncedAt = a.syncedAt.slice(0, 10);
  if (resolveSource(a.source).key === EUROSTAT_SOURCE_KEY) {
    // Eurostat's own tableTitle is already English (ADR 048) — never run
    // through translateTableTitle, exactly like the Dutch Eurostat branch
    // never runs it through any Dutch rewording either.
    const doiClause = a.doi ? ` (DOI ${a.doi})` : '';
    return (
      `Source: Eurostat, dataset ${eurostatDatasetCode(a.tableId)} — ${a.tableTitle}${doiClause}. ` +
      `Data synced on ${syncedAt}. License: ${a.license}.`
    );
  }
  const labelByCode = new Map(result.cells.map((c) => [c.periodCode, c.periodLabel]));
  const fromLabel = labelByCode.get(a.coveredPeriods.from) ?? a.coveredPeriods.from;
  const toLabel = labelByCode.get(a.coveredPeriods.to) ?? a.coveredPeriods.to;
  const from = translatePeriodLabel(fromLabel);
  const to = translatePeriodLabel(toLabel);
  const period = from === to ? from : `${from} to ${to}`;
  return (
    `Source: ${resolveSource(a.source).attributionLabel}, table ${a.tableId} — ${translateTableTitle(a.tableTitle)}. ` +
    `Data synced on ${syncedAt}. Period: ${period}. License: ${a.license}.`
  );
}

// ---------------------------------------------------------------------------
// buildEnglishLines / assembleEnglishText
// ---------------------------------------------------------------------------

/** Every fixed-wording English structural line, built from the validated
 * result plus the two pieces of already-translated prose (definition,
 * alternate labels) a caller obtains from the translating model via
 * `dutchDefinitionContent`/`dutchAlternateLabels`. Pure over its arguments —
 * no model call, no I/O. */
export function buildEnglishLines(
  result: ValidatedResult,
  translated: { definition: string | null; alternates: string[] },
): EnglishLines {
  return {
    assumptionLine: buildAssumptionLineEn(result),
    regionSetLine: buildRegionSetLineEn(result),
    regionSeriesLine: buildRegionSeriesLineEn(result),
    definitionLine: buildDefinitionLineEn(translated.definition),
    alternatesLine: buildAlternatesLineEn(translated.alternates),
    markingLine: isDerivedResult(result) ? `— ${DERIVED_DATA_MARKING_EN}` : null,
    attributionLine: buildAttributionLineEn(result),
  };
}

/** The English answer text: the same line order as compose.ts's `assemble()`
 * (body, blank line, assumption, regionSet, regionSeries, definition,
 * alternates, marking, attribution), then the staleness warning after a
 * blank line when present — mirroring respond.ts's own
 * `answer.text + '\n\n' + stalenessWarning` join. */
export function assembleEnglishText(body: string, lines: EnglishLines, stalenessWarning: string | null): string {
  const text = [
    body,
    '',
    ...(lines.assumptionLine ? [lines.assumptionLine] : []),
    ...(lines.regionSetLine ? [lines.regionSetLine] : []),
    ...(lines.regionSeriesLine ? [lines.regionSeriesLine] : []),
    ...(lines.definitionLine ? [lines.definitionLine] : []),
    ...(lines.alternatesLine ? [lines.alternatesLine] : []),
    ...(lines.markingLine ? [lines.markingLine] : []),
    lines.attributionLine,
  ].join('\n');
  return stalenessWarning !== null ? `${text}\n\n${stalenessWarning}` : text;
}

// ---------------------------------------------------------------------------
// translateStalenessWarning — mirrors src/answer/respond/staleness.ts
// ---------------------------------------------------------------------------

/** Inverse of staleness.ts's private cadenceWordsNl, for the three cadence
 * prefixes maxAgeDaysForCadence recognizes ('monthly'/'quarterly'/'yearly',
 * the registry's own English cadence text) — an unrecognized Dutch cadence
 * word (a shape checkStaleness itself never produces, but this function is
 * defensive per the task brief) makes the whole warning untranslatable. */
const CADENCE_EN: Record<string, string> = {
  maandelijks: 'monthly',
  'per kwartaal': 'quarterly',
  jaarlijks: 'yearly',
};

const STALENESS_PLAIN_RE =
  /^Let op: deze tabel wordt normaal (.+?) bijgewerkt door CBS, maar onze laatste synchronisatie was op (\d{4}-\d{2}-\d{2}) — recentere cijfers kunnen inmiddels beschikbaar zijn\.$/;
const STALENESS_RETAINED_RE =
  /^Let op: deze tabel wordt normaal (.+?) bijgewerkt door CBS, maar een deel van deze cijfers is door CBS sinds (\d{4}-\d{2}-\d{2}) niet opnieuw bevestigd — recentere cijfers kunnen inmiddels beschikbaar zijn\.$/;

/** Translates a `StalenessCheck.warning` string built by
 * src/answer/respond/staleness.ts's `checkStaleness`. Null when `dutch`
 * doesn't match either of the two known shapes, or names a cadence word
 * `CADENCE_EN` has no entry for — never a guess (principle c). */
export function translateStalenessWarning(dutch: string): string | null {
  const plain = STALENESS_PLAIN_RE.exec(dutch);
  if (plain) {
    const cadenceEn = CADENCE_EN[plain[1]!];
    if (cadenceEn === undefined) return null;
    return (
      `Note: CBS normally updates this table ${cadenceEn}, but our last sync was on ${plain[2]} — ` +
      `more recent figures may now be available.`
    );
  }
  const retained = STALENESS_RETAINED_RE.exec(dutch);
  if (retained) {
    const cadenceEn = CADENCE_EN[retained[1]!];
    if (cadenceEn === undefined) return null;
    return (
      `Note: CBS normally updates this table ${cadenceEn}, but part of these figures has not been reconfirmed ` +
      `by CBS since ${retained[2]} — more recent figures may now be available.`
    );
  }
  return null;
}
