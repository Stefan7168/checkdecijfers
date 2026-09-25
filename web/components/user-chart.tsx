// ADR 037 D11 (H2) — the user-data chart renderer. A SEPARATE component from
// ChartView, over a SEPARATE spec type (UserChartSpec — cannot parse as a
// ChartSpec, so the mis-render H2 guards against is structurally impossible,
// not merely styled away). Reuses ChartView's exported pure helpers
// (buildRows, yAxisDomain, valueLabelPlan, AxisTick, ChartTooltip,
// baselineAxisLine) over an adapter mapping UserChartPoint -> the minimal
// PlottableSpec interface those helpers actually need (rowRef := resultId,
// xKey := periodCode, xLabel := periodLabel) — no runtime change to
// chart.tsx, per its own header comment.
//
// Co-pilot phase 2 (session 113, Task 5): this card is now a real card. It
// composes the SHARED shell the CBS card uses — `useChartHistory` +
// `useChartEdits` (the command log and its per-account persistence),
// `ChartHistoryActions`, `ChartEditableText`, `ChartConfigPanel`,
// `ChartNotes`, `SeriesLegend` — plus the form tabs and a table view. What
// is deliberately NOT here: the Insights story/stage, the zoom window,
// embed/stage modes, and the reading toggle (an own-data chart has no
// registry alternates). Small multiples and a CSV download (with the
// formula-injection defense D11 asked for, `web/lib/user-csv.ts`) joined in
// session 126 (#318).
//
// The one thing this card has that the CBS card cannot: a DATA command.
// `state.instruction` says which columns/aggregate/derived reading is drawn,
// and changing it re-renders the chart through `renderDatasetInstruction` —
// deterministic, zero LLM, zero credits. The doorways that SET it are Task 6
// (the Data panel) and Task 8 (the chat input); this file owns the effect
// that turns an instruction into a spec, and the mount points those doorways
// plug into.
//
// Task 8 adds doorway B, "Pas deze grafiek aan": ONE credited call per typed
// message (`adjustDatasetChart`), zero for the example chips, for Undo and
// for the 👍/👎. What comes back is a recipe, not a rendering: every stored
// command is re-validated here against the NEW chart (`acceptReply`) before
// it is dispatched with `source: 'chat'` into the SAME history the panel and
// the canvas write to — so one Undo, one saved log, one story of who changed
// what.
'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  DefaultZIndexes,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Sector,
  Tooltip,
  useXAxisScale,
  useYAxisScale,
  XAxis,
  YAxis,
  ZIndexLayer,
} from 'recharts';
import type { PieLabelRenderProps, PieSectorShapeProps } from 'recharts';
import { renderDatasetInstruction, type RenderDatasetInstructionOutcome } from '../app/dataset-actions.ts';
import { adjustDatasetChart, submitCopilotFeedback, type AdjustDatasetChartOutcome } from '../app/dataset-copilot-actions.ts';
import { requestDatasetDerivation } from '../app/dataset-derivation-actions.ts';
import { requestDatasetWholeVerification } from '../app/dataset-whole-verification-actions.ts';
import { forgetMyChartStyle, lookupBrand, saveMyChartStyle } from '../app/chart-style-actions.ts';
import { formatValueNl } from '../backend/answer/compose/format.ts';
import type { ResolvedOverlay } from '../backend/attachments/derive-overlay.ts';
import type { VerifyOutcome } from '../backend/query/whole-verification.ts';
import type { DerivedOverlayRequest } from '../lib/chart-commands.ts';
import {
  LINE_WIDTH_PX,
  areaFillOpacityFor,
  dotGeometry,
  findFont,
  fontStack,
  markerVisible,
  resolvePresentation,
  sanitizeOverrides,
  seriesColor,
  withAccountDefault,
  type SeriesEndpoints,
} from '../lib/chart-presentation.ts';
import { useChartStyle } from '../lib/chart-style-context.tsx';
// Own-data publish (ADR 057, Task 4): type-only — `own-chart-publication.ts`
// is a server-side module (it imports backend/attachments/render.ts etc.);
// `import type` erases this at compile time, so none of that code ever
// reaches this client component's bundle. `PublicOwnChart` is unused here
// (the public page hands its pieces apart, see `UserChartPublicView` below).
import type { PublicChartState } from '../lib/own-chart-publication.ts';
import { ensureFontLoaded } from '../lib/font-loader.ts';
import { exampleChips, ownDataCapabilities } from '../lib/chart-capabilities.ts';
import { acceptReply, type ChipOpens } from '../lib/chart-copilot-reply.ts';
import { useChartHistory } from '../lib/use-chart-history.ts';
import { useChartEdits } from '../lib/use-chart-edits.ts';
import {
  CHART_CAPTION_MAX_LENGTH,
  CHART_TITLE_MAX_LENGTH,
  initialDocState,
  newCommandId,
  type ChartCommand,
  type ChartDocState,
  type CommandContext,
} from '../lib/chart-commands.ts';
import {
  areaFormAllowed,
  defaultFormFor,
  dumbbellFormAllowed,
  hbarFormAllowed,
  heatmapFormAllowed,
  isTabularForm,
  lineFormAllowed,
  ownDataFallbackForm,
  ownDataPieFormAllowed,
  ownDataStacked100FormAllowed,
  ownDataStackedFormAllowed,
  slopeFormAllowed,
  type ChartForm,
} from '../lib/chart-view-state.ts';
import { useLang } from '../lib/i18n/lang-provider.tsx';
import { t, type Lang, type MessageKey } from '../lib/i18n/messages.ts';
import { instructionKey, toCommandSpec } from '../lib/user-chart-command-spec.ts';
import { buildUserChartCsv } from '../lib/user-csv.ts';
import {
  AxisTick,
  buildDumbbellRows,
  buildRegionRows,
  buildRows,
  buildStack100Rows,
  AXIS_COLOR,
  baselineAxisLine,
  ChartTooltip,
  GRID_LINE_PROPS,
  heatmapIntensity,
  labelWidthPx,
  RegionTooltip,
  valueLabelPlan,
  yAxisDomain,
  type DumbbellEnd,
  type DumbbellRow,
  type PlottablePoint,
  type PlottableSpec,
  type RegionRow,
  type Row,
  type SeriesMeta,
} from './chart.tsx';
import { ChartConfigTrigger } from './chart-config-trigger.tsx';
import { ChartCopilotInput, type CopilotReply } from './chart-copilot-input.tsx';
import { ChartDataPanel, ChartDataTrigger } from './chart-data-panel.tsx';
import { ChartDownloadMenu } from './chart-download.tsx';
import { ChartSmallMultiples } from './chart-small-multiples.tsx';
import { DownloadCsvButton } from './download-csv-button.tsx';
import { OwnChartPublishButton } from './own-chart-publish-dialog.tsx';
import { buildPublishLog } from '../lib/own-chart-publish-log.ts';
import { ChartEditableText } from './chart-editable-text.tsx';
import { ChartFrame } from './chart-frame.tsx';
import { ChartHistoryActions } from './chart-history-actions.tsx';
import { SeriesLegend } from './chart-series-legend.tsx';
import type { ChartNote, PendingPoint } from './chart-notes.tsx';
import { Skeleton } from './ui/skeleton.tsx';
import type { ClientChartInstruction, DatasetProfile, UserChartSpec } from '../backend/attachments/types.ts';
import { USER_DATA_BADGE } from '../backend/attachments/types.ts';

// Same split as chart.tsx (session 110 perf pass): the always-visible
// trigger is a static import, the 1900-line panel and the notes editor are
// their own on-demand chunks. Both already render nothing while closed, so
// `loading: () => null` reproduces the closed appearance exactly.
const ChartConfigPanel = dynamic(() => import('./chart-config-panel.tsx').then((m) => m.ChartConfigPanel), {
  ssr: false,
  loading: () => <Skeleton className="mt-2 h-32 w-full rounded-lg" />,
});
const ChartNotes = dynamic(() => import('./chart-notes.tsx').then((m) => m.ChartNotes), {
  ssr: false,
  loading: () => null,
});
// Co-pilot phase 4 parity (goal lines / era shading): same two components
// chart.tsx mounts, same lazy-load treatment — both are tier-agnostic
// (chart-goal-line.tsx / chart-era-shading.tsx carry no CBS-specific data in
// their prop contracts) and neither shows anything while closed.
const ChartGoalLine = dynamic(() => import('./chart-goal-line.tsx').then((m) => m.ChartGoalLine), {
  ssr: false,
  loading: () => null,
});
const ChartEraShading = dynamic(() => import('./chart-era-shading.tsx').then((m) => m.ChartEraShading), {
  ssr: false,
  loading: () => null,
});

/** What a card needs to be EDITABLE: which dataset/thread/turn it belongs to
 * (the turn is what a saved command log is keyed on — Task 3's
 * ChartEditsKey), the dataset's closed vocabulary (ADR 037 D6 — without it
 * `setInstruction` cannot validate, which is exactly what keeps an own-data
 * command off a CBS chart, D11), and the instruction this chart was drawn
 * from. Absent → the card renders read-only-ish: every client-side control
 * still works for the session, but nothing persists and there is no data
 * command. */
export interface UserChartEditContext {
  datasetId: number;
  threadId: number;
  turnId: number;
  profile: DatasetProfile;
  lastInstruction: ClientChartInstruction;
  /** Own-data publish (ADR 057, Task 6): `OWN_DATA_PUBLISH_ENABLED`, read
   * ONLY server-side (web/app/workspace/page.tsx) and threaded down as a
   * presence prop (the `attachments` dormancy pattern — see that flag's own
   * comment there), through Workspace → DatasetChat → here, and separately
   * into `deriveDatasetVisuals`'s own `edit` param for a docked visual's
   * `userChartEdit`. `true` on both paths only when the flag is on; absent
   * (`undefined`, same as `false` at the `=== true` check below) for every
   * existing call site/test that hasn't been updated, so the Publish button
   * stays hidden everywhere until the flag is flipped on. */
  publishEnabled?: boolean;
}

/** Own-data publish (ADR 057, Task 4): what the public page (`/embed/own/
 * [publicId]`) hands the card instead of an `UserChartEditContext` — the
 * final, already-pruned view state and the overlays/account style resolved
 * server-side, precomputed (spec §3.3/§3.6). `publicView` and `edit` are
 * mutually exclusive: the public page never has a signed-in reader's account
 * to key edits on, and an authenticated card never has a server-precomputed
 * public payload. */
export interface UserChartPublicView {
  state: PublicChartState;
  /** `ResolvedOverlay` keyed by `DerivedOverlayRequest.id` — a plain record
   * (own-chart-publication.ts's `PublicOwnChart.overlays`, JSON-safe across
   * the server→client boundary), turned into the `Map` this card's own
   * `resolvedOverlays` state already expects. */
  overlays: Record<string, ResolvedOverlay>;
  sourceLine: string | null;
  /** Session 128 (ADR 057 ruling 1, "freeze the look at publish time"): the
   * author's account style AS IT WAS AT PUBLISH TIME — the publication
   * row's own `style` column (`published_user_charts.style`, resolved and
   * validated server-side by `resolveAuthorStyleForPublish`,
   * own-chart-publish-actions.ts), never a live `user_chart_styles` read.
   * Still raw `unknown` at THIS boundary and still re-run through the same
   * `sanitizeOverrides` allow-list every other untrusted overrides input
   * does (below), rather than trusting the page to have done it — a second,
   * cheap sanitisation pass costs nothing and means this card never has to
   * trust that a stored row still matches today's schema. */
  accountStyle: unknown;
  /** Session 128 (ADR 057 ruling 2, "?lang= wins for the chart too"): the
   * public page's own `?lang=` query parameter, already validated
   * (`isLang`) — null when absent or invalid. Precedence for the CHART's
   * own language (`chartLang` below) is this value, when non-null, over the
   * frozen style's `language`, over `'nl'` — the exact reverse of the order
   * `pres.language ?? appLang` used to apply, which let an account style's
   * language silently override an explicit `?lang=` (ADR 057's own "known
   * v1 difference", closed this session). */
  explicitLang: Lang | null;
}

/** Own-data publish (ADR 057, Task 4), requirement 1: the inverse of
 * `pruneForPublic`'s `PublicChartState` projection — reconstructs a real
 * `ChartDocState` for `useChartHistory`'s initial value. The four fields
 * `PublicChartState` deliberately drops (see its own doc comment in
 * own-chart-publication.ts) are set to their "nothing here" value: an
 * anonymous visitor never has a data command (`instruction: null`, own-data
 * has no period zoom (`periodRange: null`), no alternate reading
 * (`selectedReading: null`), and v1 never ships the verified-whole
 * designation publicly (`wholeReferenceRowRef: null`, spec §3.5). */
function chartDocStateFromPublic(pub: PublicChartState): ChartDocState {
  return {
    form: pub.form,
    hiddenKeys: new Set(pub.hiddenKeys),
    dimmedKeys: new Set(pub.dimmedKeys),
    highlightedKey: pub.highlightedKey,
    periodRange: null,
    presentation: pub.presentation,
    selectedReading: null,
    notes: pub.notes,
    title: pub.title,
    caption: pub.caption,
    instruction: null,
    goalLines: pub.goalLines,
    eraShadings: pub.eraShadings,
    headlineOverrideResultId: pub.headlineOverrideResultId,
    derivedOverlayRequests: pub.derivedOverlayRequests,
    wholeReferenceRowRef: null,
  };
}

/** #318: chart.tsx's `tabClass` pill styling for the small-multiples toggle
 * row — the same classes, so the two cards' toggles look identical. */
function pillClass(active: boolean): string {
  return (
    'min-h-11 sm:min-h-6 rounded-full border px-2.5 py-1 text-xs ' +
    (active ? 'border-transparent bg-secondary text-foreground' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground')
  );
}

/** The ONE place a UserChartSpec is narrowed to the minimal shape
 * buildRows/valueLabelPlan need — every plotted string still comes straight
 * from the spec's own `formattedValue`/`xLabel` (R6-analog: no reformatting,
 * no computation), only the field NAMES are adapted. `provisional: false`
 * throughout — this tier has no CBS publication-status concept (D7: v1
 * performs no arithmetic and carries no provisional/definitief distinction
 * at all), so nothing here is ever marked provisional. Exported (Task 5,
 * plan 2026-09-22) so chart-commands-contract.test.tsx's own-data form ↔ tab
 * contract test can hand `ownDataRenderableForms` the SAME adapted shape
 * this card itself renders from, rather than a second, drift-prone copy of
 * this mapping — the same reuse-over-duplicate call Task 4 made exporting
 * derive-overlay.ts's `allResolvedPoints`. */
export function toPlottableSpec(spec: UserChartSpec): PlottableSpec {
  return {
    kind: spec.kind,
    series: spec.series.map((series) => ({
      label: series.label,
      points: series.points.map((point) => ({
        periodCode: point.xKey,
        periodLabel: point.xLabel,
        value: point.value,
        formattedValue: point.formattedValue,
        provisional: false,
        resultId: point.rowRef,
      })),
    })),
  };
}

/** The one line a failed render shows. `invalid` is the reader's own doing
 * (a combination that cannot be drawn); the other two are the dataset or the
 * session having gone away, which already have their own copy elsewhere. */
function failureMessage(outcome: Exclude<RenderDatasetInstructionOutcome, { kind: 'ok' }>): MessageKey {
  if (outcome.kind === 'invalid') return `userChart.renderFailed.${outcome.reason}` as MessageKey;
  return outcome.kind === 'unauthenticated' ? 'common.sessionExpired' : 'datasetChat.notFound';
}

const FORM_TABS: readonly { form: ChartForm; label: MessageKey }[] = [
  { form: 'line', label: 'chart.tabLine' },
  { form: 'area', label: 'chart.form.area' },
  { form: 'bar', label: 'chart.tabBar' },
  { form: 'hbar', label: 'chart.form.hbar' },
  { form: 'table', label: 'chart.tabTable' },
  // Own-data chart-fit parity (plan 2026-09-22, Tasks 1-2): the phase-5 trio
  // trails Tabel in the scorer's own fixed order — dumbbell, slope, heatmap
  // (chart-fit.ts's `allowedForms`; chart.tsx's tabs use the same order).
  // Helling and Warmtekaart were wired in Task 1; the Dumbbell — its own
  // render branch, `UserDumbbellOverlay` below — in Task 2. The list the
  // chat is told about (chart-capabilities.ts's `ownDataRenderableForms`)
  // must never name a form this list lacks.
  { form: 'dumbbell', label: 'chart.form.dumbbell' },
  { form: 'slope', label: 'chart.form.slope' },
  { form: 'heatmap', label: 'chart.form.heatmap' },
  // Own-data verified-whole parity (Task 3): the three whole forms trail
  // Warmtekaart, in the scorer's fixed order — the same tier-neutral tab
  // words chart.tsx uses. UNCONDITIONAL on this tier (see the own-data
  // whole-forms block below): offered on shape alone, always with the note.
  { form: 'pie', label: 'chart.form.pie' },
  { form: 'stacked', label: 'chart.form.stacked' },
  { form: 'stacked100', label: 'chart.form.stacked100' },
];

/** ADR 042's value-label look, copied from chart.tsx (where it is
 * module-private): 12 px with a card-coloured halo, so a label stays legible
 * where it crosses a line or a bar. */
const VALUE_LABEL_PROPS = { fontSize: 12, paintOrder: 'stroke', stroke: 'var(--card)', strokeWidth: 3, strokeLinejoin: 'round' } as const;

/** The `valueLabels` presentation key, honoured (Task 5 review finding
 * IMPORTANT 1: it used to be a live toggle that changed nothing, and the
 * resolver FORCES it on for bar/hbar — "zonder waarden heeft een
 * staafdiagram geen schaal", which was exactly what an own-data bar showed:
 * no number anywhere but the tooltip).
 *
 * The label's text is `row[`${key}_display`]` — the point's OWN
 * `formattedValue`, carried into the row by `buildRows` — so a drawn label
 * is a spec string, never a number this card formatted (the whole-card digit
 * scan pins that). */
function valueLabels(seriesKey: string, position: 'top' | 'right'): ReactNode {
  return <LabelList dataKey={`${seriesKey}_display`} position={position} fill="var(--foreground)" {...VALUE_LABEL_PROPS} />;
}

/** The plot's own dot: the click-to-annotate target (#212) and the marker
 * mode's on/off switch. A simplified `SeriesDot` (chart.tsx) — this tier has
 * no provisional cells and no story ring, so neither the hollow R11 marker
 * nor the ring has anything to draw. Hidden markers stay in the DOM at
 * opacity 0, exactly like the CBS card, so the click targets survive every
 * mode. */
function UserSeriesDot(
  seriesKey: string,
  opacity: number,
  seriesLabel: string,
  onPointClick: ((point: PendingPoint) => void) | undefined,
  geometry: { r: number; ring: number; markers: 'all' | 'ends' | 'provisionalOnly'; ends: SeriesEndpoints | null },
  lang: Lang,
) {
  return function Dot(props: { cx?: number; cy?: number; payload?: Row; stroke?: string }) {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null || !payload) return null;
    if (payload[seriesKey] == null) return null;
    const resultId = payload[`${seriesKey}_resultId`];
    const color = props.stroke ?? 'currentColor';
    const hidden = !markerVisible(geometry.markers, false, String(payload.periodCode), geometry.ends);
    const activate = (): void => {
      if (resultId == null || !onPointClick) return;
      onPointClick({ resultId: String(resultId), periodLabel: String(payload.periodLabel), seriesLabel });
    };
    return (
      <circle
        cx={cx}
        cy={cy}
        r={geometry.r}
        fill={color}
        stroke={color}
        strokeWidth={geometry.ring}
        strokeOpacity={opacity}
        fillOpacity={opacity}
        opacity={hidden ? 0 : undefined}
        data-point="value"
        data-marker={hidden ? 'hidden' : undefined}
        data-result-id={resultId == null ? undefined : String(resultId)}
        role={onPointClick ? 'button' : undefined}
        tabIndex={onPointClick ? 0 : undefined}
        aria-label={onPointClick ? t(lang, 'chart.noteAriaLabel', { series: seriesLabel, period: String(payload.periodLabel) }) : undefined}
        style={onPointClick ? { cursor: 'pointer' } : undefined}
        onClick={onPointClick ? activate : undefined}
        onKeyDown={
          onPointClick
            ? (event: KeyboardEvent<SVGCircleElement>) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                // Row 9 (session 110 UX audit pass 2): Recharts' own wrapper
                // has an Enter handler of its own; a point that activated on
                // this key owns the gesture, like a real <button> would.
                event.stopPropagation();
                activate();
              }
            : undefined
        }
      />
    );
  };
}

