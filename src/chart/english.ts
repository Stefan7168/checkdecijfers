// ADR 058 phase 3 (#332), Task 1: `toEnglishChartSpec` — a DISPLAY COPY of a
// stored (Dutch) ChartSpec for an English-interface reader. Pure, DB-free,
// deterministic: every translated field comes from an existing, already-
// reviewed name table (`src/registry/english-names.ts`,
// `src/answer/respond/english-measure-labels.ts`) or a hand-mapped sibling of
// a deterministic Dutch TEMPLATE this module owns and documents below —
// NEVER a model call, NEVER a guess (principles a/c). Anything with no
// deterministic English equivalent — an unseeded name, a curated annotation
// label, an unparseable template shape — stays byte-identical Dutch, the
// same never-guess contract every converter in english-names.ts already
// follows.
//
// Returns a brand NEW ChartSpec; the input is never mutated (every nested
// object/array below is freshly built, never a shared reference into
// `spec`). The stored spec itself (audit rows, embeds, exports, the Dutch
// site) is untouched by this module — English is produced only at render
// time by whichever caller decides the reader's interface language (web
// wiring: Task 2, out of this task's scope).
//
// SINGLE-APPLICATION CONTRACT — read before calling this twice: most of the
// name-table lookups here are naturally idempotent (an already-English
// string simply fails to match the Dutch-keyed table and passes through
// unchanged), but `points[].formattedValue` is NOT — it swaps '.' and ','
// (toEnglishNumberToken), and swapping twice silently flips the number's
// notation back to looking Dutch while the rest of the spec stays English,
// a genuinely corrupt mixed state. Call this exactly once, on the ORIGINAL
// stored (Dutch) spec, at render time — never on a spec this function (or
// anything already holding its output) has already produced. No separate
// "isEnglish" marker field is added (that would be a ChartSpec schema
// change, out of scope for a display-only layer) — the contract is
// enforced by discipline + this comment, per the task brief's own
// preference ("prefer making the function safe to call once at render").
import { CANONICAL_MEASURES } from '../registry/defaults.ts';
import {
  translateAttributionLine,
  translateDimLabel,
  translateMeasureTitle,
  translatePeriodLabel,
  translateTableTitle,
  translateUnit,
} from '../registry/english-names.ts';
import { ENGLISH_MEASURE_LABELS } from '../answer/respond/english-measure-labels.ts';
import { regionLabelEn } from '../answer/respond/english.ts';
import { toEnglishNumberToken } from '../answer/translate/mask.ts';
import { PROVISIONAL_NOTE } from './build.ts';
import type { ChartAnnotation, ChartPoint, ChartSeries, ChartSpec } from './types.ts';

/** English sibling of `PROVISIONAL_NOTE` (build.ts) — `provisionalNote` is
 * ALWAYS either exactly that one Dutch constant or `null` (never any other
 * string; build.ts sets it as `anyProvisional ? PROVISIONAL_NOTE : null`),
 * so a straight equality check is the correct match, no regex needed. */
export const PROVISIONAL_NOTE_EN = 'Provisional figures are marked with *.' as const;

// ---------------------------------------------------------------------------
// definitionLine — 'Definitie: X.' -> 'Definition: <English measure label>.'
// ---------------------------------------------------------------------------

/** Reverse lookup: the Dutch `definitionLabel` text (exactly what
 * build.ts's `definitionLine` embeds) -> its canonical key, so the English
 * side can be read off `ENGLISH_MEASURE_LABELS` (english-measure-labels.ts)
 * instead of machine-translating the Dutch phrase. A `definitionLabel` not
 * registered on any CANONICAL_MEASURES entry (a test fixture's made-up
 * string, or a future on-demand-onboarded measure with no canonical key at
 * all) has no reverse entry and falls through to "keep the Dutch line". */
const DEFINITION_LABEL_TO_KEY: Readonly<Record<string, string>> = Object.fromEntries(
  CANONICAL_MEASURES.map((m) => [m.definitionLabel, m.key] as const),
);

const DEFINITION_LINE_RE = /^Definitie: (.+)\.$/;

function translateDefinitionLine(line: string): string {
  const match = DEFINITION_LINE_RE.exec(line);
  if (!match) return line;
  const definitionLabel = match[1]!;
  const key = DEFINITION_LABEL_TO_KEY[definitionLabel];
  if (!key) return line;
  const english = ENGLISH_MEASURE_LABELS[key];
  if (!english) return line;
  return `Definition: ${english.charAt(0).toUpperCase()}${english.slice(1)}.`;
}

