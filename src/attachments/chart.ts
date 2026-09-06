// "Eigen data" attachments tier — buildUserChartSpec, the ONLY producer of
// UserChartSpec (D7 point 3), mirroring src/chart/build.ts's one-producer
// rule for the CBS side. Every plotted value here is `parseNumber(rawCell,
// column.numberFormat)` of one stored cell (or null-with-reason, U11) —
// there is no other code path from a stored cell to a displayed number in
// this tier.
import { formatValueNl } from '../answer/compose/format.ts';
import { columnById, columnIndex } from './columns.ts';
import { executeInstruction, type RawPoint } from './execute.ts';
import { decimalsOf, parseNumber } from './ingest/numbers.ts';
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
  const format = yColumn.type === 'year' ? 'en' : (yColumn.numberFormat ?? 'nl');
  const value = parseNumber(raw.yRaw, format);
  const xLabel = raw.xRaw.trim();
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

  const series: UserChartSeries[] = [...bySeries.entries()].map(([, points]) => {
    const first = points[0]!;
    const yColumn = singleY ?? columnById(profile, first.seriesKey);
    return { label: first.seriesLabel, points: points.map((p) => buildPoint(p, yColumn.id, yColumn)) };
  });

  return {
    schemaVersion: USER_CHART_SPEC_VERSION,
    origin: 'user_dataset',
    trust: 'unverified',
    kind: instruction.kind,
    xHeader: xColumn.header,
    yHeaders: instruction.y.map((id) => columnById(profile, id).header),
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