/** Draws a resolved derived-overlay value (Task 7 parity) — mirrors
 * chart.tsx's own `derivedOverlayElements` exactly, including WHY it's a
 * plain function returning an array rather than a `<Layer>`-style
 * component: Recharts only recognises known element types (ReferenceLine,
 * ReferenceArea, …) among a chart container's own DIRECT children, so a
 * wrapping component's own ReferenceLines never reach the DOM. Unlike goal
 * lines/era shadings, this label IS server-computed, verified prose (never
 * reader-typed free text), so — same as any other plotted value label on
 * this chart — it gets a `label` prop and DOES enter a PNG/SVG export; R6's
 * digit-guard only ever exempted READER-typed text, never a value this
 * product itself computed and is standing behind. `requests` is
 * state.derivedOverlayRequests (the id -> calcKind/resultIds recipe);
 * `resolvedOverlays` is this render's own resolved-value map — a request
 * with no resolved entry yet (still in flight, or refused) draws nothing. */
function derivedOverlayElements(
  resolvedOverlays: Map<string, ResolvedOverlay>,
  requests: DerivedOverlayRequest[],
  allPoints: PlottablePoint[],
): ReactNode[] {
  return Array.from(resolvedOverlays.entries()).map(([id, result]) => {
    const request = requests.find((r) => r.id === id);
    if (request === undefined) return null;
    const display = formatValueNl(result.value, result.decimals);
    if (request.calcKind === 'mean') {
      return (
        <ReferenceLine
          key={`mean-${id}`}
          y={result.value}
          stroke="var(--accent)"
          strokeDasharray="2 2"
          label={{ value: display, position: 'right' }}
          data-label-for={request.resultIds.join(',')}
        />
      );
    }
    const [refA, refB] = request.resultIds;
    const a = allPoints.find((p) => p.resultId === refA);
    const b = allPoints.find((p) => p.resultId === refB);
    if (a === undefined || b === undefined || a.value === null || b.value === null) return null;
    return (
      <ReferenceLine
        key={`diff-${id}`}
        segment={[
          { x: a.periodLabel, y: a.value },
          { x: b.periodLabel, y: b.value },
        ]}
        stroke="var(--accent)"
        strokeWidth={2}
        label={{ value: result.value >= 0 ? `+${display}` : display, position: 'top' }}
        data-label-for={request.resultIds.join(',')}
      />
    );
  });
}

// ---------------------------------------------------------------------------
// Own-data chart-fit parity (plan 2026-09-22, Task 1): the "Warmtekaart" —
// this card's OWN table rows recoloured. A sibling of chart.tsx's
// `heatmapModel`/`HeatmapGrid` (the same CSS grid with ARIA table
// semantics, the same colour scale, the same "throw on a missing cell"
// stance), rebuilt over the `rows`/`seriesMeta` model `tableNode` below
// renders rather than over a ChartSpec — a UserChartSpec cannot be one
// (ADR 037 H2), so chart.tsx's grid, which takes a ChartSpec, cannot be
// mounted here. Deliberately WITHOUT chart.tsx's bar-kind transposition:
// this card's table never transposes on kind, so neither does its grid.
// ---------------------------------------------------------------------------

/** chart.tsx's `heatmapCellColor`, copied (module-private there, like
 * VALUE_LABEL_PROPS above): the same two `--heatmap-low`/`--heatmap-high`
 * tokens (app/globals.css, light + dark), the same whole-percentage oklch
 * mix — so both cards' grids share one scale and one look. */
function heatmapCellColor(intensity: number): string {
  return `color-mix(in oklch, var(--heatmap-low), var(--heatmap-high) ${Math.round(intensity * 100)}%)`;
}

export interface UserHeatmapCell {
  text: string;
  resultId: string;
  value: number;
}

export interface UserHeatmapModel {
  /** The file's own xHeader, then the series labels — the table's header words. */
  header: string[];
  rows: { key: string; label: string; cells: UserHeatmapCell[] }[];
  /** The grid's own extremes, computed ONCE over every cell — the one scale
   * every cell's colour is read against (equal when every cell holds the
   * same value; `heatmapIntensity` then yields the mid tone for all). */
  min: number;
  max: number;
}

/**
 * One row per x category (the SAME `rows` the table shows, chronological by
 * xKey), one column per series. Every cell is one point's own
 * `formattedValue` (`_display`, carried into the row by `buildRows`) bound
 * to its rowRef (`_resultId`); the colour is a second cue read off that
 * same point's raw value, never the only way a value is shown. A missing
 * intersection cannot occur — `activeForm` is `fallbackForm`'s verdict over
 * this very spec, and `heatmapFormAllowed` only passes when every series
 * carries a real value at every x — so a cell without one is a guard bug:
 * thrown, exactly as chart.tsx's `heatmapModel` does, never painted as an
 * empty or default-coloured cell.
 */
export function userHeatmapModel(xHeader: string, rows: readonly Row[], seriesMeta: readonly SeriesMeta[]): UserHeatmapModel {
  const modelRows = rows.map((row) => ({
    key: String(row.periodCode),
    label: String(row.periodLabel),
    cells: seriesMeta.map((s): UserHeatmapCell => {
      const value = row[s.key];
      const resultId = row[`${s.key}_resultId`];
      if (typeof value !== 'number' || resultId == null) {
        throw new Error(
          `userHeatmapModel: no real value for series "${s.label}" at ${String(row.periodLabel)} — heatmapFormAllowed should have refused this spec`,
        );
      }
      const display = row[`${s.key}_display`];
      return { text: display == null ? '' : String(display), resultId: String(resultId), value };
    }),
  }));
  const values = modelRows.flatMap((row) => row.cells.map((cell) => cell.value));
  return { header: [xHeader, ...seriesMeta.map((s) => s.label)], rows: modelRows, min: Math.min(...values), max: Math.max(...values) };
}

/** The heatmap canvas — chart.tsx's `HeatmapGrid` shape exactly: a CSS grid
 * with ARIA table semantics, rows `display: contents` so the grid lays every
 * row's cells out in shared columns while a screen reader still hears row
 * and column headers. The model is built HERE, inside the component, so it
 * only ever runs while this form is on screen (it throws on a spec the guard
 * would have refused). Its own test id, `user-heatmap-grid`, next to this
 * file's `user-chart-container`/`user-chart-title`: a CBS card and an
 * own-data card can share one page, and a locator must never confuse the
 * two (ADR 037 H2). `pres` does not apply — like the table, no line, grid
 * line or frame to style. */