// ---------------------------------------------------------------------------
// nullNotes — English sibling of build.ts's nullNote() template
// ---------------------------------------------------------------------------
//
// nullNote()'s one shape (build.ts): `Geen waarde voor ${where}: ${cell.
// valueAttribute} (${sourceName}).`, where `where` is `${periodLabel}
// (${regionLabel})` on a multi-region chart or plain `${periodLabel}`
// otherwise. The ChartSpec keeps `valueAttribute` byte-identical (a raw CBS
// marker, never translated — same contract as ChartPoint.valueAttribute
// itself) and the source's `displayName` is already language-neutral
// ('CBS', 'Eurostat'), so this maps ONLY the two skeleton words plus
// `periodLabel`/`regionLabel`, straight off the exact Dutch template shape
// (the ChartSpec has no structured per-null-cell record to rebuild this
// from instead — nullNotes are pre-rendered strings, and reconstructing them
// from spec.series would silently reorder them relative to the ORIGINAL
// result.cells order nullNote() itself iterates, which this string-level
// map avoids entirely by construction).
const NULL_NOTE_RE = /^Geen waarde voor (.+): ([^()]+) \(([^()]*)\)\.$/;
/** Splits `where` into `period (region)` lazily — lazy so it stops at the
 * FIRST " (" (the period/region boundary) even when the region label itself
 * carries its own qualifier parenthetical ("Utrecht (gemeente)"), which
 * would otherwise make the split ambiguous. */
const WHERE_REGION_RE = /^(.+?) \((.+)\)$/;

function translateNullNote(note: string): string {
  const match = NULL_NOTE_RE.exec(note);
  if (!match) return note;
  const [, where, valueAttribute, sourceName] = match as unknown as [string, string, string, string];
  const regionMatch = WHERE_REGION_RE.exec(where);
  const whereEn = regionMatch
    ? `${translatePeriodLabel(regionMatch[1]!)} (${regionLabelEn(regionMatch[2]!)})`
    : translatePeriodLabel(where);
  return `No value for ${whereEn}: ${valueAttribute} (${sourceName}).`;
}

// ---------------------------------------------------------------------------
// attribution.trendHeadline — English sibling of renderTrendHeadline's
// templates (src/answer/compose/template.ts)
// ---------------------------------------------------------------------------
//
// The one shape renderTrendHeadline produces: `${subjectSentenceStart}
// ${verb}${steadily} sinds ${first.periodLabel}.` where `subject` is
// `result.attribution.definitionLabel ?? cells[0].measureTitle`,
// capitalized. The ChartSpec does not record WHICH of those two produced
// this exact string, so the subject is translated best-effort (try the
// definitionLabel->key->ENGLISH_MEASURE_LABELS path first, then an exact
// measureTitle match) and left in Dutch, unguessed, when neither matches —
// the same partial-translation discipline translateAttributionLine already
// applies to its own embedded variable text.
const TREND_HEADLINE_RE = /^(.+?) (steeg|daalde|bleef stabiel)( gestaag)? sinds (.+)\.$/;

const TREND_VERB_EN: Readonly<Record<string, string>> = {
  steeg: 'has risen',
  daalde: 'has fallen',
  'bleef stabiel': 'has stayed stable',
};

function translateTrendSubject(subject: string): string {
  const lower = subject.charAt(0).toLowerCase() + subject.slice(1);
  const key = DEFINITION_LABEL_TO_KEY[lower];
  if (key) {
    const english = ENGLISH_MEASURE_LABELS[key];
    if (english) return `${english.charAt(0).toUpperCase()}${english.slice(1)}`;
  }
  const viaMeasureTitle = translateMeasureTitle(subject);
  if (viaMeasureTitle !== subject) return viaMeasureTitle;
  return subject;
}

function translateTrendHeadline(headline: string): string {
  const match = TREND_HEADLINE_RE.exec(headline);
  if (!match) return headline;
  const [, subject, verb, steadily, period] = match as unknown as [
    string,
    string,
    string,
    string | undefined,
    string,
  ];
  const subjectEn = translateTrendSubject(subject);
  const verbEn = TREND_VERB_EN[verb]!;
  const steadilyEn = steadily ? ' steadily' : '';
  const periodEn = translatePeriodLabel(period);
  return `${subjectEn} ${verbEn}${steadilyEn} since ${periodEn}.`;
}

