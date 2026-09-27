// #296 part 2 Task 6: the English mirrors of src/chart/scatter-text.ts's
// Dutch scatter texts, for an English-interface reader. Same contract as
// every English display layer (src/chart/english.ts, src/answer/translate/
// lines.ts): pure, deterministic, NO model call — the stored spec stays
// Dutch and English is derived here at render time. Every name goes through
// the shared, hand-checked name tables (cbs-words.ts / regionLabelEn). A
// MEASURE never stays Dutch (see measureEn: the hand-written English label
// for the leg's canonical key, else generic English wording); an unseeded
// region name or unit does stay Dutch rather than being guessed at
// (principle c) — a proper name reads the same in both languages.
//
// Same structure as the Dutch builders, clause for clause: the body carries
// no data value and no causal or superlative claim (R9); every count lives in
// the structural coverage line; every left-out region is named with each
// side's reason (R11) up to the same SCATTER_NAMED_LIMIT, the rest counted.
//
// The withheld reason is the SAME generic wording the English region-set
// line already uses ("CBS publishes no value", src/answer/translate/
// lines.ts) — there is no English sibling of the source registry's per-marker
// `nullReasonLabels` table, so the specific Dutch marker text is not guessed
// at; the source's own display name keeps a Eurostat axis honest.
import type { ScatterAxis, ScatterLeftOut, ScatterSideStatus, ScatterSpec } from '../backend/chart/index.ts';
import { SCATTER_NAMED_LIMIT } from '../backend/chart/index.ts';
import { lowerFirst } from '../backend/chart/scatter-text.ts';
import { englishMeasureLabel, regionLabelEn } from '../backend/answer/respond/english.ts';
import { ENGLISH_MEASURE_LABELS, ENGLISH_TOPIC_TERMS } from '../backend/answer/respond/english-measure-labels.ts';
import { hasEnglishName } from '../backend/registry/english-names.ts';
import type { RegionScope } from '../backend/query/types.ts';
import { resolveSourceForTable } from '../backend/sources/registry.ts';
import { translateStalenessWarning } from '../backend/answer/translate/staleness-en.ts';
import { translateMeasureTitle, translatePeriodLabel, translateUnit } from './i18n/cbs-words.ts';
import { t, type Lang } from './i18n/messages.ts';

/** Mirrors lines.ts's private REGION_SET_NOUNS_EN (itself the English of
 * format.ts's REGION_SET_NOUNS) — reimplemented rather than exported, the
 * same local-variant choice lines.ts made for its own Dutch counterpart. */
const REGION_SET_NOUNS_EN: Record<RegionScope['kind'], readonly [string, string]> = {
  all_provincies: ['province', 'provinces'],
  all_landsdelen: ['region', 'regions'],
  all_gemeenten: ['municipality', 'municipalities'],
  gemeenten_in_provincie: ['municipality', 'municipalities'],
};

function nounEn(scope: RegionScope, count: number): string {
  const [singular, plural] = REGION_SET_NOUNS_EN[scope.kind];
  return count === 1 ? singular : plural;
}

