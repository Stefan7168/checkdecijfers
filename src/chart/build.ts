// Chart-spec builder — deterministic code from validated results, the only
// producer of chart data in the pipeline (R6; ADR 007: the LLM never produces
// chart data). Policy (recorded in ADR 014):
//
//   result shape 'series'         → line chart (B4, B8)
//   result shape 'comparison'     → bar chart  (docs/03: "chart when
//                                    trend/comparison")
//   result shape 'region_set'     → bar chart, sorted by the region-ranking
//                                    derivation when one exists (#253 Task 5;
//                                    no ChartSpec.kind value for "horizontal" —
//                                    the web layer's 'hbar' FORM is a view of a
//                                    'bar'-kind spec, chart-view-state.ts's
//                                    hbarFormAllowed)
//   result shape 'region_series'  → line chart, one series per region in
//                                    intent order (ADR 055 Task 3; #253/#264
//                                    UX-audit pass-3 row 14) — the same
//                                    group-by-region below already produces
//                                    one ChartSeries per regionCode, so this
//                                    shape needed no new grouping, only the
//                                    kind + contiguity-gate extension
//   'single' / 'derived'          → no chart (null) — a lone number or an
//                                    explicit derivation headline is prose,
//                                    not a chart, in Phase 0
//
// Everything plotted is a verbatim projection of the result's cells: same
// values, same order (period ascending, then intent region order), null
// cells kept with their CBS reason. Display strings are built once, here,
// with the same formatter answers use (R3/R10) — renderers only ever show
// spec strings.
import type { ChartPoint, ChartSeries, ChartSpec } from './types.ts';
import { CHART_SPEC_VERSION } from './types.ts';
import type { DerivationRecord, ResultCell, ValidatedResult } from '../query/index.ts';
import { contiguousPeriodCodes } from '../query/index.ts';
import { buildAttributionLine, formatValueNl } from '../answer/compose/format.ts';
import { renderTrendHeadline } from '../answer/compose/template.ts';
import { resolveSource } from '../sources/registry.ts';

/** R11 note rendered with any chart containing non-definitive points. */
export const PROVISIONAL_NOTE = 'Voorlopige cijfers zijn gemarkeerd met *.' as const;

function toPoint(cell: ResultCell): ChartPoint {
  return {
    resultId: cell.resultId,
    periodCode: cell.periodCode,
    periodLabel: cell.periodLabel,
    value: cell.value,
    formattedValue: cell.value === null ? null : formatValueNl(cell.value, cell.decimals),
    decimals: cell.decimals,
    status: cell.status,
    provisional: cell.provisional,
    valueAttribute: cell.valueAttribute,
  };
}

/** The honest-gap line for a null-valued cell: period (and region when the
 * chart has several), plus the source's reason verbatim. The source name
 * comes from the registry (WP30a, ADR 030 A3 — this stored, R8-re-derived
 * string was missing from D3's original site list); absent source resolves
 * to 'cbs' (A1), keeping old stored specs byte-identical. */
function nullNote(cell: ResultCell, multiRegion: boolean, sourceName: string): string {
  const where =
    multiRegion && cell.regionLabel !== null
      ? `${cell.periodLabel} (${cell.regionLabel})`
      : cell.periodLabel;
  return `Geen waarde voor ${where}: ${cell.valueAttribute} (${sourceName}).`;
}

