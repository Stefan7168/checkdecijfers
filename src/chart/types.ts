// WP8 chart spec — the declarative, versioned artifact ADR 007 commits to.
//
// The spec is the ONLY thing any renderer ever receives: chart data verbatim
// from validated query results (R6), attribution inside the spec so no
// rendering path can drop it (R4), CBS status carried per point (R11), every
// point traceable to its result cell via resultId (R1). Specs are stored
// forever in audit records (R8, WP10) and on future published pages, so the
// schema is versioned from the very first emitted spec (ADR 007) and may only
// grow via new versions, never by silently changing v1.
export const CHART_SPEC_VERSION = 1 as const;

/** One plotted value — a projection of exactly one ResultCell. `value` is the
 * plotted quantity; `formattedValue` is the display string (built once by the
 * same formatter answers use, R3/R10) — renderers show strings from the spec,
 * they never format or round numbers themselves (R6). Null cells stay in the
 * spec with their CBS reason (`valueAttribute`), so a renderer cannot omit
 * them silently; it must render an honest gap (R11). */
export interface ChartPoint {
  /** R1 traceability handle — the source cell's deterministic coordinate id. */
  resultId: string;
  periodCode: string;
  /** The x-axis label for line charts (validated CBS period label). */
  periodLabel: string;
  value: number | null;
  /** Dutch-formatted display string; null exactly when value is null. */
  formattedValue: string | null;
  /** CBS decimals metadata (R10) — kept for future renderers' axis
   * formatting; v1's renderer only ever shows formattedValue. */
  decimals: number;
  /** CBS publication status: Definitief / Voorlopig / NaderVoorlopig. */
  status: string;
  /** True when status is not Definitief — rendered as a marked point (R11). */
  provisional: boolean;
  /** CBS ValueAttribute: 'None' for plain values, else the null/cell reason. */
  valueAttribute: string;
}

/** One drawn series. Line charts: one series per region (label = region), or
 * a single series labeled by the measure for national tables. Bar charts:
 * one series per region, exactly one point each — the bar's category label
 * is the series label. Point order is the validated result's cell order
 * (period ascending); the spec's order IS the render order — reordering is
 * computation a renderer may not do (R6). */
export interface ChartSeries {
  label: string;
  regionCode: string | null;
  points: ChartPoint[];
}

/** R4: the attribution block, structured for future renderers (shareable
 * pages, static images) plus the exact rendered sentence — the same string
 * answers display, built by the same function. */
export interface ChartAttribution {
  tableId: string;
  tableTitle: string;
  tableVersion: number;
  syncedAt: string;
  coveredPeriods: { from: string; to: string };
  license: 'CC BY 4.0';
}

export interface ChartSpec {
  schemaVersion: typeof CHART_SPEC_VERSION;
  /** Phase 0 chart vocabulary (ADR 007): line for series results, bar for
   * comparison results. */
  kind: 'line' | 'bar';
  /** Chart heading: the validated measure title. */
  title: string;
  /** The non-geo, non-period coordinates every plotted cell is pinned at —
   * codes and Dutch labels. Without them, two charts of the same measure at
   * different coordinates (Geslacht=Vrouwen vs =Mannen) would be
   * indistinguishable, and renderers receive only the spec (ADR 007).
   * Contract-audit finding, 2026-07-03. The builder refuses cells that
   * disagree on their coordinates. */
  dims: Record<string, string>;
  dimLabels: Record<string, string>;
  /** The single unit all plotted values share (R10) — the builder refuses
   * mixed-unit input loudly. */
  unit: string;
  series: ChartSeries[];
  /** R11: present whenever any plotted point is provisional; renderers must
   * display it with the chart. */
  provisionalNote: string | null;
  /** One line per null-valued cell (period + CBS reason) — the honest-gap
   * text renderers must display so a missing value is never silent. */
  nullNotes: string[];
  /** Canonical-default transparency (docs/05): present when the result used
   * a canonical definition, so a standalone chart render still states it. */
  definitionLine: string | null;
  /** The exact R4 attribution sentence (same builder as answers). */
  attributionLine: string;
  attribution: ChartAttribution;
}
