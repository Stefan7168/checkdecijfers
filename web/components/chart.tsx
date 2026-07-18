// The Recharts wrapper ADR 014 deferred to this session — renders the exact
// same server-built ChartSpec the SVG renderer (src/chart/render.ts) draws,
// over the client charting library ADR 008 named (ADR 018 decision 6).
//
// Honesty contract, mirrored from the SVG renderer: every numeric STRING a
// viewer can read must be a point's own `formattedValue`, never Recharts'
// own formatting of the raw `value` — enforced below via a custom tooltip
// that reads a sibling `_display` field, and axis ticks are hidden entirely
// (the SVG renderer's own choice: "gridlines are deliberately unlabeled — no
// invented axis ticks"). `value` itself is used only for geometry (bar
// height / line position), never rendered as text. Every displayed value is
// additionally BOUND to its source cell via `data-label-for="<resultId>"` —
// membership alone ("the string appears somewhere in the spec") provably
// misses swapped labels (WP8 review lesson; recurred here, WP12 review).
'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ChartSpec } from '../backend/chart/types.ts';
import { SourceBadge } from './source-badge.tsx';

export type Row = Record<string, string | number | boolean | null>;

export interface SeriesMeta {
  key: string;
  label: string;
  color: string;
}

// Huisstijl palette (docs/12-huisstijl.md): the primary series takes the one
// accent; subsequent series fall back to the other semantic tokens rather than
// introducing new hex colors. CSS var() strings are valid SVG stroke/fill
// values, so the same tokens app/globals.css defines drive the chart.
const COLORS = [
  'var(--accent)',
  'var(--danger)',
  'var(--ok)',
  'var(--accent-strong)',
  'var(--warn)',
  'var(--ink-soft)',
];

// Y-axis honesty policy (open-questions #48, resolved 2026-07-04): a bar
// encodes LENGTH, so a non-zero baseline visually lies about ratios — bars
// must floor at zero. A line encodes POSITION, so it may zoom to show real
// movement. Mirrors the deterministic SVG renderer's `makeScale`
// (src/chart/render.ts), which has done this since WP8. Exported + wired into
// the YAxis below so the tested policy IS the rendered policy (WP12 review
// lesson: a policy that the render doesn't actually use is not a guard).
export function yAxisDomain(kind: ChartSpec['kind']): [0 | 'auto', 'auto'] {
  return kind === 'bar' ? [0, 'auto'] : ['auto', 'auto'];
}

export function buildRows(spec: ChartSpec): { rows: Row[]; seriesMeta: SeriesMeta[] } {
  const periodCodes = new Set<string>();
  for (const series of spec.series) {
    for (const point of series.points) periodCodes.add(point.periodCode);
  }
  const sortedCodes = Array.from(periodCodes).sort((a, b) => a.localeCompare(b));

  const seriesMeta: SeriesMeta[] = spec.series.map((series, i) => ({
    key: `s${i}`,
    label: series.label,
    color: COLORS[i % COLORS.length],
  }));

  const rows: Row[] = sortedCodes.map((code) => {
    const row: Row = { periodCode: code, periodLabel: code };
    spec.series.forEach((series, i) => {
      const point = series.points.find((p) => p.periodCode === code) ?? null;
      const key = seriesMeta[i].key;
      row[key] = point ? point.value : null;
      row[`${key}_display`] = point ? point.formattedValue : null;
      row[`${key}_provisional`] = point ? point.provisional : false;
      // R1 traceability carried per point, so every displayed string stays
      // BOUND to its source cell (data-label-for in the tooltip) — the WP8
      // membership-without-binding lesson recurred in this wrapper and was
      // caught by the WP12 adversarial review.
      row[`${key}_resultId`] = point ? point.resultId : null;
      // First-wins: a series with a disjoint period set must not overwrite
      // the label another series already provided for this period code.
      if (point && row.periodLabel === code) row.periodLabel = point.periodLabel;
    });
    return row;
  });

  return { rows, seriesMeta };
}

interface TooltipPayloadEntry {
  dataKey: string;
  color: string;
  payload: Row;
}

