// "Eigen data" attachments tier — buildUserChartSpec, the ONLY producer of
// UserChartSpec (D7 point 3), mirroring src/chart/build.ts's one-producer
// rule for the CBS side. Every plotted value here is either
// `parseNumber(rawCell, column.numberFormat)` of one stored cell, or — phase
// 2 (session 113) — a value already computed deterministically by
// execute.ts's aggregate/derived pipeline (or null-with-reason, U11); there
// is no other code path from stored cells to a displayed number in this
// tier.
import { formatValueNl } from '../answer/compose/format.ts';
import { columnById, columnIndex } from './columns.ts';
import { executeInstruction, type RawPoint } from './execute.ts';
import { decimalsOf, parseNumber } from './ingest/numbers.ts';
import { aggregateLabel, derivedLabel } from './labels.ts';
import {
  USER_CHART_SPEC_VERSION,
  USER_DATA_DISCLAIMER,
  type ChartInstruction,
  type ColumnProfile,
  type MissingValueReason,
  type UserChartPoint,
  type UserChartSeries,
  type UserChartSpec,
  type UserDataset,
} from './types.ts';

function missingReason(raw: string): MissingValueReason {
  return raw.trim().length === 0 ? 'leeg in bron' : 'geen getal';
}

function buildPoint(raw: RawPoint, yColumnId: string, yColumn: ColumnProfile): UserChartPoint {
  const xLabel = raw.xRaw.trim();

  if (raw.computed) {
    const { value, decimals, rowRef, reason } = raw.computed;
    return {
      rowRef,
      xKey: xLabel,
      xLabel,
      value,
      formattedValue: value === null ? null : formatValueNl(value, decimals),
      // A derived point still traces to the `a` cell's own raw text
      // (raw.yRaw, carried through unaggregated); an aggregate-only point
      // no longer corresponds to one cell at all.
      sourceText: rowRef.startsWith('der:') ? raw.yRaw : '',
      ...(reason ? { reason } : {}),
    };
  }

  const format = yColumn.type === 'year' ? 'en' : (yColumn.numberFormat ?? 'nl');
  const value = parseNumber(raw.yRaw, format);
  return {
    rowRef: `r${raw.rowIndex}:c${columnIndex(yColumnId)}`,
    xKey: xLabel,
    xLabel,
    value,
    formattedValue: value === null ? null : formatValueNl(value, yColumn.type === 'year' ? 0 : decimalsOf(raw.yRaw, format)),
    sourceText: raw.yRaw,
    ...(value === null ? { reason: missingReason(raw.yRaw) } : {}),
  };
}

/**
 * The only producer of UserChartSpec. Delegates selection/ordering/limiting
 * to executeInstruction (which may throw NoRowsError/TooManyPointsError —
 * respond.ts catches these and turns them into the D9
 * clarification/refusal envelopes, never a chart). This function itself
 * does no filtering/sorting of its own — it only shapes already-selected
 * points into the spec, applying the shared Dutch formatter (R3/R10 analog)
 * so display never rounds or reformats beyond localisation.
 */
export function buildUserChartSpec(dataset: UserDataset, instruction: ChartInstruction): UserChartSpec {
  const rawPoints = executeInstruction(dataset, instruction);
  const profile = dataset.profile;
  const xColumn = columnById(profile, instruction.x);

  // Grouped by seriesKey (code-review finding, session 84: NEVER by the
  // display label alone — two y columns sharing an identical header would
  // otherwise silently merge into one series; execute.ts guarantees
  // seriesKey is a real column id or a raw distinct value, always unique
  // per intended series).
  const bySeries = new Map<string, RawPoint[]>();
  for (const point of rawPoints) {
    const bucket = bySeries.get(point.seriesKey);
    if (bucket) bucket.push(point);
    else bySeries.set(point.seriesKey, [point]);
  }

  // seriesBy uses only y[0] (execute.ts's own documented choice) — every
  // series then shares that one y column. With no seriesBy, seriesKey IS
  // the y column id directly (execute.ts's multi-y branch), so no
  // header-based lookup is needed at all.
  const singleY = instruction.seriesBy !== null ? columnById(profile, instruction.y[0]!) : null;

  // Phase 2 (session 113): an aggregate/derived series is labeled by a
  // deterministic English description of the computation (labels.ts),
  // never by the raw column header alone — U9's verbatim-header rule only
  // ever applied to an unmodified column. `derivedLabelText` takes
  // precedence over aggregate's own label when both are set (derived is
  // always the LAST stage applied, per execute.ts's pipeline order).
  const derivedLabelText =
    instruction.derived !== null
      ? derivedLabel(
          instruction.derived.op,
          columnById(profile, instruction.y[0]!).header,
          instruction.derived.b === null ? null : columnById(profile, instruction.derived.b).header,
        )
      : null;

  const series: UserChartSeries[] = [...bySeries.entries()].map(([, points]) => {
    const first = points[0]!;
    const yColumn = singleY ?? columnById(profile, first.seriesKey);
    const label =
      derivedLabelText ?? (instruction.aggregate !== null ? aggregateLabel(instruction.aggregate.fn, yColumn.header) : first.seriesLabel);
    return { label, points: points.map((p) => buildPoint(p, yColumn.id, yColumn)) };
  });

  const yHeaders =
    derivedLabelText !== null
      ? [derivedLabelText]
      : instruction.aggregate !== null
        ? instruction.y.map((id) => aggregateLabel(instruction.aggregate!.fn, columnById(profile, id).header))
        : instruction.y.map((id) => columnById(profile, id).header);

  return {
    schemaVersion: USER_CHART_SPEC_VERSION,
    origin: 'user_dataset',
    trust: 'unverified',
    kind: instruction.kind,
    xHeader: xColumn.header,
    yHeaders,
    series,
    provenance: {
      datasetId: dataset.id,
      sourceKind: dataset.sourceKind,
      displayName: dataset.displayName,
      sourceUrlHost: dataset.sourceUrl === null ? null : safeHost(dataset.sourceUrl),
      capturedAt: dataset.createdAt,
      contentSha256: dataset.contentSha256,
    },
    disclaimerLine: USER_DATA_DISCLAIMER,
  };
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