export function buildChartSpec(result: ValidatedResult): ChartSpec | null {
  if (
    result.shape !== 'series' &&
    result.shape !== 'comparison' &&
    result.shape !== 'region_set' &&
    result.shape !== 'region_series'
  ) {
    return null;
  }
  // #64 (session 22, review fix): a non-contiguous explicit enumeration
  // draws NO chart — a connected line across skipped periods would imply a
  // continuity nobody sampled (the R6 renderer draws exactly what the spec
  // says, so the spec must never say it). Genuine ranges are gap-free by
  // the WP14 completeness discipline and chart as always. A per-period BAR
  // presentation for enumerations is a possible follow-up, not v1.
  //
  // ADR 055 Task 3: `region_series` gets the SAME gate. Its cells are
  // period-major/region-minor (N regions x M periods), so the naive period
  // list carries each code N times — contiguousPeriodCodes de-dupes
  // internally (src/query/resolve.ts), so this checks the shared period
  // axis exactly once, regardless of region count.
  if (
    (result.shape === 'series' || result.shape === 'region_series') &&
    !contiguousPeriodCodes(result.cells.map((c) => c.periodCode))
  ) {
    return null;
  }
  const kind = result.shape === 'series' || result.shape === 'region_series' ? 'line' : 'bar';

  // One unit per chart (R10). The query layer already refuses mixed units
  // (internal_inconsistency), so this firing means upstream corruption —
  // fail loudly, never chart it.
  const units = [...new Set(result.cells.map((c) => c.unit))];
  if (units.length !== 1) {
    throw new Error(`chart spec refused: mixed units across cells (${units.join(', ')})`);
  }

  // Group by region, preserving cell order within and across groups. A
  // regionless (national) table yields one series labeled by the measure.
  const seriesByRegion = new Map<string | null, ChartSeries>();
  for (const cell of result.cells) {
    let series = seriesByRegion.get(cell.regionCode);
    if (!series) {
      series = {
        label: cell.regionLabel ?? cell.measureTitle,
        regionCode: cell.regionCode,
        points: [],
      };
      seriesByRegion.set(cell.regionCode, series);
    }
    series.points.push(toPoint(cell));
  }
  const series = [...seriesByRegion.values()];

  // #253 Task 5 (R6 — the renderer draws the spec's own order, it never
  // invents one): a region_set's bars are sorted by its ranking derivation
  // when RS1 produced one (a complete set — src/query/derivations.ts
  // deriveRegionRanking). Each region_set series carries exactly one point
  // (checked below), so its resultId stands for the whole series. With no
  // ranking record (an incomplete set — RS1 refused it) the sort is skipped
  // entirely and the series stay in the result's own cell order — never a
  // builder-invented fallback ordering.
  if (result.shape === 'region_set') {
    const ranking = result.derivations.find(
      (d): d is Extract<DerivationRecord, { kind: 'max' }> => d.kind === 'max',
    );
    if (ranking) {
      const rankIndex = new Map(ranking.rankingResultIds.map((id, i) => [id, i]));
      series.sort((a, b) => {
        const aRank = rankIndex.get(a.points[0]!.resultId) ?? Number.MAX_SAFE_INTEGER;
        const bRank = rankIndex.get(b.points[0]!.resultId) ?? Number.MAX_SAFE_INTEGER;
        return aRank - bRank;
      });
    }
  }

  // Shape guarantee from the query layer: a comparison is one period across
  // regions. A multi-point series here is a contract break — fail loudly.
  if (kind === 'bar' && series.some((s) => s.points.length !== 1)) {
    throw new Error('chart spec refused: comparison result with multiple periods per region');
  }

  // Duplicate period within one region = the same coordinate twice —
  // corrupted input the ingestion layer should have refused; never chart it.
  for (const s of series) {
    if (new Set(s.points.map((p) => p.periodCode)).size !== s.points.length) {
      throw new Error(`chart spec refused: duplicate period for region ${s.regionCode ?? '(national)'}`);
    }
  }

  // One coordinate set per chart: the query pins a single non-geo/non-period
  // coordinate for the whole result; disagreement is corruption. The dims are
  // carried into the spec — without them, two charts of the same measure at
  // different coordinates would be indistinguishable (contract audit,
  // 2026-07-03).
  const firstCell = result.cells[0]!;
  const dimsFingerprint = JSON.stringify(firstCell.dims);
  if (result.cells.some((c) => JSON.stringify(c.dims) !== dimsFingerprint)) {
    throw new Error('chart spec refused: cells sit at differing dimension coordinates');
  }

  const multiRegion = series.length > 1;
  const anyProvisional = result.cells.some((c) => c.provisional);

  const direction = result.derivations.find(
    (d): d is Extract<DerivationRecord, { kind: 'direction' }> => d.kind === 'direction',
  );
  // C1 (whole-branch review, #197): deriveDirection has no region guard, and
  // cells are period-major/region-minor, so on a multi-region chart its
  // (first cell, last cell) pair silently diffs across DIFFERENT regions —
  // not a real trend (e.g. Amsterdam falling + Utrecht rising could net to
  // "steeg", contradicting the chart itself). A trend headline is only ever
  // honest for a single-region chart; `multiRegion` is already computed above.
  const trendHeadline = direction && !multiRegion ? renderTrendHeadline(result, direction) : undefined;

  return {
    schemaVersion: CHART_SPEC_VERSION,
    kind,
    title: firstCell.measureTitle,
    dims: { ...firstCell.dims },
    dimLabels: { ...firstCell.dimLabels },
    unit: units[0]!,
    series,
    provisionalNote: anyProvisional ? PROVISIONAL_NOTE : null,
    nullNotes: result.cells
      .filter((c) => c.value === null)
      .map((c) => nullNote(c, multiRegion, resolveSource(result.attribution.source).displayName)),
    definitionLine:
      result.attribution.definitionLabel === null
        ? null
        : `Definitie: ${result.attribution.definitionLabel}.`,
    attributionLine: buildAttributionLine(result),
    attribution: {
      tableId: result.attribution.tableId,
      tableTitle: result.attribution.tableTitle,
      tableVersion: result.attribution.tableVersion,
      syncedAt: result.attribution.syncedAt,
      coveredPeriods: { ...result.attribution.coveredPeriods },
      license: result.attribution.license,
      ...(trendHeadline !== undefined ? { trendHeadline } : {}),
    },
  };
}