function UserHeatmapGrid({
  xHeader,
  rows,
  seriesMeta,
  label,
}: {
  xHeader: string;
  rows: readonly Row[];
  seriesMeta: readonly SeriesMeta[];
  label: string;
}) {
  const model = userHeatmapModel(xHeader, rows, seriesMeta);
  const columns = model.header.length - 1;
  return (
    <div
      role="table"
      aria-label={label}
      data-testid="user-heatmap-grid"
      className="grid w-full text-sm"
      style={{ gridTemplateColumns: `max-content repeat(${columns}, minmax(0, 1fr))` }}
    >
      <div role="row" className="contents">
        {model.header.map((h, i) => (
          <div
            key={i}
            role="columnheader"
            className={`border-b border-border px-2 py-1 font-medium text-muted-foreground ${i === 0 ? 'text-left' : 'text-right'}`}
          >
            {h}
          </div>
        ))}
      </div>
      {model.rows.map((row) => (
        <div key={row.key} role="row" className="contents">
          <div role="rowheader" className="border-b border-border px-2 py-1 text-left font-normal text-foreground">
            {row.label}
          </div>
          {row.cells.map((cell, i) => (
            <div
              key={i}
              role="cell"
              data-label-for={cell.resultId}
              className="border-b border-border px-2 py-1 text-right text-foreground tabular-nums"
              style={{ backgroundColor: heatmapCellColor(heatmapIntensity(cell.value, model.min, model.max)) }}
            >
              {cell.text}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Own-data chart-fit parity (plan 2026-09-22, Task 2): the "Dumbbell" —
// chart.tsx's `DumbbellOverlay`, MIRRORED here rather than shared. Its prop
// contract is entirely primitive (no ChartSpec: a row is a key, a label,
// two `DumbbellEnd`s and a `[min, max]` pair), so on that test alone it
// would be extractable — but every way of sharing it edits chart.tsx (an
// `export` on the function and its row type, or moving it plus its two
// module-private constants out and importing them back), and chart.tsx is
// off-limits to this task; and this card's contract genuinely differs in
// two small ways a shared component would have had to grow for: (1) the
// dimming is this card's two-level `opacityFor` (reader-dimmed 0.35,
// highlight-dimmed 0.25 — what every other branch here honours) where
// chart.tsx's overlay knows only a boolean at 0.25; (2) this tier has no
// provisional cells (`toPlottableSpec` sets `provisional: false`
// throughout, ADR 037 D7), so chart.tsx's ' *' label suffix has nothing to
// draw and is left out — the same simplification `UserSeriesDot` above
// makes of `SeriesDot`. What IS reused rather than copied: chart.tsx's
// exported `buildDumbbellRows` (the row model, over this card's own
// `plottable`), its `DumbbellRow`/`DumbbellEnd` types, `labelWidthPx`, and
// chart-view-state.ts's `dumbbellFormAllowed`/`fallbackForm`. The drawing
// itself is the CBS mechanism unchanged: a plain descendant of the
// `<BarChart layout="vertical">` shell reading Recharts' own settled scales
// (`useXAxisScale`/`useYAxisScale`) and painting ordinary SVG inside the
// shared `label` z-index layer; the shell carries NO `<Bar>`.
// ---------------------------------------------------------------------------

/** chart.tsx's `DUMBBELL_DOT_R`/`DUMBBELL_LABEL_GAP_PX`, copied (module-
 * private there, like VALUE_LABEL_PROPS above): the dot radius, and the gap
 * between a dot's edge and its label. */
const DUMBBELL_DOT_R = 5;
const DUMBBELL_LABEL_GAP_PX = 4;

/** A dumbbell row as this card draws it: chart.tsx's pure `DumbbellRow`
 * (its exported `buildDumbbellRows`) plus the SAME resolved colour every
 * other form derives from `seriesMeta`, and this card's own `opacityFor`/
 * `dimmedFor` verdicts, joined in the card on the shared `s${i}` key. */
interface UserDumbbellRow extends DumbbellRow {
  color: string;
  opacity: number;
  dimmed: boolean;
}

/** The category (series) axis tick — chart.tsx's `RegionAxisTick`, copied
 * (module-private there). Recharts' own default axis <Text> measures glyphs
 * and renders NOTHING in jsdom (chart.tsx's own note on that component), so
 * the tick is drawn by this small component instead — which is also what
 * lets a test pin each dot's `cy` against the tick Recharts placed for its
 * row. The payload IS the row's `label` verbatim (a spec string), never
 * invented text — so no `data-label-for` (that contract is for numbers). */
function UserCategoryAxisTick(props: { x?: number | string; y?: number | string; payload?: { value?: unknown } }) {
  const value = props.payload?.value;
  if (typeof value !== 'string' || props.x == null || props.y == null) return null;
  return (
    <text x={props.x} y={props.y} dy={4} fontSize={11} fill={AXIS_COLOR} textAnchor="end" data-role="category-axis-tick">
      {value}
    </text>
  );
}

/** The dumbbell's whole drawing. Per row: a `<line>` from
 * `xScale(from.value)` to `xScale(to.value)` at the row's own category
 * position — `yScale(label, { position: 'middle' })`, the band CENTRE,
 * exactly where Recharts places that row's own axis tick — and a
 * `<circle>` at each end. Every drawn number is that endpoint's own
 * `formattedValue`, rendered as `<text>` beside its dot with
 * `data-label-for="<rowRef>"`, like every other value label on this card.
 * The leftmost dot's label sits to its left and the rightmost dot's to its
 * right (a pixel question settled from the scale's own output, never from
 * comparing the values again), so the two never cross the connector or
 * each other; the shell's x-axis `padding` (sized in the card from the
 * widest label) keeps a label at the domain's edge from running into the
 * series-name column or off the right edge — layout only, the domain
 * itself is never touched. A row whose position the scale cannot resolve
 * is skipped, never approximated. */
function UserDumbbellOverlay({ rows }: { rows: UserDumbbellRow[] }) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  if (!xScale || !yScale || rows.length === 0) return null;
  const positioned = rows
    .map((row) => ({
      row,
      cy: Number(yScale(row.label, { position: 'middle' })),
      xFrom: Number(xScale(row.from.value)),
      xTo: Number(xScale(row.to.value)),
    }))
    .filter((p) => Number.isFinite(p.cy) && Number.isFinite(p.xFrom) && Number.isFinite(p.xTo));
  return (
    <ZIndexLayer zIndex={DefaultZIndexes.label}>
      <g data-role="dumbbell-canvas">
        {positioned.map(({ row, cy, xFrom, xTo }) => {
          const fromIsLeft = xFrom <= xTo;
          const ends: Array<{ end: DumbbellEnd; x: number; side: 'from' | 'to'; leftOf: boolean }> = [
            { end: row.from, x: xFrom, side: 'from', leftOf: fromIsLeft },
            { end: row.to, x: xTo, side: 'to', leftOf: !fromIsLeft },
          ];
          return (
            <g key={row.key} data-role="dumbbell-row" data-series-key={row.key} data-series-dimmed={row.dimmed ? 'true' : undefined}>
              <line x1={xFrom} y1={cy} x2={xTo} y2={cy} stroke={row.color} strokeWidth={2} strokeOpacity={row.opacity} data-role="dumbbell-connector" />
              {ends.map(({ end, x, side, leftOf }) => (
                <g key={side}>
                  <circle
                    cx={x}
                    cy={cy}
                    r={DUMBBELL_DOT_R}
                    fill={row.color}
                    fillOpacity={row.opacity}
                    stroke="var(--card)"
                    strokeWidth={1.5}
                    data-role="dumbbell-dot"
                    data-point={side}
                    data-result-id={end.resultId}
                  />
                  <text
                    x={leftOf ? x - DUMBBELL_DOT_R - DUMBBELL_LABEL_GAP_PX : x + DUMBBELL_DOT_R + DUMBBELL_LABEL_GAP_PX}
                    y={cy + 4}
                    {...VALUE_LABEL_PROPS}
                    fill="var(--foreground)"
                    fillOpacity={row.opacity}
                    textAnchor={leftOf ? 'end' : 'start'}
                    data-role="dumbbell-label"
                    data-point={side}
                    data-label-for={end.resultId}
                  >
                    {end.formattedValue}
                  </text>
                </g>
              ))}
            </g>
          );
        })}
      </g>
    </ZIndexLayer>
  );
}

// ---------------------------------------------------------------------------
// Own-data chart-fit + verified-whole parity (plan 2026-09-22, Task 3): the
// Taartdiagram / Gestapeld / Gestapeld (%) forms, UNCONDITIONAL on this
// tier. chart.tsx offers these three only once a chart's regions are a
// complete, registry-known roster whose parts are checked on demand against
// a CBS-published total (phase 5b). An own-data chart has no registry and
// no independent total to check against, so — the owner's decision, plan
// 2026-09-22 — the three forms are offered on shape alone (chart-view-
// state.ts's `ownData*FormAllowed`, which never read provenance) and ALWAYS
// carry a visible note under the chart saying what has and has not been
// checked (`chart.ownWhole.*`, at the same prominence chart.tsx gives its
// own verified note). This task builds the forms and the ONE default note
// state (nothing designated, nothing checked); Task 4 lets the reader click
// a point to designate it as the total, runs the real arithmetic check, and
// swaps in the other three states — extend `OWN_WHOLE_NOTE` below, keep the
// one <p>.
//
// Reused from chart.tsx rather than copied: `buildRegionRows` (the pie's
// one-row-per-series model), `buildStack100Rows` (the 100%-stacked share
// arithmetic — pure arithmetic over the values on screen; here the
// denominator is simply the sum of the CURRENTLY-DISPLAYED parts for that
// period, with no verification step gating it, because there was never an
// independent total to wait on), `RegionTooltip` and `ChartTooltip`.
// Copied, with the same simplification precedent as UserSeriesDot /
// UserDumbbellOverlay (no provisional cells on this tier, ADR 037 D7, so no
// hatch pattern and no ' *' suffix): chart.tsx's module-private
// `PieSliceLabel` → UserPieSliceLabel, `StackSegment` → UserStackSegment,
// and STACK_LABEL_MIN_HEIGHT_PX. No click affordance on a slice or segment
// yet — chart.tsx's own pie/stack have none either; Task 4's designation
// gesture adds it (role="button" + Enter/Space, like UserSeriesDot).
// ---------------------------------------------------------------------------

/** chart.tsx's `STACK_LABEL_MIN_HEIGHT_PX`, copied (module-private there):
 * the smallest segment a stacked bar still labels — below this height the
 * 12 px label text would overrun its own segment and collide with its
 * neighbours'. A geometry gate ONLY; the tooltip still shows every value. */
const STACK_LABEL_MIN_HEIGHT_PX = 14;

/** One slice of the own-data pie: chart.tsx's exported `RegionRow` (its
 * `buildRegionRows` — one row per series from that series' FIRST point,
 * which `ownDataPieFormAllowed` makes its ONLY point) joined to `seriesMeta`
 * for the key and colour and to this card's `opacityFor`/`dimmedFor`. The
 * same `value_display`/`value_resultId` field names chart.tsx's own pie rows
 * carry, so `RegionTooltip` reads it unchanged. */
interface UserPieRow extends RegionRow {
  key: string;
  color: string;
  opacity: number;
  dimmed: boolean;
}

/** The pie's slice label — chart.tsx's `PieSliceLabel`, copied (module-
 * private there). Recharts' `label` render prop gets the sector entry
 * spread in (`payload` = the row it was built from, plus the anchor
 * `x`/`y`/`textAnchor` it computed at `outerRadius` plus its offset). Draws
 * ONLY the row's own `value_display` — never Recharts' own `percent`, never
 * the raw `value` — bound to its source rowRef via `data-label-for`, like
 * every other value label on this card. A row with no display string draws
 * nothing. */
function UserPieSliceLabel(props: PieLabelRenderProps) {
  const row = (props.payload ?? null) as UserPieRow | null;
  if (row === null || row.value_display == null || props.x == null || props.y == null) return null;
  return (
    <text
      x={props.x}
      y={props.y}
      {...VALUE_LABEL_PROPS}
      fill="var(--foreground)"
      textAnchor={props.textAnchor}
      dominantBaseline="central"
      data-role="pie-label"
      data-label-for={row.value_resultId ?? undefined}
    >
      {row.value_display}
    </text>
  );
}

/** One segment of the stacked / 100%-stacked bar — chart.tsx's
 * `StackSegment`, copied (module-private there), minus the provisional
 * hatch this tier has nothing to draw with. The SAME shape-factory
 * convention as chart.tsx (one instance per series, called once per
 * period), reading the period row's own per-series fields: `valueKey` is
 * what Recharts stacked (`<key>` for stacked — the real value; `<key>_share`
 * for 100%-stacked — the computed share), `labelKey` the text drawn INSIDE
 * the segment (`<key>_display` — the point's own formattedValue; or
 * `<key>_share_label` — the share `buildStack100Rows` formatted). Both are
 * bound to the point's own rowRef via `data-label-for`. A segment shorter
 * than STACK_LABEL_MIN_HEIGHT_PX draws no label (geometry only — the
 * tooltip still shows it).
 *
 * Task 4 adds the designation gesture: `seriesLabel`/`onPointClick`/`lang`
 * mirror `UserSeriesDot`'s own three extra parameters exactly (role="button"
 * + tabIndex + Enter/Space, since a synthetic role on an SVG element gets no
 * native keyboard activation) — `<rect>` is a raw element this function
 * fully controls, so unlike the pie (see UserPieSlice below) there is no
 * Recharts prop-merging to work around.
 *
 * Fix wave (session 124, final-review I2): `designatedRowRef` marks the
 * segment the reader designated as the total — it is still drawn as one of
 * the bar's segments (the reader's own data, never hidden), so without a
 * marker nothing on the chart said WHICH segment the note's "checked
 * against" refers to (and on a derived/aggregate chart, where every series
 * shares one label, the note's `{label}` alone cannot say it either — I3).
 * See `wholeReferenceMarkProps` for the shared marker. */
function UserStackSegment(
  seriesKey: string,
  valueKey: string,
  labelKey: string,
  color: string,
  opacity: number,
  seriesLabel: string,
  onPointClick: ((point: PendingPoint) => void) | undefined,
  lang: Lang,
  designatedRowRef: string | null,
) {
  return function Shape(props: { x?: number; y?: number; width?: number; height?: number; payload?: Row }) {
    const { x, y, width, height, payload } = props;
    if (x == null || y == null || width == null || height == null || !payload) return null;
    const value = payload[valueKey];
    if (value == null) return null;
    const resultId = payload[`${seriesKey}_resultId`];
    const label = payload[labelKey];
    const showLabel = label != null && height >= STACK_LABEL_MIN_HEIGHT_PX;
    const periodLabel = payload.periodLabel;
    const designated = resultId != null && String(resultId) === designatedRowRef;
    const activate = (): void => {
      if (resultId == null || !onPointClick) return;
      onPointClick({ resultId: String(resultId), periodLabel: String(periodLabel), seriesLabel });
    };
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill={color}
          fillOpacity={opacity}
          stroke="var(--card)"
          strokeWidth={1}
          data-point="value"
          data-series-key={seriesKey}
          data-series-dimmed={opacity < 1 ? 'true' : undefined}
          data-result-id={resultId == null ? undefined : String(resultId)}
          {...wholeReferenceMarkProps(designated, onPointClick !== undefined, lang, seriesLabel, String(periodLabel))}
          style={onPointClick ? { cursor: 'pointer' } : undefined}
          onClick={onPointClick ? activate : undefined}
          onKeyDown={
            onPointClick
              ? (event: KeyboardEvent<SVGRectElement>) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  event.stopPropagation();
                  activate();
                }
              : undefined
          }
        />
        {showLabel ? (
          <ZIndexLayer zIndex={DefaultZIndexes.label}>
            <text
              x={x + width / 2}
              y={y + height / 2}
              {...VALUE_LABEL_PROPS}
              fill="var(--foreground)"
              textAnchor="middle"
              dominantBaseline="central"
              data-role="stack-label"
              data-label-for={resultId == null ? undefined : String(resultId)}
            >
              {String(label)}
            </text>
          </ZIndexLayer>
        ) : null}
      </g>
    );
  };
}

/** Fix wave (session 124, final-review I2/I3): the designation affordance
 * and the designated-total marker, shared by `UserPieSlice` and
 * `UserStackSegment` so the two shapes cannot drift. `clickable` false (no
 * edit context — I4) emits nothing interactive at all: no role, no
 * tabIndex, no label offering an action that cannot happen. When
 * clickable, every slice/segment is a toggle button (`aria-pressed`: a
 * second click on the designated one clears it), and the designated one
 * gets a heavy foreground outline — the visible counterpart of the note's
 * "checked against the row you selected", so a reader can see WHICH drawn
 * slice/segment is the total even when its label is shared with another
 * series (a derived/aggregate own-data chart). The outline is presentation
 * only: no value, size, or label changes. These props are spread AFTER
 * the Cell/segment defaults, so the outline wins over the card-colour
 * separator stroke. */
function wholeReferenceMarkProps(designated: boolean, clickable: boolean, lang: Lang, series: string, period: string) {
  return {
    ...(designated ? { stroke: 'var(--foreground)', strokeWidth: 3, 'data-whole-reference': 'true' } : {}),
    'data-command-kind': clickable ? 'setWholeReference' : undefined,
    role: clickable ? 'button' : undefined,
    tabIndex: clickable ? 0 : undefined,
    'aria-pressed': clickable ? designated : undefined,
    'aria-label': clickable
      ? t(lang, designated ? 'chart.ownWhole.designatedAriaLabel' : 'chart.ownWhole.designateAriaLabel', { series, period })
      : undefined,
  };
}

/** The pie's designation gesture (Task 4): a custom `shape` for `<Pie>`.
 * Recharts merges each `<Cell>`'s OWN props (fill, the data-* attributes
 * Task 3 added) into the sector object BEFORE calling this — confirmed by
 * reading node_modules/recharts's own Pie.js — but it ALSO unconditionally
 * hardcodes `tabIndex: -1` on that same object afterward, so a `<Cell
 * tabIndex>` would be silently overwritten and never reach the DOM. A
 * custom `shape` sidesteps this: it receives the SAME Cell-merged props
 * (spread first, so fill/data-* survive unchanged) and renders them through
 * Recharts' own exported `<Sector>` (byte-identical to Recharts' internal
 * default — `defaultPieSectorShape` IS `Sector`) with the interactivity
 * props applied AFTER the spread, so they win. `props.value_resultId`/
 * `.label` are UserPieRow's own fields, carried through the same merge. */
function UserPieSlice(
  periodLabel: string,
  onPointClick: ((point: PendingPoint) => void) | undefined,
  lang: Lang,
  designatedRowRef: string | null,
) {
  // Only the two UserPieRow fields this shape actually reads — NOT
  // `Partial<UserPieRow>`, whose own `key: string` field (the series key,
  // e.g. 's0') collides with React's OWN reserved `key` prop already on
  // PieSectorShapeProps (`Key | null | undefined`) and fails to intersect.
  return function Shape(props: PieSectorShapeProps & { value_resultId?: string | null; label?: string }) {
    // Task 5 fix (found by this task's own e2e run, a real browser: React
    // 19 logs a console error — which this app's e2e harness treats as a
    // hard failure — when a props object carrying a `key` field (Recharts'
    // own merge puts the `<Cell key={r.key}>` React key here too, per the
    // doc comment above) is spread onto JSX. `key` was never read by this
    // component and a `key` on `<Sector>` here would be inert anyway (it is
    // the sole element `Shape` returns, not one of a `.map()`'d list), so it
    // is destructured out and never re-attached, exactly as React's own
    // warning text prescribes.
    const { key: _key, ...sectorProps } = props;
    const resultId = props.value_resultId ?? null;
    const seriesLabel = props.label ?? '';
    const designated = resultId !== null && resultId === designatedRowRef;
    const activate = (): void => {
      if (resultId === null || !onPointClick) return;
      onPointClick({ resultId, periodLabel, seriesLabel });
    };
    return (
      <Sector
        {...sectorProps}
        {...wholeReferenceMarkProps(designated, onPointClick !== undefined, lang, seriesLabel, periodLabel)}
        style={onPointClick ? { cursor: 'pointer' } : undefined}
        onClick={onPointClick ? activate : undefined}
        onKeyDown={
          onPointClick
            ? (event: KeyboardEvent<SVGPathElement>) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                event.stopPropagation();
                activate();
              }
            : undefined
        }
      />
    );
  };
}

/** The own-data whole note's states → the message key and tone each one
 * renders with. Task 3 builds only `not_checked` — the default, shown
 * whenever a whole form is on screen and nothing has been designated. Task
 * 4 adds `checked` (a confirmed tone), `mismatch` and `cannot_check` (a
 * warning tone) HERE, each carrying the designated row's label as
 * `{label}`, and the card picks the state from the designated reference
 * plus the check's outcome. The <p> under the chart (data-testid
 * "own-whole-note", data-state = the key of this map) is the ONE mount
 * point; the 100%-stacked no-share omission is appended to whatever state
 * is current, exactly as chart.tsx appends its own omissions. */
const OWN_WHOLE_NOTE = {
  not_checked: { key: 'chart.ownWhole.notChecked', className: 'text-muted-foreground' },
  // Fix wave (session 124, final-review I4): the same default without the
  // "click a point" invitation, for a card with no edit context — there the
  // slices/segments are not clickable at all (see `wholeDesignationClick`).
  not_checked_read_only: { key: 'chart.ownWhole.notCheckedReadOnly', className: 'text-muted-foreground' },
  // Task 4: the three states once a reader has designated a cell as "this
  // is my total". `text-success`/`text-warning` are this app's own existing
  // semantic tone tokens (globals.css) — chart.tsx's CBS whole-note never
  // needed more than one tone because a mismatch there REFUSES the form
  // outright (never rendered); own-data's note instead has to visually
  // distinguish a confirmed match from a mismatch/can't-check, since all
  // three render the chart in full (the deliberate CBS-vs-own-data
  // difference this task's brief calls out).
  checked: { key: 'chart.ownWhole.checked', className: 'text-success' },
  mismatch: { key: 'chart.ownWhole.mismatch', className: 'text-warning' },
  cannot_check: { key: 'chart.ownWhole.cannotCheck', className: 'text-warning' },
} as const satisfies Record<string, { key: MessageKey; className: string }>;
type OwnWholeNoteState = keyof typeof OWN_WHOLE_NOTE;

/** Task 4: which currently-displayed rowRefs count as "parts" for the
 * designated whole — exactly the set Task 3 already renders (visible
 * series only, per the plan's ratified ruling), MINUS the designated cell
 * itself (summing a "total" as one of its own parts would be nonsensical
 * arithmetic, not a policy choice — verifyPartsSumToWhole is never handed
 * the whole a second time as one of its own parts). Pie has one period by
 * construction, so every OTHER visible slice counts; a stack spans several
 * periods, so only the OTHER visible series AT THE SAME PERIOD as the
 * designated cell count — a stacked bar's "whole" is one full bar (one
 * period), never a sum across unrelated periods, the same "one moment"
 * scoping a pie's whole circle already has.
 *
 * `pieVerificationRows` (Task 4 fix, C1) is deliberately NOT the same array
 * `<Pie>` draws from (`pieRows`, which drops a null-valued row since it
 * cannot be rendered as a slice) — a visible-but-null part must still
 * reach `verifyPartsSumToWhole` as `withheld_member`, never silently
 * vanish from the sum the way it would if this used the rendering-filtered
 * set. See `pieVerificationRows`'s own definition where it is built. */
function wholePartRowRefsFor(
  activeForm: ChartForm,
  wholeRowRef: string | null,
  pieVerificationRows: readonly UserPieRow[],
  rows: readonly Row[],
  visibleSeries: readonly SeriesMeta[],
): string[] {
  if (wholeRowRef === null) return [];
  if (activeForm === 'pie') {
    return pieVerificationRows
      .filter((r) => r.value_resultId !== null && r.value_resultId !== wholeRowRef)
      .map((r) => r.value_resultId as string);
  }
  if (activeForm === 'stacked' || activeForm === 'stacked100') {
    const row = rows.find((r) => visibleSeries.some((s) => r[`${s.key}_resultId`] === wholeRowRef));
    if (row === undefined) return [];
    return visibleSeries
      .map((s) => row[`${s.key}_resultId`])
      .filter((ref): ref is string => typeof ref === 'string' && ref !== wholeRowRef);
  }
  return [];
}

/** Task 4: the designated cell's own human-readable label for the note's
 * `{label}` — the series alone for a pie (one shared period, so naming it
 * again would be redundant), series + period for a stack (a cell is a
 * (series, period) pair, and the SAME series can be designated at more than
 * one period). Mirrors chart-notes.tsx's own "{seriesLabel} · {periodLabel}"
 * join exactly (chart-notes.tsx:122). Falls back to the raw rowRef itself
 * when the designated cell is not among the currently-displayed rows at all
 * (e.g. its series was hidden after designation, or a data edit dropped it)
 * — defensive, not expected on a fresh designation (a reader can only click
 * an already-rendered point), but never blank: the note always names
 * SOMETHING traceable rather than showing nothing. */
function wholeReferenceLabel(
  activeForm: ChartForm,
  wholeRowRef: string,
  pieRows: readonly UserPieRow[],
  rows: readonly Row[],
  visibleSeries: readonly SeriesMeta[],
): string {
  if (activeForm === 'pie') {
    const row = pieRows.find((r) => r.value_resultId === wholeRowRef);
    return row?.label ?? wholeRowRef;
  }
  for (const row of rows) {
    const series = visibleSeries.find((s) => row[`${s.key}_resultId`] === wholeRowRef);
    if (series !== undefined) return `${series.label} · ${String(row.periodLabel)}`;
  }
  return wholeRowRef;
}

/**
 * The card. A thin wrapper around `UserChartCard` whose only job is the
 * spec-swap reset: the visual dock and the chat both hand the SAME mounted
 * element a different chart, and every bit of view state (form, hidden
 * series, notes, title, the rendered-spec cache) belongs to ONE chart.
 * Remounting on a new `spec` object is React's own answer to that, and the
 * card's own re-renders (a data command replaces `activeSpec` INSIDE the
 * card, never the prop) never trip it.
 */
export function UserChartView({
  spec,
  edit,
  publicView,
}: {
  spec: UserChartSpec;
  edit?: UserChartEditContext;
  /** Own-data publish (ADR 057, Task 4). Mutually exclusive with `edit` —
   * the public page never passes `edit`, and an authenticated card is never
   * handed a `publicView`. */
  publicView?: UserChartPublicView;
}) {
  const [epoch, setEpoch] = useState(0);
  const lastSpec = useRef(spec);
  if (lastSpec.current !== spec) {
    lastSpec.current = spec;
    setEpoch((n) => n + 1);
  }
  return <UserChartCard key={epoch} spec={spec} edit={edit} publicView={publicView} />;
}

function UserChartCard({
  spec,
  edit,
  publicView,
}: {
  spec: UserChartSpec;
  edit?: UserChartEditContext;
  publicView?: UserChartPublicView;
}) {
  const domId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const appLang = useLang();
  const { accountStyle, signedIn, setAccountStyle, brandLookupAvailable } = useChartStyle();
  // Own-data publish (ADR 057, Task 4): the ONE boolean every read-only mount
  // point below gates on — `publicView !== undefined`, threaded through
  // rather than re-derived, so `edit`/`publicView` mutual exclusivity is
  // checked once. Requirement 6: the public page has no signed-in reader (no
  // `useChartStyle()` provider account to read), so its own account default
  // — precomputed server-side for the chart's AUTHOR — takes over here,
  // through the SAME sanitiser the context provider itself runs untrusted
  // jsonb through (chart-style-context.tsx's `sanitizeInitial`).
  const publicMode = publicView !== undefined;
  const effectiveAccountStyle = publicView !== undefined ? sanitizeOverrides(publicView.accountStyle) : accountStyle;

  // --- the drawn spec ------------------------------------------------------
  // `activeSpec` is what is on screen. It starts as the prop and is replaced
  // ONLY by a completed `renderDatasetInstruction` — never by anything this
  // component computes itself (every number stays a string the backend
  // produced).
  const [activeSpec, setActiveSpec] = useState(spec);
  const cacheRef = useRef(new Map<string, UserChartSpec>([[instructionKey(edit?.lastInstruction ?? null), spec]]));
  /** Instructions that already came back refused, with the line they showed.
   * Undoing and redoing across a failed data edit must not fire the action
   * again (nor flash a stale chart as if it had worked) — the outcome of a
   * deterministic render over unchanged cells cannot differ the second
   * time. */
  const failedRef = useRef(new Map<string, MessageKey>());
  const [renderFailure, setRenderFailure] = useState<MessageKey | null>(null);
  /** Read by the hydrate `prepare`/`ctx` callbacks, which run long after the
   * render that created them. */
  const activeSpecRef = useRef(activeSpec);
  activeSpecRef.current = activeSpec;

  // --- the command document ------------------------------------------------
  // Own-data publish (ADR 057, Task 4), requirement 1: a public render's
  // initial document is the replayed-and-pruned state the server already
  // computed — never a fresh `initialDocState` (that would drop the
  // author's title/notes/hidden series/etc. a visitor is meant to see).
  const initial =
    publicView !== undefined
      ? chartDocStateFromPublic(publicView.state)
      : initialDocState(defaultFormFor(toCommandSpec(spec)), {}, edit?.lastInstruction ?? null);
  const { state, history, canUndo, canRedo, dispatch, undo, redo, seal, replace } = useChartHistory(initial);

  const plottable = toPlottableSpec(activeSpec);
  const seriesCount = plottable.series.length;
  // Own-data parity (Task 3): `ownDataFallbackForm`, not `fallbackForm` —
  // the shared policy routes pie/stacked/stacked100 through the CBS roster
  // guards, which are false for every own-data spec, so the three forms
  // could never become `activeForm` here. Every other form is the shared
  // policy unchanged (it delegates).
  // Final-review fixes A6/m1/m2 (public mode only): pruneForPublic blanks a
  // hidden series' values to null and keeps only its points at categories a
  // visible series plots — so the two guards that read the SHAPE of every
  // series would refuse a published chart the author's own card draws, and
  // quietly degrade it to the table: the heatmap guard (a real value in
  // every cell) and the pie guard (exactly one point per series — a hidden
  // slice at its own x now has none). In public mode those two run their
  // shape check over the VISIBLE series (the author's card already passed
  // it over all of them, so every visible series still fits) while keeping
  // the FULL series count, exactly as the author's card counts the hidden
  // series. Every other form, and the author's card, keep the shared policy.
  const publicShapeForm = (form: 'heatmap' | 'pie'): ChartForm => {
    const visible = { ...plottable, series: plottable.series.filter((_, i) => !state.hiddenKeys.has(`s${i}`)) };
    const allowed = form === 'heatmap' ? heatmapFormAllowed(visible, seriesCount) : ownDataPieFormAllowed(visible, seriesCount);
    return allowed ? form : 'table';
  };
  const activeForm =
    publicMode && (state.form === 'heatmap' || state.form === 'pie')
      ? publicShapeForm(state.form)
      : ownDataFallbackForm(state.form, plottable, seriesCount);
  // Own-data chart-fit parity (Task 1): the ONE definition of "draws no
  // chart" — the table and the heatmap — shared with chart.tsx and
  // chart-capabilities.ts through chart-view-state.ts's `isTabularForm`, so
  // the three can never disagree about which forms mount no Style panel,
  // legend, notes strip, goal line, era shading, or chat-openable style/
  // notes target. Every former `activeForm !== 'table'` gate below reads
  // THIS, so the heatmap inherits the table's exact treatment.
  const tabularForm = isTabularForm(activeForm);

  // The data command, end to end: an instruction the reader (or a doorway)
  // set becomes a spec. Cache hit → instant, which is what makes Undo/Redo
  // across data edits feel like the rest of the history; miss → one
  // deterministic, free server round trip. A failure leaves the PREVIOUS
  // chart standing with one inline line above it, so the reader can undo.
  const datasetId = edit?.datasetId;
  useEffect(() => {
    if (datasetId === undefined || state.instruction === null) return;
    const key = instructionKey(state.instruction);
    const cached = cacheRef.current.get(key);
    if (cached !== undefined) {
      setActiveSpec(cached);
      setRenderFailure(null);
      return;
    }
    const failed = failedRef.current.get(key);
    if (failed !== undefined) {
      setRenderFailure(failed);
      return;
    }
    let cancelled = false;
    // A new attempt clears the previous line immediately: leaving it up while
    // a different instruction is being drawn would describe the wrong edit.
    setRenderFailure(null);
    void renderDatasetInstruction(datasetId, state.instruction).then((outcome) => {
      if (cancelled) return;
      if (outcome.kind === 'ok') {
        cacheRef.current.set(key, outcome.chart);
        setActiveSpec(outcome.chart);
        setRenderFailure(null);
        return;
      }
      const message = failureMessage(outcome);
      failedRef.current.set(key, message);
      setRenderFailure(message);
    });
    return () => {
      cancelled = true;
    };
  }, [state.instruction, datasetId]);

  // Hydrate's prerequisite (Task 5 review finding): a stored log can contain
  // `setInstruction`, and every command after it names series keys, rowRefs
  // or a form belonging to THAT instruction's spec. So each distinct
  // instruction in the log is rendered into the cache BEFORE the log is
  // replayed, and `ctxForReplay` below then answers per command from the
  // cache. Sequential (the same dataset, one cheap deterministic call each)
  // and failure-tolerant: a refused instruction simply leaves the commands
  // that depended on it to be dropped, exactly as they are today.
  const prepareForReplay = useCallback(
    async (log: ChartCommand[]): Promise<void> => {
      if (datasetId === undefined) return;
      for (const command of log) {
        if (command.kind !== 'setInstruction') continue;
        const key = instructionKey(command.instruction);
        if (cacheRef.current.has(key) || failedRef.current.has(key)) continue;
        const outcome = await renderDatasetInstruction(datasetId, command.instruction);
        if (outcome.kind === 'ok') cacheRef.current.set(key, outcome.chart);
        else failedRef.current.set(key, failureMessage(outcome));
      }
    },
    [datasetId],
  );
  const profile = edit?.profile;
  const ctxForReplay = useCallback(
    (docState: ChartDocState): CommandContext => ({
      spec: toCommandSpec(cacheRef.current.get(instructionKey(docState.instruction)) ?? activeSpecRef.current),
      alternatesCount: 0,
      profile,
    }),
    [profile],
  );

  // Persistence: the same hook, the same rules, as the CBS card — keyed by
  // the dataset turn instead of the audit answer (Task 3). No edit context or
  // no account means no row to key on, and then the hook does nothing at all.
  useChartEdits({
    editsKey: edit !== undefined && signedIn ? { kind: 'turn', id: edit.turnId } : null,
    history,
    replaceHistory: replace,
    ctx: ctxForReplay,
    initial,
    prepare: prepareForReplay,
  });

  // --- presentation --------------------------------------------------------
  const base = withAccountDefault(effectiveAccountStyle);
  const resolved = resolvePresentation({ kind: activeSpec.kind, form: activeForm, seriesCount, hasProvisional: false }, state.presentation, base);
  const pres = resolved.values;
  // Session 128 (ADR 057 ruling 2): public mode uses the page's own
  // explicit `?lang=` (when valid) ahead of the frozen style's own
  // `language` — `pres.language ?? 'nl'` — never `appLang`, which for an
  // /embed/ route already resolves `?lang=` down to a plain `Lang` with NO
  // way left to tell "explicitly set" apart from "absent, fell back to the
  // visitor's own cookie/Accept-Language" (web/proxy.ts's `x-embed-lang` /
  // web/app/layout.tsx's `getLang()`) — exactly the ambiguity this ruling's
  // precedence needs to resolve. Authenticated/edit mode is UNCHANGED:
  // `pres.language ?? appLang`, same as before this session.
  const chartLang: Lang = publicView !== undefined ? (publicView.explicitLang ?? pres.language ?? 'nl') : (pres.language ?? appLang);
  // A chosen font has to be REQUESTED, or the chart silently renders in the
  // fallback stack while the panel says the font is applied (a chart.tsx
  // final-review finding). An uncurated family (a brand font) is requested
  // speculatively: `ensureFontLoaded` only ever adds a <link>, and a family
  // the reader's OS already has renders either way.
  const fontFamily = pres.fontFamily;
  useEffect(() => {
    const font = findFont(fontFamily);
    if (font) ensureFontLoaded(font);
    else if (fontFamily !== null) ensureFontLoaded({ family: fontFamily, source: 'google', stack: fontStack(fontFamily)! });
  }, [fontFamily]);
  const { rows, seriesMeta } = buildRows(plottable, (i) => seriesColor(pres, i));
  // Public mode (A6, requirement 4): a hidden series' slot is kept but
  // blanked, so every LISTING of series — legend, table columns, heatmap
  // rows — leaves it out rather than showing an empty-headed column/row. The
  // author's own card lists every series (a hidden one stays restorable).
  const listedSeriesMeta = publicMode ? seriesMeta.filter((s) => !state.hiddenKeys.has(s.key)) : seriesMeta;
  const plan = valueLabelPlan(plottable);
  const tickByValue = new Map(plan.axisTicks.map((tick) => [tick.value, tick]));
  // Goal lines / era shading (mirrors chart.tsx): a stored command names a
  // periodCode, but the x-axis plots `periodLabel` (buildRows keys rows by
  // it) — this maps one to the other. `periodOptions` is the era-shading
  // form's own Van/Tot list, the first series' points only, same as chart.tsx.
  const periodLabelByCode = new Map(
    plottable.series.flatMap((s) => s.points.map((p): [string, string] => [p.periodCode, p.periodLabel])),
  );
  const periodOptions = plottable.series[0]?.points.map((p) => ({ code: p.periodCode, label: p.periodLabel })) ?? [];
  // Derived overlays (Task 7 parity): every point across every series, the
  // same "flatten once, look up by resultId/rowRef" set derivedOverlayElements
  // needs to draw a resolved difference's two endpoints.
  const allPlottablePoints = plottable.series.flatMap((s) => s.points);

  // --- notes ---------------------------------------------------------------
  const [pendingPoint, setPendingPoint] = useState<PendingPoint | null>(null);
  // A note anchored to a cell the CURRENT chart no longer plots is filtered
  // here rather than deleted: `setInstruction`'s inverse can only be one
  // command (chart-commands.ts), so an undone data change must bring the
  // note back with its data.
  const plottedRowRefs = new Set(activeSpec.series.flatMap((s) => s.points.map((p) => p.rowRef)));
  const visibleNotes = state.notes.filter((note) => plottedRowRefs.has(note.resultId));
  // A7: the eras the public list can name — both ends resolved to a period
  // label the chart plots, exactly the eras the plot itself can place (the
  // ReferenceArea below skips the same unresolvable ones).
  const publicEras = publicMode
    ? state.eraShadings.flatMap((era) => {
        const fromLabel = periodLabelByCode.get(era.fromPeriodCode);
        const toLabel = periodLabelByCode.get(era.toPeriodCode);
        return fromLabel === undefined || toLabel === undefined ? [] : [{ era, fromLabel, toLabel }];
      })
    : [];

  // --- derived overlays (difference / mean) ---------------------------------
  // Mirrors chart.tsx's own Task 7 split exactly: the RECIPE (which points,
  // which calcKind) lives in the undoable command log
  // (state.derivedOverlayRequests); the resolved NUMBER is transient,
  // session-local state here, re-fetched from the server whenever the
  // recipe list changes — never stored in the command log itself.
  // Requirement 2: a public render's overlays come from the server-resolved
  // `publicView.overlays` record, never from the derivation effect below
  // (which bails without `datasetId` — never set in public mode, since
  // `edit` is undefined). Lazy initializer: read once, on mount, like every
  // other `publicView`-derived initial value on this card.
  const [resolvedOverlays, setResolvedOverlays] = useState<Map<string, ResolvedOverlay>>(() =>
    publicView !== undefined ? new Map(Object.entries(publicView.overlays)) : new Map(),
  );
  const [derivationRefusals, setDerivationRefusals] = useState<Map<string, string>>(new Map());
  const [differencePickerActive, setDifferencePickerActive] = useState(false);
  const [firstDifferencePoint, setFirstDifferencePoint] = useState<{ resultId: string; seriesLabel: string } | null>(null);
  const [differenceError, setDifferenceError] = useState<string | null>(null);
  // Task 4 (verified-whole): the SAME "recipe in the undoable log, resolved
  // value transient" split as the derived overlays above —
  // `state.wholeReferenceRowRef` is the undoable designation; this is the
  // check's own OUTCOME, re-run whenever the designation or the currently-
  // displayed parts change (the effect is declared below, once
  // pieVerificationRows/rows are available). Null = nothing designated yet,
  // the request is in flight, it failed/rejected, or its parts list was
  // empty (nothing to check) — every one of those correctly falls back to
  // Task 3's `not_checked` note, never a stale or fabricated verdict. This
  // is a GUARANTEE the effect enforces explicitly (it clears this to null
  // the moment a new request starts and on a rejected round trip too — the
  // I1 fix, adversarial review), not merely an initial-render coincidence:
  // without that explicit clear, a designation whose PARTS changed while a
  // PREVIOUS verdict was already showing would keep rendering the old,
  // now-stale verdict while the new one was still in flight.
  //
  // Fix wave (session 124, final-review I1): the effect's clear alone left
  // a gap — an effect runs AFTER the render that changed the designation is
  // committed, so a re-designation (A → B) committed one frame showing A's
  // "Checked" verdict under B's label before the clear landed. The outcome
  // is therefore stored WITH the exact inputs it verified (`key` =
  // instruction + designated rowRef + parts), and the render only ever
  // reads it when that key equals the CURRENT inputs (see
  // `currentWholeVerification` below) — a verdict can no longer be shown
  // for anything it did not check, whatever the effect's timing. The
  // effect's own clears stay as belt-and-braces.
  const [wholeVerification, setWholeVerification] = useState<{ key: string; outcome: VerifyOutcome } | null>(null);

  useEffect(() => {
    if (datasetId === undefined || state.instruction === null) return;
    let cancelled = false;
    const requests = state.derivedOverlayRequests;
    void Promise.all(
      requests.map(async (r) => [r.id, await requestDatasetDerivation(datasetId, state.instruction, r.calcKind, r.resultIds)] as const),
    ).then((settled) => {
      if (cancelled) return;
      const resolved = new Map<string, ResolvedOverlay>();
      const refusals = new Map<string, string>();
      for (const [id, response] of settled) {
        if (response.ok) resolved.set(id, response.result);
        else refusals.set(id, response.reason ?? t(chartLang, 'chart.derived.errorGeneric'));
      }
      setResolvedOverlays(resolved);
      setDerivationRefusals(refusals);
    });
    return () => {
      cancelled = true;
    };
  }, [state.derivedOverlayRequests, state.instruction, datasetId, chartLang]);

  // Task 7 parity: capture points for a difference overlay when the picker
  // is active; otherwise a click opens the note UI, same as before this
  // task. Mirrors chart.tsx's onPointClick exactly, using seriesLabel where
  // the CBS card compares regionCode — own-data's equivalent "these two
  // points must be comparable" constraint: a difference is between two
  // points of the SAME series, never across series.
  //
  // Task 4 adds a THIRD mode, checked FIRST: a pie slice / stack segment
  // click always means "designate/clear the whole reference" — never the
  // note draft or the difference picker. This cannot collide with the other
  // two modes because it is gated on `activeForm` itself, and pie/stack are
  // the ONLY forms whose render branches ever call `onPointClick` with a
  // whole form active — line/bar/dumbbell dots (the note draft's and the
  // difference picker's own entry points) only render when `activeForm` is
  // none of the three whole forms, and the difference-picker toggle button
  // is itself only mounted for line/area (see the `activeForm === 'line' ||
  // activeForm === 'area'` gate further down) — so `differencePickerActive`
  // can never be true while a whole form is showing either. A second click
  // on the ALREADY-designated cell clears it (`setHeadlineOverride`'s own
  // "pick one point, or clear it" toggle convention).
  const onPointClick = useCallback(
    (point: PendingPoint) => {
      if (activeForm === 'pie' || activeForm === 'stacked' || activeForm === 'stacked100') {
        const next = state.wholeReferenceRowRef === point.resultId ? null : point.resultId;
        dispatch({ kind: 'setWholeReference', rowRef: next }, 'panel');
        return;
      }
      if (differencePickerActive) {
        if (firstDifferencePoint === null) {
          setFirstDifferencePoint({ resultId: point.resultId, seriesLabel: point.seriesLabel });
          return;
        }
        setDifferenceError(null);
        if (firstDifferencePoint.seriesLabel !== point.seriesLabel) {
          setDifferenceError(t(chartLang, 'chart.derived.errorMissingRegion'));
          setFirstDifferencePoint(null);
          return;
        }
        dispatch(
          {
            kind: 'addDerivedOverlay',
            overlay: { id: newCommandId(), calcKind: 'difference', resultIds: [firstDifferencePoint.resultId, point.resultId] },
          },
          'panel',
        );
        setDifferencePickerActive(false);
        setFirstDifferencePoint(null);
        return;
      }
      setPendingPoint(point);
    },
    [activeForm, state.wholeReferenceRowRef, differencePickerActive, firstDifferencePoint, chartLang, dispatch],
  );
  // Fix wave (session 124, final-review I4): the pie/stack designation
  // click is only offered when a check can actually run — it needs a real
  // server round trip (requestDatasetWholeVerification needs `datasetId`
  // and the instruction the chart was rendered from), exactly like the
  // difference/average controls' `edit !== undefined` gate further down
  // (the silently-broken-doorway class #310 closed). Without it, a slice
  // was clickable, announced itself as a button, and did nothing. The
  // line/bar note-draft clicks keep the plain `onPointClick` — they need no
  // server.
  const wholeDesignationClick = datasetId !== undefined && state.instruction !== null ? onPointClick : undefined;

  // --- the style panel -----------------------------------------------------
  const [styleOpen, setStyleOpen] = useState(false);

  // --- small multiples (#318, session 126) ----------------------------------
  // CBS parity: one mini line chart per series, same line-only rule and the
  // same gate as chart.tsx (`activeForm === 'line'` and more than one
  // series). View-only local state, like chart.tsx's — not a stored command,
  // so it neither enters the history nor the saved edit log. `smallMultiplesOn`
  // is the ONE compound every branch below reads, so switching to another
  // form while it is on can never leave a half-applied view behind (the
  // chart.tsx final-review lesson).
  const [smallMultiples, setSmallMultiples] = useState(false);
  const [axisMode, setAxisMode] = useState<'shared' | 'own'>('shared');
  const smallMultiplesOn = smallMultiples && activeForm === 'line' && seriesMeta.length > 1;
  const styleTriggerId = `${domId}-style-trigger`;
  const styleControlsId = `${domId}-style`;
  const panelId = `${domId}-panel`;

  // --- the Data panel (Task 6) ---------------------------------------------
  // Doorway A for a data command. Offered only with an edit context: without
  // the dataset's profile there is nothing to validate an instruction
  // against (the ADR 037 D11 guard), and without an instruction there is
  // nothing to patch.
  const [dataOpen, setDataOpen] = useState(false);
  const dataTriggerId = `${domId}-data-trigger`;
  const dataControlsId = `${domId}-data`;
  // One object rather than a boolean, so the two values the panel needs are
  // narrowed once here instead of asserted at the mount point.
  const dataEdit = profile !== undefined && state.instruction !== null ? { profile, instruction: state.instruction } : null;

  // --- text ----------------------------------------------------------------
  // Task 4 review carry-over: `pruneForPublic` blanks a hidden series' own
  // `yHeaders` entry to `''` (own-chart-publication.ts), and can blank every
  // one of them (a chart with just one series, hidden). Joining the raw
  // array would then render a bare ", " or an empty `y` — filtered here, in
  // EVERY mode (harmless on the author's own card, whose headers are never
  // blank), with a fallback heading naming only `x` when nothing is left.
  const visibleYHeaders = activeSpec.yHeaders.filter((h) => h !== '');
  const heading =
    visibleYHeaders.length > 0
      ? t(chartLang, 'userChart.heading', { y: visibleYHeaders.join(', '), x: activeSpec.xHeader })
      : t(chartLang, 'userChart.headingXOnly', { x: activeSpec.xHeader });
  const accessibleName = t(chartLang, 'userChart.accessibleName', { heading: state.title ?? heading });
  const uploadedOn = activeSpec.provenance.capturedAt.slice(0, 10);
  // `rows.length` is THIS CHART's own plotted x-categories (post filter/limit)
  // — not the dataset's total row count (the profile card shows that,
  // elsewhere) — worded "points plotted" so the two are never conflated.
  const provenanceLine = t(chartLang, 'userChart.provenanceLine', {
    file: activeSpec.provenance.displayName,
    date: uploadedOn,
    count: rows.length,
  });
  // Requirement 5: the public page's own provenance line — never the file
  // name (already scrubbed to '' by pruneForPublic; §3.5 — this line simply
  // never reads `activeSpec.provenance.displayName` at all in public mode),
  // the author's own optional source text or the generic fallback.
  const publicSourceLine =
    publicView !== undefined
      ? t(chartLang, 'ownChart.public.sourceLine', {
          source: publicView.sourceLine ?? t(chartLang, 'ownChart.public.sourceDefault'),
        })
      : null;

  // --- keyboard ------------------------------------------------------------
  // Fix round 1 (I1): a public visitor has no history to undo/redo at all
  // (no `dispatch` ever runs) — ⌘Z/⌘⇧Z/Ctrl+Y are simply not this card's
  // keys to intercept in public mode, same as the CBS card's `embedMode`.
  function onHistoryKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (publicMode) return;
    if (!(event.metaKey || event.ctrlKey)) return;
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
    const key = event.key.toLowerCase();
    if (key === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (key === 'y' && event.ctrlKey) {
      event.preventDefault();
      redo();
    }
  }

  // --- the form tabs -------------------------------------------------------
  const tabRefs = useRef<Partial<Record<ChartForm, HTMLButtonElement | null>>>({});
  function formAllowed(form: ChartForm): boolean {
    if (form === 'line') return lineFormAllowed(plottable, seriesCount);
    if (form === 'area') return areaFormAllowed(plottable, seriesCount);
    if (form === 'hbar') return hbarFormAllowed(plottable);
    // Own-data chart-fit parity (Tasks 1-2): the SAME shape guards
    // chart.tsx's canUseDumbbell/canUseSlope/canUseHeatmap read, over
    // `plottable` — the spec that is actually drawn. This card has no zoom
    // window and no alternate reading, so unlike chart.tsx there is no
    // separate view spec to guard against: `activeForm` above already runs
    // `fallbackForm` over this same `plottable`, which is what keeps
    // `userHeatmapModel`'s throw unreachable and `buildDumbbellRows` from
    // ever drawing a half-empty dumbbell.
    if (form === 'dumbbell') return dumbbellFormAllowed(plottable, seriesCount);
    if (form === 'slope') return slopeFormAllowed(plottable, seriesCount);
    if (form === 'heatmap') return heatmapFormAllowed(plottable, seriesCount);
    // Own-data verified-whole parity (Task 3): the three whole forms on
    // SHAPE alone — own-data's own guards, never chart.tsx's roster-gated
    // pieFormAllowed/stackedFormAllowed/stacked100FormAllowed, which would
    // disable all three on every own-data spec (see chart-view-state.ts).
    if (form === 'pie') return ownDataPieFormAllowed(plottable, seriesCount);
    if (form === 'stacked') return ownDataStackedFormAllowed(plottable, seriesCount);
    if (form === 'stacked100') return ownDataStacked100FormAllowed(plottable, seriesCount);
    return true;
  }
  function formReason(form: ChartForm): string | undefined {
    if (form === 'line') return t(chartLang, 'chart.lineDisabledReason');
    if (form === 'area')
      return activeSpec.kind === 'line'
        ? t(chartLang, 'chart.formReason.areaMultiSeries')
        : t(chartLang, 'chart.formReason.areaComparison');
    if (form === 'hbar') return t(chartLang, 'chart.formReason.hbarTimeSeries');
    if (form === 'dumbbell') return t(chartLang, 'chart.dumbbellDisabledReason');
    if (form === 'slope') return t(chartLang, 'chart.slopeDisabledReason');
    if (form === 'heatmap') return t(chartLang, 'chart.heatmapDisabledReason');
    // Own-data's OWN reasons (shape only) — chart.tsx's name the CBS roster
    // condition, which is never what is missing on this tier.
    if (form === 'pie') return t(chartLang, 'chart.ownWhole.pieDisabledReason');
    if (form === 'stacked' || form === 'stacked100') return t(chartLang, 'chart.ownWhole.stackedDisabledReason');
    return undefined;
  }
  function selectForm(next: ChartForm): void {
    // Neither tabular form (Tabel, Warmtekaart) has a frame or a Style panel
    // at all, so switching to one closes the panel rather than leaving
    // `styleOpen` stuck on a hidden region.
    if (isTabularForm(next)) setStyleOpen(false);
    dispatch({ kind: 'setForm', form: next }, 'panel');
    tabRefs.current[next]?.focus();
  }
  function onFormTabKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const order = FORM_TABS.filter((tab) => formAllowed(tab.form)).map((tab) => tab.form);
    const dir = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const idx = order.indexOf(activeForm);
    selectForm(order[(idx + dir + order.length) % order.length]!);
  }

  // --- the chat doorway (Task 8) -------------------------------------------
  // Doorway B, with the same prerequisite as the Data panel: no profile, no
  // instruction, no chat (there would be nothing to validate a data command
  // against — the ADR 037 D11 guard).
  const [copilotBusy, setCopilotBusy] = useState(false);
  const [copilotReply, setCopilotReply] = useState<CopilotReply | null>(null);
  const [copilotError, setCopilotError] = useState<string | null>(null);
  /** The notes strip, so a "Notities" chip can put the reader there. */
  const notesRef = useRef<HTMLDivElement>(null);

  function openCopilotTarget(target: ChipOpens): void {
    if (target === 'data') setDataOpen(true);
    else if (target === 'style') setStyleOpen(true);
    else if (target === 'form') tabRefs.current[activeForm]?.focus();
    else if (target === 'notes') notesRef.current?.focus();
  }

  /** The reply, accepted. Every branch ends in ONE `copilotReply` or ONE
   * error line — never both, and never a chart this card did not validate. */
  function applyCopilotOutcome(message: string, outcome: AdjustDatasetChartOutcome): void {
    if (outcome.kind === 'unauthenticated') {
      setCopilotError(t(chartLang, 'common.sessionExpired'));
      return;
    }
    if (outcome.kind === 'duplicate_request') {
      // The same requestId was already settled, so there is no envelope to
      // apply — and unlike a question turn (DatasetChat swallows this one)
      // the reader is looking at a chart that may already carry the edit.
      // Say so rather than leaving the send look like it did nothing.
      setCopilotError(t(chartLang, 'chart.copilot.error.duplicate'));
      return;
    }
    if (outcome.kind === 'insufficient_credits') {
      setCopilotError(t(chartLang, 'datasetChat.insufficientCredits', { required: outcome.required, balance: outcome.balance }));
      return;
    }
    if (outcome.kind === 'not_found' || outcome.kind === 'needs_decision') {
      setCopilotError(t(chartLang, 'datasetChat.notFound'));
      return;
    }
    const envelope = outcome.envelope;
    // `canUndo` is recomputed per render at the mount point; `false` here is
    // just the initial value for a reply with nothing to undo.
    const base = { text: envelope.text, turnId: outcome.auditId, netCost: outcome.netCost, message, undone: false, canUndo: false };
    if (envelope.kind !== 'chart' || envelope.copilot === undefined) {
      // A clarification or a refusal: the turn's own deterministic text, and
      // nothing to apply.
      setCopilotReply({ ...base, applied: [], refused: [], dropped: 0, commandIds: [] });
      return;
    }
    // The chart the reply's own `setInstruction` draws came WITH the envelope,
    // so it goes into the cache BEFORE anything is dispatched — the render
    // effect then hits the cache instead of making a second (free, but
    // pointless) round trip for a chart we already hold.
    //
    // KEY EQUALITY, relied on here: `envelope.state.lastInstruction` and the
    // stored `setInstruction.instruction` are the SAME value — copilot/
    // respond.ts builds both from one `toClientInstruction(next)` call — and
    // `instructionKey` is JSON.stringify, so their field order (fixed by that
    // one function) matches too. If the two ever diverge the effect simply
    // misses the cache and re-renders deterministically, so this is a
    // performance assumption, never a correctness one.
    cacheRef.current.set(instructionKey(envelope.state.lastInstruction), envelope.chart);
    const ctx: CommandContext = { spec: toCommandSpec(envelope.chart), alternatesCount: 0, profile };
    const { applied, dropped } = acceptReply(envelope.copilot.commands, ctx, chartLang);
    // `source: 'chat'` — the history menu shows WHICH doorway made each
    // change, and the ids are what one "undo this reply" walks back.
    const commandIds = applied.map((chip) => dispatch(chip.command, 'chat'));
    setCopilotReply({ ...base, applied, refused: envelope.copilot.refused, dropped, commandIds });
  }

  async function sendToCopilot(message: string): Promise<void> {
    // Final review (session 113): with a failed render on screen, the held
    // instruction is one this chart could not draw — sending it would spend
    // a credit on a turn the server refuses as `internal`. The composer is
    // disabled for the same reason; this is the belt behind it.
    if (edit === undefined || state.instruction === null || copilotBusy || renderFailure !== null) return;
    setCopilotBusy(true);
    setCopilotError(null);
    setCopilotReply(null);
    try {
      const outcome = await adjustDatasetChart(
        edit.datasetId,
        edit.threadId,
        edit.turnId,
        message,
        // One fresh id per submit — so a Retry is a genuinely new turn rather
        // than a replay of the charged one (chat.tsx's own convention).
        crypto.randomUUID(),
        state.instruction,
        ownDataCapabilities({ spec: plottable, form: activeForm, seriesCount, applicable: resolved.applicable, lang: chartLang }),
      );
      applyCopilotOutcome(message, outcome);
    } catch {
      setCopilotError(t(chartLang, 'chart.copilot.error.failed'));
    } finally {
      setCopilotBusy(false);
    }
  }

  /** Whether the group Undo would still do anything: the top of the history
   * has to be one of THIS reply's own commands. Recomputed every render, so a
   * change the reader makes afterwards disables the button (with its reason)
   * instead of leaving one that silently does nothing. */
  function replyIsUndoable(reply: CopilotReply): boolean {
    if (reply.undone || reply.commandIds.length === 0) return false;
    const top = history.past[history.past.length - 1];
    return top !== undefined && reply.commandIds.includes(top.command.id);
  }

  /** One Undo for the whole reply: walk back exactly the trailing run of
   * commands THIS reply dispatched, so a change the reader made afterwards is
   * never swept away with it. The chips then stay as a struck-through record
   * of what the reply had done; its text, Retry and the vote stay too. */
  function undoCopilotReply(ids: string[]): void {
    let n = 0;
    for (let i = history.past.length - 1; i >= 0 && ids.includes(history.past[i]!.command.id); i--) n++;
    if (n === 0) return;
    for (; n > 0; n--) undo();
    setCopilotReply((reply) => (reply === null ? null : { ...reply, undone: true }));
  }

  /** Which doorway a reply chip can actually open right now. A tabular form
   * (Tabel, Warmtekaart) mounts neither the Style panel nor the notes strip,
   * so a chip pointing at either must not look clickable there. */
  function copilotCanOpen(target: ChipOpens): boolean {
    if (target === 'none') return false;
    if (target === 'style' || target === 'notes') return !tabularForm;
    return true;
  }

  // --- the plot ------------------------------------------------------------
  const endpointsByKey = new Map<string, SeriesEndpoints>(
    plottable.series.map((series, i): [string, SeriesEndpoints] => {
      const plotted = series.points.filter((p) => p.value !== null);
      return [`s${i}`, { first: plotted[0]?.periodCode ?? '', last: plotted[plotted.length - 1]?.periodCode ?? '' }];
    }),
  );
  const visibleSeries = seriesMeta.filter((s) => !state.hiddenKeys.has(s.key));
  // #314 (session 124): the points on screen whose value is real arithmetic
  // over FEWER cells than their group has (execute.ts's `incomplete` — a
  // sum/mean/min/max that skipped an empty or non-numeric cell, or a share/
  // difference/%-change built on one). The number itself stays as computed
  // (spreadsheet semantics); the card names these points under the chart so
  // a partial total never passes for a complete one (principle c). Labels
  // are the spec's own strings — the note adds no digit of its own, keeping
  // the card's whole-DOM digit scan intact.
  const INCOMPLETE_NOTE_MAX = 3;
  const incompletePointLabels = activeSpec.series.flatMap((series, i) => {
    const key = seriesMeta[i]?.key;
    if (key === undefined || state.hiddenKeys.has(key)) return [];
    return series.points
      .filter((p) => p.incomplete === true && p.value !== null)
      .map((p) => (activeSpec.series.length > 1 ? `${series.label} · ${p.xLabel}` : p.xLabel));
  });
  const incompleteNoteLabels =
    incompletePointLabels.length > INCOMPLETE_NOTE_MAX
      ? `${incompletePointLabels.slice(0, INCOMPLETE_NOTE_MAX).join('; ')}; …`
      : incompletePointLabels.join('; ');
  // Returns the opacity value for a series: 0.35 for user-dimmed, 0.25 for
  // highlight-dimmed, 1 otherwise. Replaces the old boolean dimmedFor that only
  // checked highlight state.
  const opacityFor = (s: SeriesMeta): number => {
    const dimmedByUser = state.dimmedKeys.has(s.key);
    const dimmedByHighlight = state.highlightedKey !== null && state.highlightedKey !== s.key;
    return dimmedByUser ? 0.35 : dimmedByHighlight ? 0.25 : 1;
  };
  const dimmedFor = (s: SeriesMeta): boolean => state.dimmedKeys.has(s.key) || (state.highlightedKey !== null && state.highlightedKey !== s.key);
  // Own-data chart-fit parity (Task 2): the dumbbell's OWN row model — one
  // row per series from chart.tsx's exported `buildDumbbellRows` over the
  // SAME `plottable` every other form here reads (so `activeForm`'s guard
  // and the rows it draws can never disagree), joined to `seriesMeta` on the
  // shared `s${i}` key for colour and to this card's `opacityFor`/`dimmedFor`
  // exactly like the line and bar branches. Hidden rows are DROPPED, order
  // kept (`visibleSeries`' own rule). The category-axis width and the
  // x-axis padding are sized over ALL rows — chart.tsx's `hbarYAxisWidth`/
  // `dumbbellLabelPadPx` rule, through the same exported `labelWidthPx`
  // estimate — so hiding a series never shifts the rows that stay.
  const seriesMetaByKey = new Map(seriesMeta.map((s) => [s.key, s]));
  const dumbbellRowsAll = buildDumbbellRows(plottable).flatMap((row): UserDumbbellRow[] => {
    const meta = seriesMetaByKey.get(row.key);
    return meta === undefined ? [] : [{ ...row, color: meta.color, opacity: opacityFor(meta), dimmed: dimmedFor(meta) }];
  });
  const visibleDumbbellRows = dumbbellRowsAll.filter((row) => !state.hiddenKeys.has(row.key));
  const longestDumbbellRowLabel = dumbbellRowsAll.reduce((longest, row) => (row.label.length > longest.length ? row.label : longest), '');
  const dumbbellYAxisWidth = Math.min(160, Math.max(48, labelWidthPx(longestDumbbellRowLabel)));
  const longestDumbbellValue = dumbbellRowsAll.reduce((longest, row) => {
    for (const end of [row.from, row.to]) {
      if (end.formattedValue.length > longest.length) longest = end.formattedValue;
    }
    return longest;
  }, '');
  const dumbbellLabelPadPx = longestDumbbellValue ? labelWidthPx(longestDumbbellValue) : 8;
  // Own-data verified-whole parity (Task 3): the whole forms' row models.
  // The pie: one row per series from chart.tsx's exported `buildRegionRows`
  // over the SAME `plottable` (each series' first point — its only one, per
  // ownDataPieFormAllowed), joined to `seriesMeta` on index (both iterate
  // `plottable.series` in spec order, R6) for key and colour and to this
  // card's opacityFor/dimmedFor. Hidden series are DROPPED (this card's
  // legend rule); a null value has no angle and is dropped too. The tooltip
  // names the ONE period every drawn slice shares, else the generic value
  // header — chart.tsx's own `regionPeriodLabel` fallback.
  const wholeForm = activeForm === 'pie' || activeForm === 'stacked' || activeForm === 'stacked100';
  const pieRows: UserPieRow[] = buildRegionRows(plottable, (i) => seriesColor(pres, i)).rows.flatMap((row, i): UserPieRow[] => {
    const meta = seriesMeta[i];
    if (meta === undefined || row.value === null || state.hiddenKeys.has(meta.key)) return [];
    return [{ ...row, key: meta.key, color: meta.color, opacity: opacityFor(meta), dimmed: dimmedFor(meta) }];
  });
  // Task 4 fix (C1, adversarial review): a SEPARATE resolution of the SAME
  // underlying rows for VERIFICATION. `pieRows` above is correct for
  // RENDERING (a null value has no angle, so Task 3 drops it — you cannot
  // draw a slice for "unknown"), but reusing it for the "parts" a
  // designated whole is checked against silently drops a genuinely
  // withheld/blank member from the sum instead of counting it as unknown —
  // arithmetically identical to treating it as zero, exactly the
  // fabrication class verifyPartsSumToWhole exists to catch (it already has
  // a 'withheld_member' refusal for precisely this case). Filtered by
  // `hiddenKeys` ONLY, never by value-nullness, so a visible-but-null row's
  // own `value_resultId` survives through to `wholePartRowRefsFor`'s pie
  // branch — `buildRegionRows` itself always carries a point's resultId
  // regardless of whether its value is null (only a MISSING point at all
  // — no series entry — has a null resultId), the same reason the stack
  // path (built from `buildRows`, never filtered by null-ness at all) never
  // had this bug in the first place.
  const pieVerificationRows: UserPieRow[] = buildRegionRows(plottable, (i) => seriesColor(pres, i)).rows.flatMap((row, i): UserPieRow[] => {
    const meta = seriesMeta[i];
    if (meta === undefined || state.hiddenKeys.has(meta.key)) return [];
    return [{ ...row, key: meta.key, color: meta.color, opacity: opacityFor(meta), dimmed: dimmedFor(meta) }];
  });
  const piePeriodLabels = new Set(plottable.series.flatMap((s) => s.points.map((p) => p.periodLabel)));
  const pieSharedPeriodLabel = piePeriodLabels.size === 1 ? [...piePeriodLabels][0]! : t(chartLang, 'chart.table.value');
  // The stacks: the SAME period × series `rows` the vertical bar draws, one
  // `<Bar stackId="whole">` per VISIBLE series — every period, since no
  // verification gates a period on this tier. 100%-stacked: chart.tsx's
  // exported `buildStack100Rows` over the VISIBLE series' keys only, so each
  // share's denominator is the sum of the parts actually on screen for that
  // period (a hidden series is not a part of what is displayed) — and every
  // period counts as "verified", by construction: nothing to wait on. A
  // period where a displayed part is missing (a null cell) or negative, or
  // whose parts add up to zero, has no honest share: `buildStack100Rows`
  // omits it and the note under the chart names it by its own label
  // (chart.tsx's omittedNoShare convention). Built only in that form — the
  // arithmetic is cheap, but nothing else reads it.
  const stack100 =
    activeForm === 'stacked100'
      ? buildStack100Rows(
          rows,
          visibleSeries.map((s) => s.key),
          new Set(rows.map((r) => String(r.periodCode))),
        )
      : { rows: [] as Row[], omitted: [] as string[] };
  const stackNoShareLabels = stack100.omitted.map((code) => {
    const row = rows.find((r) => String(r.periodCode) === code);
    return row ? String(row.periodLabel) : code;
  });
  // Task 4: re-run the check whenever the designation or the currently-
  // displayed parts change. Depends on `activeSpec`/`state.hiddenKeys`
  // (real state, stable across an unrelated re-render) rather than
  // `pieVerificationRows`/`rows`/`visibleSeries` directly (fresh array
  // references every render, which would re-fetch on every unrelated
  // re-render too): the effect only re-executes when one of the
  // DEPENDENCIES below actually changes, and when it does, it reads the
  // CURRENT render's freshly-computed pieVerificationRows/rows/visibleSeries
  // via closure — the same "recomputed together" guarantee Task 3's own
  // render already relies on. Clearing the designation (rowRef: null)
  // reverts to Task 3's exact default note instantly, with no network round
  // trip. Also bails while NOT viewing a whole form (a designation survives
  // a tab switch away, but the note — and any reason to re-verify — only
  // exists while wholeForm is true; without this a switch to Lijn/Staaf/etc.
  // would still fire a pointless network call for a note nothing renders).
  // Fix wave (I1): the parts list and the verdict's identity key are
  // computed ONCE per render and shared by the effect (which requests a
  // check for exactly this key) and the note (which only shows a verdict
  // whose key matches) — so the two can never disagree about what was
  // checked.
  const wholePartRowRefs =
    wholeForm && state.wholeReferenceRowRef !== null
      ? wholePartRowRefsFor(activeForm, state.wholeReferenceRowRef, pieVerificationRows, rows, visibleSeries)
      : [];
  const wholeVerificationKey = JSON.stringify([instructionKey(state.instruction), state.wholeReferenceRowRef, wholePartRowRefs]);
  const currentWholeVerification = wholeVerification !== null && wholeVerification.key === wholeVerificationKey ? wholeVerification.outcome : null;
  useEffect(() => {
    if (!wholeForm || state.wholeReferenceRowRef === null || datasetId === undefined || state.instruction === null) {
      setWholeVerification(null);
      return;
    }
    const wholeRowRef = state.wholeReferenceRowRef;
    const partRowRefs = wholePartRowRefs;
    const verificationKey = wholeVerificationKey;
    // Task 4 fix (I2, adversarial review): an EMPTY parts list (every other
    // visible series hidden, or — for a stack — the designated series
    // itself now hidden, so its own period can no longer be located among
    // the visible rows) has nothing real to check. Skipping it here matters:
    // the server would still resolve the designated cell's real value (a
    // hidden series doesn't remove it from the dataset) against a sum of
    // ZERO parts, which reads as a false "Checked ✓" for a whole within
    // 0.5 of zero, or a guaranteed mismatch with a raw-rowRef label
    // otherwise — neither is an honest verdict for "there is currently
    // nothing to check this against". Falls back to the same not_checked
    // default a fresh, undesignated chart shows.
    if (partRowRefs.length === 0) {
      setWholeVerification(null);
      return;
    }
    let cancelled = false;
    // Task 4 fix (I1, adversarial review): clear the PREVIOUS verdict
    // before firing a new request — a designation whose parts changed (a
    // series hidden/shown, a data edit) must not keep showing a stale
    // "Checked ✓" while the new check is still in flight. Mirrors
    // chart.tsx's own CBS-tier fix for this exact bug class (its "Final-
    // review fix (M2)" comment on its own whole-verification effect).
    setWholeVerification(null);
    void requestDatasetWholeVerification(datasetId, state.instruction, wholeRowRef, partRowRefs)
      .then((response) => {
        if (cancelled) return;
        setWholeVerification(response.ok ? { key: verificationKey, outcome: response.outcome } : null);
      })
      // Task 4 fix (I1): a REJECTED round trip (network failure, a Server
      // Action throw — as opposed to a normal `ok: false` answer, already
      // handled above) must not leave the PREVIOUS verdict on screen
      // forever. Same CBS-tier precedent as the comment above.
      .catch(() => {
        if (cancelled) return;
        setWholeVerification(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- wholePartRowRefs/wholeVerificationKey (and the pieVerificationRows/rows/visibleSeries they derive from) recompute together with activeSpec/state.hiddenKeys every render (see the comment above); depending on those two instead of the fresh values avoids re-fetching on every unrelated re-render.
  }, [activeSpec, state.hiddenKeys, activeForm, state.wholeReferenceRowRef, state.instruction, datasetId]);
  // Keyboard focus survives a designation (session 124; Task 4 minor M2,
  // confirmed in a real browser: after Enter on a slice/segment, focus fell
  // to <body>). The cause is inside Recharts, not this card: Pie/Bar key
  // their drawn items on an "animation id" that changes whenever the
  // component receives a fresh props object — i.e. on EVERY re-render — so
  // each render replaces every slice/segment element, and a removed element
  // takes focus with it. Designating always re-renders (the mark changes),
  // and so does the verdict landing, so memoising the shape functions
  // cannot prevent it. Instead: remember which designation control had
  // focus, and when the chart's DOM changes while focus has fallen to
  // <body>, put it back on the control with the same rowRef. A real focus
  // move (Tab away, a click elsewhere) clears the memory first, so this
  // never steals focus the reader moved on purpose.
  const focusedWholeRowRef = useRef<string | null>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!wholeForm || container === null) return;
    const isDesignation = (target: EventTarget | null): target is Element =>
      target instanceof Element && target.getAttribute('data-command-kind') === 'setWholeReference';
    const onFocusIn = (event: FocusEvent): void => {
      focusedWholeRowRef.current = isDesignation(event.target) ? event.target.getAttribute('data-result-id') : null;
    };
    // A focusout from an element Recharts is REMOVING must not count as the
    // reader moving on — only one from an element still in the page does.
    const onFocusOut = (event: FocusEvent): void => {
      if (isDesignation(event.target) && event.target.isConnected && event.relatedTarget !== null) focusedWholeRowRef.current = null;
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (!isDesignation(event.target)) focusedWholeRowRef.current = null;
    };
    const observer = new MutationObserver(() => {
      const rowRef = focusedWholeRowRef.current;
      if (rowRef === null) return;
      const active = document.activeElement;
      if (active !== null && active !== document.body && active.isConnected) return;
      const target = [...container.querySelectorAll<SVGElement>('[data-command-kind="setWholeReference"]')].find(
        (el) => el.getAttribute('data-result-id') === rowRef,
      );
      target?.focus({ preventScroll: true });
    });
    container.addEventListener('focusin', onFocusIn);
    container.addEventListener('focusout', onFocusOut);
    document.addEventListener('pointerdown', onPointerDown, true);
    observer.observe(container, { childList: true, subtree: true });
    return () => {
      container.removeEventListener('focusin', onFocusIn);
      container.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('pointerdown', onPointerDown, true);
      observer.disconnect();
      focusedWholeRowRef.current = null;
    };
  }, [wholeForm]);
  // The note's state: Task 3's default unless a reference is designated, in
  // which case the check's own outcome decides — still resolving (or a bare
  // `ok:false` refusal, e.g. a stale designation after a data edit) reads
  // as the SAME `not_checked` default until a real verdict lands, never a
  // fabricated state. `ownWholeNoteLabel` is computed unconditionally (an
  // unused '' for `not_checked`) so the mount point never has to branch on
  // which state needs the `{label}` param.
  const ownWholeNoteState: OwnWholeNoteState =
    state.wholeReferenceRowRef === null || currentWholeVerification === null
      ? wholeDesignationClick === undefined
        ? 'not_checked_read_only'
        : 'not_checked'
      : currentWholeVerification.verified
        ? 'checked'
        : currentWholeVerification.reason === 'sum_mismatch'
          ? 'mismatch'
          : 'cannot_check';
  const ownWholeNoteLabel =
    state.wholeReferenceRowRef === null ? '' : wholeReferenceLabel(activeForm, state.wholeReferenceRowRef, pieRows, rows, visibleSeries);
  const xLabelProps = {
    angle: pres.xLabels === 'tilted' ? -45 : 0,
    textAnchor: pres.xLabels === 'tilted' ? ('end' as const) : ('middle' as const),
    ...(pres.xLabels === 'tilted' ? { height: 56 } : {}),
  };
  // Arrays, not fragments: Recharts flattens array children the same way it
  // flattens the `.map()` over series below, but cannot see through a
  // Fragment — so the shared axis/grid/tooltip elements are listed here with
  // their own keys instead of being wrapped.
  const verticalAxes = [
    pres.grid !== 'none' ? <CartesianGrid key="grid" {...GRID_LINE_PROPS} horizontal vertical={pres.grid === 'both'} /> : null,
    <XAxis
      key="x"
      dataKey="periodLabel"
      stroke={AXIS_COLOR}
      tick={{ fill: AXIS_COLOR }}
      axisLine={baselineAxisLine(pres)}
      tickLine={pres.axisLines === 'shown'}
      {...xLabelProps}
    />,
    <YAxis
      key="y"
      ticks={plan.axisTicks.map((tick) => tick.value)}
      interval={0}
      tick={plan.axisTicks.length > 0 ? AxisTick(tickByValue) : false}
      width={plan.axisTicks.length > 0 ? 48 : 16}
      domain={pres.zeroBaseline === 'zero' ? [0, 'auto'] : yAxisDomain(activeSpec.kind)}
      stroke={AXIS_COLOR}
      axisLine={pres.axisLines === 'shown'}
      tickLine={pres.axisLines === 'shown'}
    />,
    <Tooltip key="tip" content={<ChartTooltip seriesMeta={seriesMeta} />} />,
  ];
  // Forced on for bar/hbar by the resolver, the reader's own choice on
  // line/area.
  const showValueLabels = pres.valueLabels === 'shown';
  // Fix round 1 (I1): a public visitor's click must open no note-draft
  // composer — `undefined` here is what `UserSeriesDot` (≈358-397) already
  // reads as "no note trigger at all": no `role="button"`, no `tabIndex`, no
  // `aria-label`, no click handler on the dot. Same convention chart.tsx's
  // own `embedMode` uses for its `onPointClick` (≈2623).
  const dotFor = (s: SeriesMeta): ReturnType<typeof UserSeriesDot> =>
    UserSeriesDot(
      s.key,
      opacityFor(s),
      s.label,
      publicMode ? undefined : onPointClick,
      { ...dotGeometry(pres.lineWidth), markers: pres.markers, ends: endpointsByKey.get(s.key) ?? null },
      chartLang,
    );

  const tableNode = (
    <div id={panelId} role="tabpanel" aria-label={t(chartLang, 'chart.tabTable')} className="mt-2 overflow-x-auto">
      {/* Spec strings only (U6): the header is the spec's own xHeader and
        * series labels, every cell its own `formattedValue`. The CSV
        * download in the footer (#318) carries the same points. */}
      <table className="w-full text-sm" aria-label={heading}>
        <thead>
          <tr>
            <th scope="col" className="border-b border-border px-2 py-1 text-left font-medium text-muted-foreground">
              {activeSpec.xHeader}
            </th>
            {listedSeriesMeta.map((s) => (
              <th key={s.key} scope="col" className="border-b border-border px-2 py-1 text-right font-medium text-muted-foreground">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.periodCode)} className="border-b border-border">
              <th scope="row" className="px-2 py-1 text-left font-normal text-foreground">
                {String(row.periodLabel)}
              </th>
              {listedSeriesMeta.map((s) => (
                <td
                  key={s.key}
                  className="px-2 py-1 text-right text-foreground"
                  data-label-for={row[`${s.key}_resultId`] == null ? undefined : String(row[`${s.key}_resultId`])}
                >
                  {row[`${s.key}_display`] == null ? '' : String(row[`${s.key}_display`])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const plotNode = (
    <ChartFrame frame={pres} image={null}>
      {/* touch-pan-y: the tooltip's press-and-drag must not fight vertical
        * page scrolling on a phone. Everything the reader wrote (title,
        * caption, notes) stays OUTSIDE this container, so it can never enter
        * a PNG/SVG export. */}
      <div
        id={panelId}
        role="tabpanel"
        aria-label={t(chartLang, 'chart.graphPanelLabel')}
        ref={containerRef}
        data-testid="user-chart-container"
        className="mt-2 h-64 w-full touch-pan-y"
        style={fontStack(pres.fontFamily) ? { fontFamily: fontStack(pres.fontFamily) } : undefined}
      >
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height: 256 }}>
          {/* Own-data chart-fit parity (Task 1): a slope chart IS a line
            * chart restricted to exactly two x values per series —
            * `slopeFormAllowed`'s own condition — so Helling reuses this
            * Lijn branch verbatim, exactly as chart.tsx's own Helling tab
            * reuses its Lijn branch. Nothing new is drawn. */}
          {activeForm === 'line' || activeForm === 'slope' ? (
            <LineChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 8 }} desc={t(chartLang, 'userChart.keyboardHint')} aria-label={accessibleName}>
              {verticalAxes}
              {visibleSeries.map((s) => (
                <Line
                  key={s.key}
                  type="linear"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={LINE_WIDTH_PX[pres.lineWidth]}
                  strokeOpacity={opacityFor(s)}
                  data-series-dimmed={dimmedFor(s) ? 'true' : undefined}
                  connectNulls={false}
                  dot={dotFor(s)}
                  activeDot={false}
                  isAnimationActive={false}
                >
                  {showValueLabels ? valueLabels(s.key, 'top') : null}
                </Line>
              ))}
              {/* Era shading bands, positioned by period label — same
                * ReferenceArea placement chart.tsx uses (Recharts resolves
                * the category position; no manual x-scale math needed). */}
              {state.eraShadings.map((era) => {
                const fromLabel = periodLabelByCode.get(era.fromPeriodCode);
                const toLabel = periodLabelByCode.get(era.toPeriodCode);
                if (!fromLabel || !toLabel) return null;
                return <ReferenceArea key={era.id} x1={fromLabel} x2={toLabel} fill="var(--accent)" fillOpacity={0.1} />;
              })}
              {/* No `label` prop: the reader's typed text stays only in
                * ChartGoalLine's own list, outside `containerRef` below — see
                * that component's header comment and chart.tsx's identical
                * block (Final-review fix C2). */}
              {state.goalLines.map((line) => (
                <ReferenceLine key={line.id} y={line.value} stroke="var(--accent)" strokeDasharray="6 3" ifOverflow="extendDomain" />
              ))}
              {derivedOverlayElements(resolvedOverlays, state.derivedOverlayRequests, allPlottablePoints)}
            </LineChart>
          ) : activeForm === 'area' ? (
            <AreaChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 8 }} desc={t(chartLang, 'userChart.keyboardHint')} aria-label={accessibleName}>
              <defs>
                {seriesMeta.map((s) => (
                  <linearGradient key={s.key} id={`fill-${domId}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                  </linearGradient>
                ))}
              </defs>
              {verticalAxes}
              {visibleSeries.map((s) => {
                const opacity = opacityFor(s);
                const isDimmed = dimmedFor(s);
                // Final-review fix I4 (same bug, same fix, as chart.tsx's
                // identical area branch): `opacity` already carries the
                // FULL intended reduction (1 normal, 0.35 user-dimmed, 0.25
                // highlight-dimmed — opacityFor above) and must be the SOLE
                // multiplier against each fill type's own base fraction
                // (0.25 solid / 1 gradient) — not stacked with a second
                // `isDimmed ? 0.1 : 0.25`-style shrink, which used to
                // compound to ~3.5% opacity (0.1 × 0.35) for a user-dimmed
                // series, effectively invisible. Shared, directly unit
                // tested helper — see chart-presentation.ts.
                const areaFillOpacity = areaFillOpacityFor(pres.areaFill, opacity);
                return (
                <Area
                  key={s.key}
                  type="linear"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  fill={pres.areaFill === 'gradient' ? `url(#fill-${domId}-${s.key})` : s.color}
                  fillOpacity={areaFillOpacity}
                  strokeWidth={LINE_WIDTH_PX[pres.lineWidth]}
                  strokeOpacity={opacity}
                  data-series-dimmed={isDimmed ? 'true' : undefined}
                  connectNulls={false}
                  dot={dotFor(s)}
                  activeDot={false}
                  isAnimationActive={false}
                >
                  {showValueLabels ? valueLabels(s.key, 'top') : null}
                </Area>
              );
              })}
              {/* Same as the Line branch above. */}
              {state.eraShadings.map((era) => {
                const fromLabel = periodLabelByCode.get(era.fromPeriodCode);
                const toLabel = periodLabelByCode.get(era.toPeriodCode);
                if (!fromLabel || !toLabel) return null;
                return <ReferenceArea key={era.id} x1={fromLabel} x2={toLabel} fill="var(--accent)" fillOpacity={0.1} />;
              })}
              {state.goalLines.map((line) => (
                <ReferenceLine key={line.id} y={line.value} stroke="var(--accent)" strokeDasharray="6 3" ifOverflow="extendDomain" />
              ))}
              {derivedOverlayElements(resolvedOverlays, state.derivedOverlayRequests, allPlottablePoints)}
            </AreaChart>
          ) : activeForm === 'hbar' ? (
            // The transposed bar: the x categories move to the category axis,
            // the values run horizontally. Same `rows`/`seriesMeta` model as
            // every other form here (R6: the spec's order IS the render
            // order) — grid meaning swaps with the axes, exactly as it does
            // on the CBS card's own hbar form.
            <BarChart layout="vertical" data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 8 }} desc={t(chartLang, 'userChart.keyboardHint')} aria-label={accessibleName}>
              {pres.grid !== 'none' ? <CartesianGrid {...GRID_LINE_PROPS} vertical horizontal={pres.grid === 'both'} /> : null}
              <XAxis
                type="number"
                domain={[0, 'auto']}
                tick={false}
                stroke={AXIS_COLOR}
                axisLine={pres.axisLines === 'shown'}
                tickLine={pres.axisLines === 'shown'}
              />
              <YAxis
                type="category"
                dataKey="periodLabel"
                interval={0}
                width={96}
                stroke={AXIS_COLOR}
                tick={{ fill: AXIS_COLOR }}
                axisLine={baselineAxisLine(pres)}
                tickLine={pres.axisLines === 'shown'}
              />
              <Tooltip content={<ChartTooltip seriesMeta={seriesMeta} />} />
              {visibleSeries.map((s) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  fill={s.color}
                  fillOpacity={opacityFor(s)}
                  data-series-dimmed={dimmedFor(s) ? 'true' : undefined}
                  isAnimationActive={false}
                >
                  {showValueLabels ? valueLabels(s.key, 'right') : null}
                </Bar>
              ))}
            </BarChart>
          ) : activeForm === 'dumbbell' ? (
            // Own-data chart-fit parity (Task 2): the dumbbell form —
            // chart.tsx's own branch, mirrored (see UserDumbbellOverlay). The
            // SAME category-vs-number shell as the hbar branch above (the
            // series on the category axis, the number axis from zero with
            // no invented ticks, the same grid semantics) but with NO `<Bar>`
            // at all: nothing on a dumbbell is a bar. The axes and grid exist
            // only to settle the coordinate system; the overlay reads those
            // settled scales and draws every row itself. No <Tooltip>:
            // Recharts builds a tooltip's payload from the chart's graphical
            // items, of which this branch has none — and every value is
            // already permanently labelled beside its dot. `dataKey="range"`
            // is the row's own [min, max] value pair, used ONLY to size the
            // domain (chart.tsx's DumbbellRow); the x-axis `padding` reserves
            // label room inside the plot without touching that domain.
            <BarChart layout="vertical" data={visibleDumbbellRows} margin={{ top: 8, right: 8, left: 8, bottom: 8 }} desc={t(chartLang, 'userChart.keyboardHint')} aria-label={accessibleName}>
              {pres.grid !== 'none' ? <CartesianGrid {...GRID_LINE_PROPS} vertical horizontal={pres.grid === 'both'} /> : null}
              <XAxis
                type="number"
                dataKey="range"
                domain={[0, 'auto']}
                padding={{ left: dumbbellLabelPadPx, right: dumbbellLabelPadPx }}
                tick={false}
                stroke={AXIS_COLOR}
                axisLine={pres.axisLines === 'shown'}
                tickLine={pres.axisLines === 'shown'}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={dumbbellYAxisWidth}
                interval={0}
                tick={UserCategoryAxisTick}
                stroke={AXIS_COLOR}
                axisLine={baselineAxisLine(pres)}
                tickLine={pres.axisLines === 'shown'}
              />
              <UserDumbbellOverlay rows={visibleDumbbellRows} />
            </BarChart>
          ) : activeForm === 'pie' ? (
            // Own-data verified-whole parity (Task 3): the pie — chart.tsx's
            // phase-5b branch, mirrored, WITHOUT its verification gate: one
            // slice per visible series (`pieRows`), each slice's `value` the
            // point's own real value (geometry only), each label its own
            // `value_display` via UserPieSliceLabel, each tooltip line
            // RegionTooltip's — no Recharts percentage, no invented number,
            // no total drawn or implied; the note under the chart says so.
            // `innerRadius` is the ONE thing the donut presentation key
            // changes (a styling toggle, not a form — chart.tsx's rule).
            <PieChart desc={t(chartLang, 'userChart.keyboardHint')} aria-label={accessibleName} margin={{ top: 24, right: 24, bottom: 24, left: 24 }}>
              <Tooltip content={<RegionTooltip periodLabel={pieSharedPeriodLabel} />} />
              <Pie
                data={pieRows}
                dataKey="value"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius={pres.pieHole === 'donut' ? '50%' : 0}
                outerRadius="80%"
                isAnimationActive={false}
                stroke="var(--card)"
                strokeWidth={1}
                label={UserPieSliceLabel}
                labelLine={{ stroke: AXIS_COLOR, strokeWidth: 1 }}
                shape={UserPieSlice(pieSharedPeriodLabel, wholeDesignationClick, chartLang, state.wholeReferenceRowRef)}
              >
                {pieRows.map((r) => (
                  <Cell
                    key={r.key}
                    fill={r.color}
                    fillOpacity={r.opacity}
                    stroke="var(--card)"
                    data-point="value"
                    data-series-key={r.key}
                    data-series-dimmed={r.dimmed ? 'true' : undefined}
                    data-result-id={r.value_resultId ?? undefined}
                  />
                ))}
              </Pie>
            </PieChart>
          ) : activeForm === 'stacked' || activeForm === 'stacked100' ? (
            // Own-data verified-whole parity (Task 3): stacked / 100%-stacked
            // — chart.tsx's phase-5b branch, mirrored, WITHOUT its per-period
            // verification: the SAME period × series `rows` the vertical bar
            // draws, one `<Bar stackId="whole">` per visible series
            // (Recharts' own native stacking), EVERY period drawn. 100%-
            // stacked stacks each series' `<key>_share` from `stack100`
            // against a fixed hundred-percent axis; the segment label is the
            // formatted share and the tooltip pairs it with the real value.
            // Ticks stay off (no invented axis numbers) on both, and the
            // baseline is zero — the resolver forces both for these forms.
            <BarChart
              data={activeForm === 'stacked100' ? stack100.rows : rows}
              margin={{ top: 16, right: 8, left: 8, bottom: 8 }}
              desc={t(chartLang, 'userChart.keyboardHint')}
              aria-label={accessibleName}
            >
              {pres.grid !== 'none' ? <CartesianGrid {...GRID_LINE_PROPS} horizontal vertical={pres.grid === 'both'} /> : null}
              <XAxis
                dataKey="periodLabel"
                stroke={AXIS_COLOR}
                tick={{ fill: AXIS_COLOR }}
                axisLine={baselineAxisLine(pres)}
                tickLine={pres.axisLines === 'shown'}
                {...xLabelProps}
              />
              <YAxis
                tick={false}
                width={16}
                domain={activeForm === 'stacked100' ? [0, 100] : [0, 'auto']}
                stroke={AXIS_COLOR}
                axisLine={pres.axisLines === 'shown'}
                tickLine={pres.axisLines === 'shown'}
              />
              <Tooltip content={<ChartTooltip seriesMeta={seriesMeta} />} cursor={{ fill: 'var(--muted)', fillOpacity: 0.6 }} />
              {visibleSeries.map((s) => {
                const valueKey = activeForm === 'stacked100' ? `${s.key}_share` : s.key;
                const labelKey = activeForm === 'stacked100' ? `${s.key}_share_label` : `${s.key}_display`;
                return (
                  <Bar
                    key={s.key}
                    dataKey={valueKey}
                    name={s.label}
                    stackId="whole"
                    fill={s.color}
                    fillOpacity={opacityFor(s)}
                    data-series-dimmed={dimmedFor(s) ? 'true' : undefined}
                    isAnimationActive={false}
                    shape={UserStackSegment(s.key, valueKey, labelKey, s.color, opacityFor(s), s.label, wholeDesignationClick, chartLang, state.wholeReferenceRowRef)}
                  />
                );
              })}
            </BarChart>
          ) : (
            <BarChart data={rows} margin={{ top: 16, right: 8, left: 8, bottom: 8 }} desc={t(chartLang, 'userChart.keyboardHint')} aria-label={accessibleName}>
              {pres.grid !== 'none' ? <CartesianGrid {...GRID_LINE_PROPS} horizontal vertical={pres.grid === 'both'} /> : null}
              <XAxis
                dataKey="periodLabel"
                stroke={AXIS_COLOR}
                tick={{ fill: AXIS_COLOR }}
                axisLine={baselineAxisLine(pres)}
                tickLine={pres.axisLines === 'shown'}
                {...xLabelProps}
              />
              {/* A bar chart always begins at zero (the honesty rule
                * `zeroBaseline` can never override, same as the CBS card) and
                * invents no ticks of its own. */}
              <YAxis
                tick={false}
                width={16}
                domain={[0, 'auto']}
                stroke={AXIS_COLOR}
                axisLine={pres.axisLines === 'shown'}
                tickLine={pres.axisLines === 'shown'}
              />
              <Tooltip content={<ChartTooltip seriesMeta={seriesMeta} />} />
              {visibleSeries.map((s) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  fill={s.color}
                  fillOpacity={opacityFor(s)}
                  data-series-dimmed={dimmedFor(s) ? 'true' : undefined}
                  isAnimationActive={false}
                >
                  {showValueLabels ? valueLabels(s.key, 'top') : null}
                </Bar>
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );

  return (
    // H2: the dashed frame is what tells a user-data chart apart from a CBS
    // one at a glance — it stays in every mount point, dock included.
    // `tabIndex={-1}`: the card itself is click-focusable so ⌘Z reaches
    // `onHistoryKeyDown` without the reader having focused a control first.
    <div
      className="mt-3 rounded-xl border-2 border-dashed border-border bg-card p-4 text-card-foreground outline-none"
      tabIndex={-1}
      onKeyDown={onHistoryKeyDown}
    >
      <div className="mb-2 inline-flex items-center rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
        {USER_DATA_BADGE}
      </div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* The spec's own derived heading until the reader writes their own
            * title; after that `ChartEditableText`'s <h3> IS the heading, so
            * there is exactly one level-3 heading either way. */}
          {state.title === null ? (
            <div role="heading" aria-level={3} className="text-sm font-semibold text-foreground">
              {heading}
            </div>
          ) : null}
          {/* Requirement 3: a public visitor gets the reader's OWN title text
            * (state.title, already replayed into `initial` above) with no
            * edit pencil and no "add a title" affordance — ChartEditableText
            * always renders one of those two for a non-null/null value, so
            * public mode renders the plain text/nothing instead of mounting
            * it at all. Harmless duplication with the `state.title === null`
            * branch above is impossible: exactly one of the two conditions
            * below is ever true for a given state.title. */}
          {publicMode ? (
            state.title !== null ? (
              <h3 data-testid="user-chart-title" className="text-sm font-semibold text-foreground">
                {state.title}
              </h3>
            ) : null
          ) : (
            <ChartEditableText
              value={state.title}
              commandKind="setTitle"
              placeholder={t(chartLang, 'userChart.title.placeholder')}
              editLabel={t(chartLang, 'userChart.title.edit')}
              addLabel={t(chartLang, 'userChart.title.add')}
              saveLabel={t(chartLang, 'userChart.title.save')}
              cancelLabel={t(chartLang, 'userChart.title.cancel')}
              maxLength={CHART_TITLE_MAX_LENGTH}
              onCommit={(next) => dispatch({ kind: 'setTitle', title: next }, 'canvas')}
              testId="user-chart-title"
              as="h3"
              className="text-sm font-semibold text-foreground"
            />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* Requirement 3: no history (nothing to undo — a public visitor
            * never dispatches a command), no Style panel trigger, no Data
            * panel trigger. */}
          {!publicMode ? (
            <ChartHistoryActions undo={undo} redo={redo} canUndo={canUndo} canRedo={canRedo} history={history} lang={chartLang} />
          ) : null}
          {!tabularForm && !publicMode ? (
            <ChartConfigTrigger
              open={styleOpen}
              onToggle={() => setStyleOpen((open) => !open)}
              controlsId={styleControlsId}
              triggerId={styleTriggerId}
              lang={chartLang}
              compact
            />
          ) : null}
          {dataEdit !== null && !publicMode ? (
            <ChartDataTrigger
              open={dataOpen}
              onToggle={() => setDataOpen((open) => !open)}
              controlsId={dataControlsId}
              triggerId={dataTriggerId}
              lang={chartLang}
            />
          ) : null}
        </div>
      </div>
      {/* Requirement 3: no form tabs at all in public mode — no `role="tablist"`
        * on the page. `activeForm` is unaffected: it already comes from
        * `state.form`, which the replayed `initial` doc state set correctly
        * (chartDocStateFromPublic), so the right form still renders below —
        * a public visitor simply cannot switch it. */}
      {!publicMode ? (
        <>
      <div
        role="tablist"
        aria-label={t(chartLang, 'chart.weergaveLabel')}
        onKeyDown={onFormTabKeyDown}
        className="mt-3 flex flex-wrap items-center gap-1"
      >
        {FORM_TABS.map(({ form, label }) => {
          const allowed = formAllowed(form);
          return (
            <button
              key={form}
              ref={(el) => {
                tabRefs.current[form] = el;
              }}
              type="button"
              role="tab"
              data-command-kind="setForm"
              aria-selected={activeForm === form}
              aria-controls={panelId}
              aria-describedby={allowed ? undefined : `${domId}-reason-${form}`}
              tabIndex={activeForm === form ? 0 : -1}
              disabled={!allowed}
              title={allowed ? undefined : formReason(form)}
              onClick={() => selectForm(form)}
              className={
                'min-h-11 border-b-2 px-1.5 py-1 text-xs transition-colors disabled:cursor-not-allowed sm:min-h-6 ' +
                (activeForm === form ? 'border-foreground font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground') +
                (allowed ? '' : ' cursor-not-allowed opacity-40')
              }
            >
              {t(chartLang, label)}
            </button>
          );
        })}
      </div>
      {/* A disabled tab still owes its reason to whoever reaches it by
        * keyboard — a plain `title` is invisible to a screen reader. */}
      {FORM_TABS.filter(({ form }) => !formAllowed(form)).map(({ form }) => (
        <span key={form} id={`${domId}-reason-${form}`} className="sr-only">
          {formReason(form)}
        </span>
      ))}
        </>
      ) : null}
      {/* A data command that could not be drawn: one digit-free line, and the
        * previous chart stays on screen so Undo is a real way back. */}
      {renderFailure !== null ? (
        <p id={`${domId}-render-failure`} role="status" className="mt-2 text-xs text-warning">
          {t(chartLang, renderFailure)}
        </p>
      ) : null}
      {activeForm === 'heatmap' ? (
        // Own-data chart-fit parity (Task 1): the heatmap sits where the
        // table does — a sibling of `tableNode`, outside ChartFrame and the
        // export container (no <svg> to export, no frame to draw), the same
        // `tabpanel` id the tablist points at. Mirrors chart.tsx's own
        // canvas dispatch. Mounted (and its model built) only in this form.
        <div id={panelId} role="tabpanel" aria-label={t(chartLang, 'chart.form.heatmap')} className="mt-2 overflow-x-auto">
          <UserHeatmapGrid xHeader={activeSpec.xHeader} rows={rows} seriesMeta={listedSeriesMeta} label={heading} />
        </div>
      ) : activeForm === 'table' ? (
        tableNode
      ) : smallMultiplesOn ? (
        // Outside ChartFrame and the export container, like the table: the
        // grid is several small <svg>s, not one chart an image export can
        // capture — so the image download below is hidden while it is on,
        // exactly as on the CBS card.
        <div id={panelId} role="tabpanel" aria-label={t(chartLang, 'chart.smallMultiplesGroupLabel')} className="mt-2">
          <ChartSmallMultiples spec={plottable} hiddenKeys={state.hiddenKeys} axisMode={axisMode} presentation={pres} lang={chartLang} />
        </div>
      ) : (
        plotNode
      )}
      {!tabularForm && seriesMeta.length > 1 ? (
        <>
          <SeriesLegend
            // Requirement 4: a hidden series' slot is kept (pruneForPublic
            // blanks it, never removes it — the remaining series' keys/
            // colours must not shift), but its label is '' and it has
            // nothing to restore-by-clicking in public mode, so it is
            // filtered out of the legend LIST entirely here rather than
            // rendered as an empty chip. Signed-in path unchanged: the
            // reader's own card still lists a hidden series (dimmed) so they
            // can bring it back.
            seriesMeta={listedSeriesMeta}
            hiddenKeys={state.hiddenKeys}
            dimmedKeys={state.dimmedKeys}
            highlightedKey={state.highlightedKey}
            onToggle={(key) => dispatch({ kind: 'toggleSeries', key }, 'canvas')}
            onDim={(key, hiddenKeys, dimmedKeys) =>
              dispatch({ kind: 'setDimmed', hiddenKeys: [...hiddenKeys], dimmedKeys: [...dimmedKeys] }, 'panel')
            }
            onHighlight={(key) => dispatch({ kind: 'setHighlight', key }, 'canvas')}
            lang={chartLang}
            // Requirement 3: a public visitor's click must change nothing —
            // `disabled` (already a real prop, the story-mode lock uses it
            // the same way) sets the HTML `disabled` attribute on every
            // legend button, so a click never reaches `onToggle`/`onDim`/
            // `onHighlight` at all, not merely "the handler chooses to do
            // nothing".
            disabled={publicMode}
          />
          {/* Ruling R7 (M1, fix round 1): "N of M series hidden" names a
            * COUNT, never a label, so it is not a P1 leak on its own — but
            * it is still the reader's own toggle-state disclosure, not
            * something a public visitor (who cannot toggle anything) has a
            * use for, so it is skipped in public mode. */}
          {state.hiddenKeys.size > 0 && !publicMode ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t(chartLang, 'chart.hiddenSeriesDisclosure', { n: state.hiddenKeys.size, m: seriesMeta.length })}
            </p>
          ) : null}
        </>
      ) : null}
      {activeForm === 'line' && seriesMeta.length > 1 && !publicMode ? (
        // #318: the same toggle row as chart.tsx's (same labels, same
        // pill styling), minus the story lock this card has no story for.
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            aria-pressed={smallMultiples}
            onClick={() => setSmallMultiples((v) => !v)}
            className={pillClass(smallMultiples)}
          >
            {t(chartLang, 'chart.smallMultiplesToggle')}
          </button>
          {smallMultiples ? (
            <div role="group" aria-label={t(chartLang, 'chart.axisGroupLabel')} className="flex gap-2">
              <button type="button" aria-pressed={axisMode === 'shared'} onClick={() => setAxisMode('shared')} className={pillClass(axisMode === 'shared')}>
                {t(chartLang, 'chart.sharedAxes')}
              </button>
              <button type="button" aria-pressed={axisMode === 'own'} onClick={() => setAxisMode('own')} className={pillClass(axisMode === 'own')}>
                {t(chartLang, 'chart.ownAxes')}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {/* Fix round 1 (I1): a public visitor gets none of the editing UI
        * (composer, delete, set/clear headline, add/remove goal line or era)
        * — but a surviving note (spec §3.5 already pruned the ones anchored
        * to a hidden point; the rest are exactly what the author meant a
        * reader to see) is still shown, read-only, same binding convention
        * ChartNotes itself uses (`{seriesLabel} · {periodLabel}: {text}` —
        * both labels are spec strings, U6-safe). Goal lines and era
        * shadings are listed read-only in the same list (final-review fix
        * A7) — only their add/remove editors are skipped here. */}
      {!tabularForm ? (
        publicMode ? (
          visibleNotes.length > 0 || state.goalLines.length > 0 || publicEras.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-1.5" data-testid="public-notes-list">
              {visibleNotes.map((note) => (
                <li key={note.id} className="text-sm">
                  <span className="text-xs text-muted-foreground">
                    {note.seriesLabel} · {note.periodLabel}:{' '}
                  </span>
                  {note.text}
                </li>
              ))}
              {/* Final-review fix A7 (ruling R9): the plot draws a goal line
                * and an era band WITHOUT their typed labels (those stay out
                * of the export container), so a visitor would otherwise see
                * an unexplained line/band. Listed read-only here, the same
                * binding the author's own ChartGoalLine/ChartEraShading lists
                * use: the goal line's author-typed value + label, the era's
                * two period labels (spec strings) + label. */}
              {state.goalLines.map((line) => (
                <li key={line.id} className="text-sm" data-testid="public-goal-line">
                  <span className="text-xs text-muted-foreground">{String(line.value)}: </span>
                  {line.label}
                </li>
              ))}
              {publicEras.map(({ era, fromLabel, toLabel }) => (
                <li key={era.id} className="text-sm" data-testid="public-era-shading">
                  <span className="text-xs text-muted-foreground">
                    {fromLabel} – {toLabel}:{' '}
                  </span>
                  {era.label}
                </li>
              ))}
            </ul>
          ) : null
        ) : (
          // `tabIndex={-1}`: the target a "Notities" chip in a co-pilot reply
          // focuses (Task 8) — the strip itself has no single control to aim at.
          <div ref={notesRef} tabIndex={-1} className="outline-none">
            <ChartNotes
              notes={visibleNotes}
              pendingPoint={pendingPoint}
              idPrefix={domId}
              lang={chartLang}
              onSave={(text) => {
                if (!pendingPoint) return;
                const note: ChartNote = { id: `${pendingPoint.resultId}-${newCommandId()}`, ...pendingPoint, text };
                dispatch({ kind: 'addNote', note }, 'canvas');
                setPendingPoint(null);
              }}
              onCancelPending={() => setPendingPoint(null)}
              onDelete={(id) => dispatch({ kind: 'removeNote', noteId: id }, 'canvas')}
              headlineOverrideResultId={state.headlineOverrideResultId}
              onSetHeadline={(resultId) => {
                dispatch({ kind: 'setHeadlineOverride', resultId }, 'canvas');
                setPendingPoint(null);
              }}
              onClearHeadline={() => {
                dispatch({ kind: 'setHeadlineOverride', resultId: null }, 'canvas');
                setPendingPoint(null);
              }}
            />
            {/* Outside `containerRef`, like the notes above — see
              * chart-goal-line.tsx's own header comment for the export-boundary
              * invariant this mirrors from chart.tsx. */}
            <ChartGoalLine
              goalLines={state.goalLines}
              lang={chartLang}
              idPrefix={domId}
              onAdd={(value, label) => dispatch({ kind: 'addGoalLine', goalLine: { id: newCommandId(), value, label } }, 'panel')}
              onRemove={(id) => dispatch({ kind: 'removeGoalLine', goalLineId: id }, 'panel')}
            />
          </div>
        )
      ) : null}
      {!tabularForm && !publicMode ? (
        <div tabIndex={-1} className="outline-none">
          <ChartEraShading
            eraShadings={state.eraShadings}
            periodOptions={periodOptions}
            lang={chartLang}
            idPrefix={domId}
            onAdd={(fromPeriodCode, toPeriodCode, label) => {
              dispatch({ kind: 'addEraShading', era: { id: newCommandId(), fromPeriodCode, toPeriodCode, label } }, 'canvas');
            }}
            onRemove={(id) => dispatch({ kind: 'removeEraShading', eraShadingId: id }, 'canvas')}
          />
        </div>
      ) : null}
      {/* Difference / average overlay controls (Task 7 parity) — gated to
        * line/area only, same as chart.tsx's own I2 fix: derivedOverlayElements
        * only ever draws inside the LineChart/AreaChart branches above, so
        * offering these controls on a bar/table chart would let a reader add
        * an overlay whose own remove chip appears while nothing renders.
        * ALSO gated on `edit !== undefined` — mirrors chart.tsx's identical
        * `embed !== undefined` gate exactly: resolving a value needs a real
        * server round trip (requestDatasetDerivation needs `datasetId`), so
        * without an edit context the button would add a command that can
        * never resolve, the same silently-broken-doorway class of bug #310
        * closed for the CBS tier's own capability gate. */}
      {edit !== undefined &&
      (activeForm === 'line' || activeForm === 'area' || state.derivedOverlayRequests.length > 0 || derivationRefusals.size > 0) ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {/* #293: only the ADD controls are form-gated; a remove chip and
            * any refusal stay visible on every form while an overlay exists. */}
          {activeForm === 'line' || activeForm === 'area' ? (
          <>
          <button
            type="button"
            data-command-kind="addDerivedOverlay"
            aria-pressed={differencePickerActive}
            title={t(chartLang, 'chart.derived.differenceLabel')}
            onClick={() => {
              setDifferencePickerActive((active) => !active);
              setFirstDifferencePoint(null);
              setDifferenceError(null);
            }}
            className={
              'min-h-6 rounded-md border px-2 py-0.5 text-xs ' +
              (differencePickerActive
                ? 'border-accent bg-accent text-accent-foreground'
                : 'border-border text-foreground hover:bg-muted')
            }
          >
            {differencePickerActive ? `${t(chartLang, 'chart.derived.differencePick')}…` : t(chartLang, 'chart.derived.differenceLabel')}
          </button>
          {visibleSeries.length === 1 ? (
            <button
              type="button"
              data-command-kind="addDerivedOverlay"
              title={t(chartLang, 'chart.derived.meanLabel')}
              onClick={() => {
                // seriesMeta/visibleSeries keys are positional ('s0', 's1',
                // ... — buildRows, shared with chart.tsx), so the one
                // visible series' index is its key with the 's' prefix
                // stripped — same lookup chart.tsx's own mean button uses.
                const visibleIndex = Number(visibleSeries[0]!.key.slice(1));
                const resultIds = (plottable.series[visibleIndex]?.points ?? []).map((p) => p.resultId);
                if (resultIds.length >= 2) {
                  dispatch({ kind: 'addDerivedOverlay', overlay: { id: newCommandId(), calcKind: 'mean', resultIds } }, 'panel');
                }
              }}
              className="min-h-6 rounded-md border border-border px-2 py-0.5 text-xs text-foreground hover:bg-muted"
            >
              {t(chartLang, 'chart.derived.meanLabel')}
            </button>
          ) : null}
          </>
          ) : null}
          {state.derivedOverlayRequests.map((overlay) => (
            <button
              key={overlay.id}
              type="button"
              data-command-kind="removeDerivedOverlay"
              onClick={() => dispatch({ kind: 'removeDerivedOverlay', overlayId: overlay.id }, 'panel')}
              className="min-h-6 rounded-md border border-border px-2 py-0.5 text-xs text-foreground hover:bg-muted"
            >
              × {overlay.calcKind === 'difference' ? t(chartLang, 'chart.derived.differenceLabel') : t(chartLang, 'chart.derived.meanLabel')}
            </button>
          ))}
          {differenceError !== null ? <span className="text-xs text-destructive">{differenceError}</span> : null}
          {Array.from(derivationRefusals.values()).map((reason, i) => (
            <span key={i} className="text-xs text-destructive">
              {reason}
            </span>
          ))}
        </div>
      ) : null}
      {/* Requirement 3: same read-only-text-or-nothing treatment as the
        * title above — no edit pencil, no "add a caption" link. */}
      {publicMode ? (
        state.caption !== null ? (
          <p data-testid="chart-caption" className="text-sm text-muted-foreground">
            {state.caption}
          </p>
        ) : null
      ) : (
        <ChartEditableText
          value={state.caption}
          commandKind="setCaption"
          placeholder={t(chartLang, 'chart.caption.placeholder')}
          editLabel={t(chartLang, 'chart.caption.edit')}
          addLabel={t(chartLang, 'chart.caption.add')}
          saveLabel={t(chartLang, 'chart.caption.save')}
          cancelLabel={t(chartLang, 'chart.caption.cancel')}
          maxLength={CHART_CAPTION_MAX_LENGTH}
          onCommit={(next) => dispatch({ kind: 'setCaption', caption: next }, 'canvas')}
          testId="chart-caption"
          as="p"
          className="text-sm text-muted-foreground"
        />
      )}
      {/* Doorway B, directly under the caption (Task 8). OUTSIDE
        * `containerRef` like everything the reader wrote, so the one figure
        * it can show — the turn's credit cost — never enters an export.
        * Requirement 3: never in public mode — belt-and-braces alongside
        * `dataEdit !== null` (structurally already null there, since a
        * public render never has an `edit` context/profile to validate a
        * data command against — ADR 037 D11). */}
      {dataEdit !== null && !publicMode ? (
        <ChartCopilotInput
          lang={chartLang}
          busy={copilotBusy}
          examples={exampleChips({
            instruction: dataEdit.instruction,
            profile: dataEdit.profile,
            spec: activeSpec,
            state,
            lang: chartLang,
          })}
          reply={copilotReply === null ? null : { ...copilotReply, canUndo: replyIsUndoable(copilotReply) }}
          error={copilotError}
          onSend={(message) => void sendToCopilot(message)}
          onUndoReply={undoCopilotReply}
          // A retry is the same words with a NEW requestId — a new turn, and
          // a new charge; the control says so in words.
          onRetry={(message) => void sendToCopilot(message)}
          // Returned, not fired and forgotten: the strip only says "thanks"
          // once the action confirms the vote landed.
          onFeedback={(turnId, vote) => submitCopilotFeedback(turnId, vote)}
          onOpen={openCopilotTarget}
          canOpen={copilotCanOpen}
          // The line above the plot already says why — the composer points at
          // it instead of repeating the sentence.
          disabledReasonId={renderFailure === null ? null : `${domId}-render-failure`}
        />
      ) : null}
      {/* Under the plot, above the Style region — and available in Tabel form
        * too: WHICH data is drawn is orthogonal to how it is shown.
        * Requirement 3: never in public mode. */}
      {dataEdit !== null && !publicMode ? (
        <ChartDataPanel
          instruction={dataEdit.instruction}
          profile={dataEdit.profile}
          lang={chartLang}
          open={dataOpen}
          onOpenChange={setDataOpen}
          triggerId={dataTriggerId}
          idPrefix={domId}
          onChange={(instruction, summary) => dispatch({ kind: 'setInstruction', instruction, summary }, 'panel')}
        />
      ) : null}
      {/* Requirement 3: never in public mode — no Style panel at all. */}
      {!tabularForm && !publicMode ? (
        <ChartConfigPanel
          resolved={resolved}
          seriesMeta={seriesMeta}
          lang={chartLang}
          open={styleOpen}
          onOpenChange={setStyleOpen}
          triggerId={styleTriggerId}
          idPrefix={domId}
          openTemplatesWhenPristine={accountStyle === null}
          onChange={(patch, meta) => dispatch({ kind: 'setPresentation', patch }, 'panel', { transient: meta?.transient === true })}
          onApplyTemplate={(id) => dispatch({ kind: 'applyTemplate', templateId: id }, 'panel')}
          onSeal={seal}
          onReset={() => dispatch({ kind: 'resetPresentation' }, 'panel')}
          account={
            signedIn
              ? {
                  hasDefault: accountStyle !== null,
                  onSave: async () => {
                    // What is on screen becomes the account default, EXCEPT a
                    // key this form locked (it was never the reader's choice)
                    // — which keeps `base`'s own value rather than dropping
                    // it, since the store writes a full row, never a merge.
                    // Same rule as chart.tsx; see its longer note there.
                    const chosen = { ...resolved.values } as Partial<typeof resolved.values>;
                    for (const key of Object.keys(resolved.locks) as (keyof typeof resolved.values)[]) {
                      (chosen as Record<string, unknown>)[key] = base[key];
                    }
                    const r = await saveMyChartStyle(chosen);
                    if (r.ok) setAccountStyle(chosen);
                    if (!r.ok) return r.reason === 'unavailable' ? 'unavailable' : 'error';
                    return 'saved';
                  },
                  onForget: async () => {
                    const r = await forgetMyChartStyle();
                    if (r.ok) setAccountStyle(null);
                    return r.ok ? 'forgotten' : 'error';
                  },
                }
              : undefined
          }
          // Same wiring as chart.tsx. `onBrandApplied` is deliberately not
          // passed: it exists only so a LATER account-default save can record
          // which brand it came from, and the applied colours themselves
          // arrive through `onChange` like every other panel change.
          brand={signedIn ? { lookup: (website) => lookupBrand(website), available: brandLookupAvailable } : undefined}
        />
      ) : null}
      {/* Own-data verified-whole parity (Task 3): the whole's own honesty
        * line — chart.tsx's `whole-note` mount point mirrored: the caveat
        * block under the chart, after the Style panel and directly above the
        * provenance/disclaimer footer (the same `text-xs text-muted-
        * foreground` prominence, never smaller), OUTSIDE the export
        * container like everything that is not a plotted value. Present
        * whenever one of the three whole forms is on screen; absent
        * otherwise. Its own test id (`own-whole-note`, not chart.tsx's
        * `whole-note`): a CBS card and an own-data card can share one page
        * (ADR 037 H2). The 100%-stacked no-share omission is appended by
        * the spec's own period labels (digit tokens the card's scan binds). */}
      {wholeForm ? (
        <p className={`mt-2 text-xs ${OWN_WHOLE_NOTE[ownWholeNoteState].className}`} data-testid="own-whole-note" data-state={ownWholeNoteState}>
          {t(chartLang, OWN_WHOLE_NOTE[ownWholeNoteState].key, { label: ownWholeNoteLabel })}
          {stackNoShareLabels.length > 0 ? ` ${t(chartLang, 'chart.ownWhole.omittedNoShare', { periods: stackNoShareLabels.join(' · ') })}` : ''}
        </p>
      ) : null}
      {/* #314: the incomplete-values note — same caveat-block placement and
        * prominence as the whole note above, outside the export container,
        * present in every form (table included) whenever a visible point is
        * incomplete. */}
      {incompletePointLabels.length > 0 ? (
        <p className="mt-2 text-xs text-warning" data-testid="own-incomplete-note">
          {t(chartLang, 'chart.ownIncomplete.note', { points: incompleteNoteLabels })}
        </p>
      ) : null}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          {/* Requirement 5: the public page's own source line — never the
            * file name (already scrubbed to '' by pruneForPublic before this
            * spec ever left the server), bound as a spec-level string
            * (U6) like every other value label on this card. USER_DATA_BADGE
            * (above) and the disclaimer line (right below, unconditional)
            * still render either way. */}
          {publicMode ? <p data-label-for="source-line">{publicSourceLine}</p> : <p>{provenanceLine}</p>}
          <p>{activeSpec.disclaimerLine}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* #318: the plotted values as a CSV, in every form (it is data,
            * not a picture of the chart) — built from the spec alone by
            * user-csv.ts, which neutralises formula-shaped text from the
            * reader's own file (ADR 037 D11). All series, hidden ones
            * included, exactly like the Tabel view.
            * Requirement 3: never in public mode — no download of any kind. */}
          {!publicMode ? <DownloadCsvButton csv={buildUserChartCsv(activeSpec, chartLang)} /> : null}
          {/* Own-data publish (ADR 057, Task 6): the flag/presence chain
            * (page.tsx → Workspace → DatasetChat/deriveDatasetVisuals) ends
            * here as `edit.publishEnabled === true` — see that field's own
            * doc comment on UserChartEditContext above. `edit` is defined
            * whenever `publishEnabled` is `true` (the field only exists on
            * `UserChartEditContext`), so `edit.turnId` below is safe. Never
            * in public mode — same posture as DownloadCsvButton right
            * above; the public route never has an edit context anyway. */}
          {edit?.publishEnabled === true && !publicMode ? (
            <OwnChartPublishButton
              turnId={edit.turnId}
              lang={chartLang}
              // Final-review fixes A4 + A5 (own-chart-publish-log.ts): the
              // SEALED log (an unfinished colour drag is part of what the
              // author sees), and only if replaying it from this card's own
              // starting document reproduces the current series/data/form —
              // `null` otherwise, which the dialog shows as "could not be
              // published exactly as shown" without calling the server.
              getLog={() => buildPublishLog(history, initial, ctxForReplay, state)}
            />
          ) : null}
          {/* The image export needs the one chart <svg> inside
            * `containerRef`: the table and heatmap draw none (they sit
            * outside the export container) and small multiples draw
            * several — so, as on the CBS card, the menu is offered only
            * where there is a picture to export. `lang`/`frame` match
            * chart.tsx's call so the export carries the chart's language
            * and the same ChartFrame the reader sees (this card has no
            * frame image, hence `null`). Requirement 3: never in public mode. */}
          {!tabularForm && !smallMultiplesOn && !publicMode ? (
            <ChartDownloadMenu
              containerRef={containerRef}
              attributionText={`${activeSpec.disclaimerLine} · checkdecijfers.nl`}
              filenameBase={`checkdecijfers-your-data-${activeSpec.provenance.datasetId}`}
              lang={chartLang}
              frame={pres}
              frameImage={null}
              syncedAt={activeSpec.provenance.capturedAt}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
