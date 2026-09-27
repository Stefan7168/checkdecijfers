// #296 part 2 Task 6: the English mirrors of src/chart/scatter-text.ts's
// Dutch scatter texts, for an English-interface reader. Same contract as
// every English display layer (src/chart/english.ts, src/answer/translate/
// lines.ts): pure, deterministic, NO model call — the stored spec stays
// Dutch and English is derived here at render time. Every name goes through
// the shared, hand-checked name tables (cbs-words.ts / regionLabelEn), and an
// unseeded name stays Dutch rather than being guessed at (principle c).
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
import { regionLabelEn } from '../backend/answer/respond/english.ts';
import type { RegionScope } from '../backend/query/types.ts';
import { resolveSourceForTable } from '../backend/sources/registry.ts';
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

function measureEn(axis: ScatterAxis): string {
  return translateMeasureTitle(axis.measureTitle);
}

/** The English sibling of `sideReason` (scatter-text.ts). */
function sideReasonEn(side: ScatterSideStatus, axis: ScatterAxis): string | null {
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
  if (yReason !== null) reasons.push(`${lowerFirst(measureEn(spec.y))}: ${yReason}`);
  const xReason = sideReasonEn(item.x, spec.x);
  if (xReason !== null) reasons.push(`${lowerFirst(measureEn(spec.x))}: ${xReason}`);
  return `${regionLabelEn(item.label)} (${reasons.join('; ')})`;
}

/** English of the stored Dutch `spec.title` (`{Y} tegenover {x}, {period}`,
 * scatter.ts) — rebuilt from the spec's own fields, never by parsing the
 * Dutch sentence. */
export function scatterTitleEn(spec: ScatterSpec): string {
  return `${measureEn(spec.y)} against ${lowerFirst(measureEn(spec.x))}, ${translatePeriodLabel(spec.y.periodLabel)}`;
}

/** English of `scatterBodyNl`. */
export function scatterBodyEn(spec: ScatterSpec): string {
  const noun = nounEn(spec.scope, 1);
  return (
    `${measureEn(spec.y)} against ${lowerFirst(measureEn(spec.x))} per ${noun}, ${translatePeriodLabel(spec.y.periodLabel)}. ` +
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

/** An axis title as the card shows it: the measure title plus its unit (both
 * spec strings, translated for an English reader), plus the log marker when
 * that axis is currently drawn on a log scale. An empty unit adds nothing. */
export function scatterAxisTitle(axis: ScatterAxis, lang: Lang, log: boolean): string {
  const title = lang === 'en' ? measureEn(axis) : axis.measureTitle;
  const unit = lang === 'en' ? translateUnit(axis.unit) : axis.unit;
  const withUnit = unit.trim() === '' ? title : `${title} (${unit})`;
  return log ? `${withUnit}${t(lang, 'chart.scatter.logSuffix')}` : withUnit;
}