// ---------------------------------------------------------------------------
// series[].label — build.ts sets this to `cell.regionLabel ?? cell.
// measureTitle`: a real region name when `regionCode` is set, else the
// SAME measure-title text as the chart's own `title` field (never a
// dimLabel — a national/comparison chart's single "series" is the measure
// itself, not one of its dims). Translated accordingly, not via
// translateDimLabel.
// ---------------------------------------------------------------------------

function translateSeriesLabel(series: ChartSeries): string {
  return series.regionCode !== null ? regionLabelEn(series.label) : translateMeasureTitle(series.label);
}

function translatePoint(point: ChartPoint): ChartPoint {
  return {
    ...point,
    periodLabel: translatePeriodLabel(point.periodLabel),
    formattedValue: point.formattedValue === null ? null : toEnglishNumberToken(point.formattedValue),
  };
}

function translateSeries(series: ChartSeries): ChartSeries {
  return {
    ...series,
    label: translateSeriesLabel(series),
    points: series.points.map(translatePoint),
  };
}

function translateAnnotation(annotation: ChartAnnotation): ChartAnnotation {
  // #170(4): CHART_ANNOTATIONS (annotations.ts) are small, hand-curated
  // Dutch sentences ("Financiële crisis: val Lehman Brothers (september
  // 2008)") with no English sibling table today — a free-form curated
  // string, not a parseable template, so there is nothing deterministic to
  // translate here yet (never guess). Copied (never the original reference)
  // so the returned spec never aliases the input's nested objects.
  return { ...annotation };
}

/** Produces an English DISPLAY COPY of `spec` — see the module header for
 * the full contract (pure, DB-free, single-application). Every id, code,
 * numeric value, status and structural field is carried over byte-identical;
 * only reader-visible text and number NOTATION (not value) change, and only
 * where a deterministic English form exists. */
/** Specs this module produced (#332 review): applying the function to its own
 * output returns it unchanged, so an accidental second call at render can never
 * flip the number notation back (the notation swap alone is not idempotent). */
const PRODUCED = new WeakSet<ChartSpec>();

export function toEnglishChartSpec(spec: ChartSpec): ChartSpec {
  if (PRODUCED.has(spec)) return spec;
  const dimLabels = Object.fromEntries(
    Object.entries(spec.dimLabels).map(([k, v]) => [k, translateDimLabel(v)]),
  );

  const result: ChartSpec = {
    schemaVersion: spec.schemaVersion,
    kind: spec.kind,
    title: translateMeasureTitle(spec.title),
    dims: { ...spec.dims },
    dimLabels,
    unit: translateUnit(spec.unit),
    series: spec.series.map(translateSeries),
    provisionalNote: spec.provisionalNote === PROVISIONAL_NOTE ? PROVISIONAL_NOTE_EN : spec.provisionalNote,
    nullNotes: spec.nullNotes.map(translateNullNote),
    definitionLine: spec.definitionLine === null ? null : translateDefinitionLine(spec.definitionLine),
    attributionLine: translateAttributionLine(spec.attributionLine),
    attribution: {
      tableId: spec.attribution.tableId,
      tableTitle: translateTableTitle(spec.attribution.tableTitle),
      tableVersion: spec.attribution.tableVersion,
      syncedAt: spec.attribution.syncedAt,
      coveredPeriods: { ...spec.attribution.coveredPeriods },
      license: spec.attribution.license,
      ...(spec.attribution.trendHeadline !== undefined
        ? { trendHeadline: translateTrendHeadline(spec.attribution.trendHeadline) }
        : {}),
    },
  };
  if ('annotations' in spec && spec.annotations !== undefined) {
    result.annotations = spec.annotations.map(translateAnnotation);
  }
  if ('regionScope' in spec) {
    // RegionScope is a small, plain JSON value ({kind, parent?} or null) —
    // structuredClone is enough to guarantee no shared reference with the
    // input, and it is carried over IDENTICAL (provenance, never translated).
    result.regionScope = spec.regionScope === null ? null : structuredClone(spec.regionScope);
  }
  PRODUCED.add(result);
  return result;
}