function capitalise(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

/** lowerFirst for a name joined mid-sentence — except an acronym-led name
 * ("GDP growth"), whose capitals are part of the word. */
function midSentence(text: string): string {
  return /^[A-Z]{2}/.test(text) ? text : lowerFirst(text);
}

/** The English name of an axis's measure, sentence-start cased — NEVER the
 * Dutch CBS title (fix round 1: a title with no English entry used to leak
 * Dutch into English text). In order: CBS's own English title when the name
 * tables have one; else the hand-written English topic term for the leg's
 * canonical key; else the codebase's generic English wording
 * (englishMeasureLabel's 'these figures'). */
export function measureEn(axis: ScatterAxis): string {
  if (hasEnglishName('measure', axis.measureTitle)) return translateMeasureTitle(axis.measureTitle);
  const topic = axis.canonicalKey === null ? undefined : ENGLISH_TOPIC_TERMS[axis.canonicalKey];
  if (topic !== undefined) return capitalise(topic);
  return capitalise(englishMeasureLabel(axis.canonicalKey ?? ''));
}

/** The English sibling of `sideReason` (scatter-text.ts). Exported for the
 * scatter CSV's "Not shown" block (scatter-csv.ts). */
export function sideReasonEn(side: ScatterSideStatus, axis: ScatterAxis): string | null {
  switch (side.state) {
    case 'withheld':
      return `${resolveSourceForTable(axis.tableId).displayName} publishes no value`;
    case 'missing':
      return 'not in our database';
    case 'not_applicable':
      return 'did not exist according to CBS';
    case 'value':
      return null;
  }
}

function namedLeftOutEn(item: ScatterLeftOut, spec: ScatterSpec): string {
  const reasons: string[] = [];
  const yReason = sideReasonEn(item.y, spec.y);
  if (yReason !== null) reasons.push(`${midSentence(measureEn(spec.y))}: ${yReason}`);
  const xReason = sideReasonEn(item.x, spec.x);
  if (xReason !== null) reasons.push(`${midSentence(measureEn(spec.x))}: ${xReason}`);
  return `${regionLabelEn(item.label)} (${reasons.join('; ')})`;
}

/** English of the stored Dutch `spec.title` (`{Y} tegenover {x}, {period}`,
 * scatter.ts) — rebuilt from the spec's own fields, never by parsing the
 * Dutch sentence. */
export function scatterTitleEn(spec: ScatterSpec): string {
  return `${measureEn(spec.y)} against ${midSentence(measureEn(spec.x))}, ${translatePeriodLabel(spec.y.periodLabel)}`;
}

/** English of `scatterBodyNl`. */
export function scatterBodyEn(spec: ScatterSpec): string {
  const noun = nounEn(spec.scope, 1);
  return (
    `${measureEn(spec.y)} against ${midSentence(measureEn(spec.x))} per ${noun}, ${translatePeriodLabel(spec.y.periodLabel)}. ` +
    `Each dot is one ${noun}. The chart shows how the two figures occur together, ` +
    'not that one causes the other.'
  );
}

/** English of `scatterLineNl`. */
export function scatterLineEn(spec: ScatterSpec): string {
  const noun = (n: number): string => nounEn(spec.scope, n);
  const plotted = spec.points.length;
  const left = spec.leftOut.length;

  const coverage =
    left === 0
      ? `all ${plotted} ${noun(plotted)} have both figures.`
      : (() => {
          const named = spec.leftOut
            .slice(0, SCATTER_NAMED_LIMIT)
            .map((item) => namedLeftOutEn(item, spec))
            .join(', ');
          const rest = left > SCATTER_NAMED_LIMIT ? ` and ${left - SCATTER_NAMED_LIMIT} others` : '';
          return `${plotted} ${noun(plotted)} have both figures. Not shown: ${left} ${noun(left)} — ${named}${rest}.`;
        })();

  const notApplicableClause =
    spec.notApplicableCount > 0
      ? ` ${spec.notApplicableCount} ${noun(spec.notApplicableCount)} did not exist in this period according to CBS.`
      : '';

  return `Coverage: ${coverage}${notApplicableClause}`;
}

/** The English definition line for ONE axis (fix round 1; split per axis in
 * #296 part 2 Task 7 so the card can pair each with its Dutch sibling): the
 * hand-written English label (ENGLISH_MEASURE_LABELS) for the leg's
 * canonical key, cased like toEnglishChartSpec's own 'Definition: …' line —
 * or null when there is none (never guessed). "vertical"/"horizontal" name
 * the spec's own axes (y/x), i.e. the view as it opens. */
export function scatterDefinitionLineEn(spec: ScatterSpec, side: 'y' | 'x'): string | null {
  const axis = spec[side];
  const label = axis.canonicalKey === null ? undefined : ENGLISH_MEASURE_LABELS[axis.canonicalKey];
  if (label === undefined) return null;
  return `Definition (${side === 'y' ? 'vertical axis' : 'horizontal axis'}): ${capitalise(label)}.`;
}

/** The English definition lines for the card: one per axis that has one,
 * vertical (y) first — the English sibling of the Dutch per-axis definition
 * lines. */
export function scatterDefinitionLinesEn(spec: ScatterSpec): string[] {
  return (['y', 'x'] as const)
    .map((side) => scatterDefinitionLineEn(spec, side))
    .filter((line): line is string => line !== null);
}

/** Shown in place of a Dutch staleness line the English translator cannot
 * shape (a form staleness.ts does not produce today): the caveat itself is
 * never dropped and never shown in Dutch on an English card. No table name,
 * no date — nothing here is guessed. */
export const SCATTER_STALENESS_FALLBACK_EN =
  'Note: one of these tables may not be up to date — more recent figures may now be available.';

/** The English of a scatter answer's stored staleness warning (#296 part 2
 * Task 4 ruling I2: one line per stale leg, y first, each naming its table —
 * "Let op: de tabel {tableId} ({measureTitle}) …", joined by "\n"). Each line
 * goes through the shared translator (staleness-en.ts), with the table's
 * measure named by the SAME English name the card's axis titles use
 * (`measureEn`); a line naming a table this spec has no axis for, or any
 * shape the translator cannot read, becomes SCATTER_STALENESS_FALLBACK_EN. */
export function scatterStalenessLinesEn(spec: ScatterSpec, warning: string | null): string[] {
  if (warning === null) return [];
  const nameMeasure = (tableId: string, measureTitle: string | null): string | null => {
    const axes = [spec.y, spec.x].filter((axis) => axis.tableId === tableId);
    // Both axes can come from one table: then the title picks the axis.
    const axis = axes.find((a) => a.measureTitle === measureTitle) ?? (axes.length === 1 ? axes[0] : undefined);
    return axis === undefined ? null : measureEn(axis);
  };
  return warning
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => translateStalenessWarning(line, nameMeasure) ?? SCATTER_STALENESS_FALLBACK_EN);
}

/** An axis title as the card shows it: the measure title plus its unit (both
 * spec strings, translated for an English reader), plus the log marker when
 * that axis is currently drawn on a log scale. An empty unit adds nothing. */
export function scatterAxisTitle(axis: ScatterAxis, lang: Lang, log: boolean): string {
  const title = lang === 'en' ? measureEn(axis) : axis.measureTitle;
  const unit = lang === 'en' ? translateUnit(axis.unit) : axis.unit;
  const withUnit = unit.trim() === '' ? title : `${title} (${unit})`;
  return log ? `${withUnit}${t(lang, 'chart.scatter.logSuffix')}` : withUnit;
}