// Exported for direct testing: the tooltip is the one place displayed value
// strings are assembled, so its binding contract is test-pinned (WP12 review).
export function ChartTooltip({
  active,
  payload,
  label,
  seriesMeta,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
  seriesMeta: SeriesMeta[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const labelByKey = new Map(seriesMeta.map((s) => [s.key, s.label]));
  return (
    <div className="rounded-md border border-line-strong bg-paper-raised px-3 py-2 text-sm shadow-sm">
      <div className="font-medium text-ink">{label}</div>
      {payload.map((entry) => {
        const display = entry.payload[`${entry.dataKey}_display`];
        if (display == null) return null;
        const provisional = entry.payload[`${entry.dataKey}_provisional`];
        const resultId = entry.payload[`${entry.dataKey}_resultId`];
        return (
          <div
            key={entry.dataKey}
            style={{ color: entry.color }}
            data-label-for={resultId == null ? undefined : String(resultId)}
          >
            {labelByKey.get(entry.dataKey)}: {String(display)}
            {provisional ? ' *' : ''}
          </div>
        );
      })}
    </div>
  );
}

function ProvisionalDot(seriesKey: string) {
  return function Dot(props: { cx?: number; cy?: number; payload?: Row }) {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null || !payload) return null;
    const value = payload[seriesKey];
    if (value == null) return null;
    const provisional = payload[`${seriesKey}_provisional`];
    return (
      <circle
        cx={cx}
        cy={cy}
        r={4}
        fill={provisional ? 'white' : undefined}
        stroke="currentColor"
        strokeWidth={2}
      />
    );
  };
}

export function ChartView({ spec }: { spec: ChartSpec }) {
  const { rows, seriesMeta } = buildRows(spec);
  const dimEntries = Object.entries(spec.dimLabels);

  return (
    <div className="mt-3 rounded-lg border border-line bg-paper-raised p-3">
      <div className="text-sm font-semibold text-ink">{spec.title}</div>
      {dimEntries.length > 0 ? (
        <div className="text-xs text-ink-muted">
          {dimEntries.map(([k, v]) => `${k}: ${v}`).join(' · ')}
        </div>
      ) : null}
      <div className="text-xs text-ink-muted">{spec.unit}</div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {spec.kind === 'line' ? (
            <LineChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis dataKey="periodLabel" tick={{ fontSize: 11, fill: 'var(--ink-muted)' }} />
              <YAxis tick={false} width={16} domain={yAxisDomain(spec.kind)} />
              <Tooltip content={<ChartTooltip seriesMeta={seriesMeta} />} />
              {seriesMeta.length > 1 ? <Legend /> : null}
              {seriesMeta.map((s) => (
                <Line
                  key={s.key}
                  type="linear"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  connectNulls={false}
                  dot={ProvisionalDot(s.key)}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          ) : (
            <BarChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis dataKey="periodLabel" tick={{ fontSize: 11, fill: 'var(--ink-muted)' }} />
              <YAxis tick={false} width={16} domain={yAxisDomain(spec.kind)} />
              <Tooltip content={<ChartTooltip seriesMeta={seriesMeta} />} />
              {seriesMeta.length > 1 ? <Legend /> : null}
              {seriesMeta.map((s) => (
                <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} isAnimationActive={false} />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      {/* WP23 (#92): caveats read like caveats — warn and a step larger than
        * the source credit, which stays smallest/lightest (photo-credit
        * style). Content untouched: same strings from the same one builder
        * (R4); only presentation changes here. */}
      {spec.provisionalNote ? <p className="mt-2 text-sm text-warn">{spec.provisionalNote}</p> : null}
      {spec.nullNotes.map((note) => (
        <p key={note} className="text-sm text-warn">
          {note}
        </p>
      ))}
      {spec.definitionLine ? <p className="mt-2 text-xs text-ink-muted">{spec.definitionLine}</p> : null}
      {/* #170(1): the R4 prose credit keeps its photo-credit size (#92); the
        * badge is the same attribution made SCANNABLE — table id + measured
        * sync date + deep link, from spec.attribution only (the source key is
        * derived from the table id inside the badge; ChartAttribution carries
        * none). Ontdek reuses this component, so the homepage charts get the
        * identical badge for free. */}
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-xs text-ink-muted">{spec.attributionLine}</p>
        <SourceBadge tableId={spec.attribution.tableId} syncedAt={spec.attribution.syncedAt} />
      </div>
    </div>
  );
}
