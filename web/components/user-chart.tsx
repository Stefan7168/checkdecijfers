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
// is deliberately NOT here: small multiples, the Insights story/stage, the
// zoom window, embed/stage modes, CSV export (D11 names the CSV-injection
// defense a "Download als CSV" of user data would need), and the reading
// toggle (an own-data chart has no registry alternates).
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
import { Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { renderDatasetInstruction, type RenderDatasetInstructionOutcome } from '../app/dataset-actions.ts';
import { adjustDatasetChart, submitCopilotFeedback, type AdjustDatasetChartOutcome } from '../app/dataset-copilot-actions.ts';
import { forgetMyChartStyle, lookupBrand, saveMyChartStyle } from '../app/chart-style-actions.ts';
import {
  LINE_WIDTH_PX,
  dotGeometry,
  findFont,
  fontStack,
  markerVisible,
  resolvePresentation,
  seriesColor,
  withAccountDefault,
  type SeriesEndpoints,
} from '../lib/chart-presentation.ts';
import { useChartStyle } from '../lib/chart-style-context.tsx';
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
import { areaFormAllowed, defaultFormFor, fallbackForm, hbarFormAllowed, lineFormAllowed, type ChartForm } from '../lib/chart-view-state.ts';
import { useLang } from '../lib/i18n/lang-provider.tsx';
import { t, type Lang, type MessageKey } from '../lib/i18n/messages.ts';
import {
  AxisTick,
  buildRows,
  AXIS_COLOR,
  baselineAxisLine,
  ChartTooltip,
  GRID_LINE_PROPS,
  valueLabelPlan,
  yAxisDomain,
  type PlottableSpec,
  type Row,
  type SeriesMeta,
} from './chart.tsx';
import { ChartConfigTrigger } from './chart-config-trigger.tsx';
import { ChartCopilotInput, type CopilotReply } from './chart-copilot-input.tsx';
import { ChartDataPanel, ChartDataTrigger } from './chart-data-panel.tsx';
import { ChartDownloadMenu } from './chart-download.tsx';
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
}

/** The ONE place a UserChartSpec is narrowed to the minimal shape
 * buildRows/valueLabelPlan need — every plotted string still comes straight
 * from the spec's own `formattedValue`/`xLabel` (R6-analog: no reformatting,
 * no computation), only the field NAMES are adapted. `provisional: false`
 * throughout — this tier has no CBS publication-status concept (D7: v1
 * performs no arithmetic and carries no provisional/definitief distinction
 * at all), so nothing here is ever marked provisional. */
function toPlottableSpec(spec: UserChartSpec): PlottableSpec {
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

/** The command validator (chart-commands.ts) reads only `kind`, the series
 * INDEX, `periodCode` and `resultId`; it never touches a CBS-only field. Its
 * parameter type is nevertheless `Pick<ChartSpec, 'kind' | 'series'>`, so
 * this maps the own-data spec onto that interface with inert placeholders for
 * the CBS metadata it demands and nothing reads. D11 is untouched: the result
 * is missing every OTHER ChartSpec field (title, dims, unit, attribution, …),
 * so it still cannot be handed to `ChartView` or to any CBS builder — it
 * exists only inside `validateCommand`. */
function toCommandSpec(spec: UserChartSpec): CommandContext['spec'] {
  return {
    kind: spec.kind,
    series: spec.series.map((series) => ({
      label: series.label,
      regionCode: null,
      points: series.points.map((point) => ({
        resultId: point.rowRef,
        periodCode: point.xKey,
        periodLabel: point.xLabel,
        value: point.value,
        formattedValue: point.formattedValue,
        decimals: 0,
        status: '',
        provisional: false,
        valueAttribute: '',
      })),
    })),
  };
}

/** The rendered-spec cache's key. An instruction is a small, flat, closed-
 * vocabulary object, so its JSON is a sound identity — and it is the same
 * value the doorways hand us, never a derived label. */
function instructionKey(instruction: ClientChartInstruction | null): string {
  return JSON.stringify(instruction);
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

/**
 * The card. A thin wrapper around `UserChartCard` whose only job is the
 * spec-swap reset: the visual dock and the chat both hand the SAME mounted
 * element a different chart, and every bit of view state (form, hidden
 * series, notes, title, the rendered-spec cache) belongs to ONE chart.
 * Remounting on a new `spec` object is React's own answer to that, and the
 * card's own re-renders (a data command replaces `activeSpec` INSIDE the
 * card, never the prop) never trip it.
 */
export function UserChartView({ spec, edit }: { spec: UserChartSpec; edit?: UserChartEditContext }) {
  const [epoch, setEpoch] = useState(0);
  const lastSpec = useRef(spec);
  if (lastSpec.current !== spec) {
    lastSpec.current = spec;
    setEpoch((n) => n + 1);
  }
  return <UserChartCard key={epoch} spec={spec} edit={edit} />;
}

function UserChartCard({ spec, edit }: { spec: UserChartSpec; edit?: UserChartEditContext }) {
  const domId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const appLang = useLang();
  const { accountStyle, signedIn, setAccountStyle, brandLookupAvailable } = useChartStyle();

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
  const initialForm = defaultFormFor(toCommandSpec(spec));
  const initial = initialDocState(initialForm, {}, edit?.lastInstruction ?? null);
  const { state, history, canUndo, canRedo, dispatch, undo, redo, seal, replace } = useChartHistory(initial);

  const plottable = toPlottableSpec(activeSpec);
  const seriesCount = plottable.series.length;
  const activeForm = fallbackForm(state.form, plottable, seriesCount);

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
  const base = withAccountDefault(accountStyle);
  const resolved = resolvePresentation({ kind: activeSpec.kind, form: activeForm, seriesCount, hasProvisional: false }, state.presentation, base);
  const pres = resolved.values;
  const chartLang: Lang = pres.language ?? appLang;
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
  const plan = valueLabelPlan(plottable);
  const tickByValue = new Map(plan.axisTicks.map((tick) => [tick.value, tick]));

  // --- notes ---------------------------------------------------------------
  const [pendingPoint, setPendingPoint] = useState<PendingPoint | null>(null);
  const onPointClick = useCallback((point: PendingPoint) => setPendingPoint(point), []);
  // A note anchored to a cell the CURRENT chart no longer plots is filtered
  // here rather than deleted: `setInstruction`'s inverse can only be one
  // command (chart-commands.ts), so an undone data change must bring the
  // note back with its data.
  const plottedRowRefs = new Set(activeSpec.series.flatMap((s) => s.points.map((p) => p.rowRef)));
  const visibleNotes = state.notes.filter((note) => plottedRowRefs.has(note.resultId));

  // --- the style panel -----------------------------------------------------
  const [styleOpen, setStyleOpen] = useState(false);
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
  const heading = t(chartLang, 'userChart.heading', { y: activeSpec.yHeaders.join(', '), x: activeSpec.xHeader });
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

  // --- keyboard ------------------------------------------------------------
  function onHistoryKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
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
    return true;
  }
  function formReason(form: ChartForm): string | undefined {
    if (form === 'line') return t(chartLang, 'chart.lineDisabledReason');
    if (form === 'area')
      return activeSpec.kind === 'line'
        ? t(chartLang, 'chart.formReason.areaMultiSeries')
        : t(chartLang, 'chart.formReason.areaComparison');
    if (form === 'hbar') return t(chartLang, 'chart.formReason.hbarTimeSeries');
    return undefined;
  }
  function selectForm(next: ChartForm): void {
    // Tabel has no frame and no Style panel at all, so switching to it closes
    // the panel rather than leaving `styleOpen` stuck on a hidden region.
    if (next === 'table') setStyleOpen(false);
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
    if (edit === undefined || state.instruction === null || copilotBusy) return;
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

  /** Which doorway a reply chip can actually open right now. Tabel form
   * mounts neither the Style panel nor the notes strip, so a chip pointing
   * at either must not look clickable there. */
  function copilotCanOpen(target: ChipOpens): boolean {
    if (target === 'none') return false;
    if (target === 'style' || target === 'notes') return activeForm !== 'table';
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
  const dimmedFor = (s: SeriesMeta): boolean => state.highlightedKey !== null && state.highlightedKey !== s.key;
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
  const dotFor = (s: SeriesMeta): ReturnType<typeof UserSeriesDot> =>
    UserSeriesDot(
      s.key,
      dimmedFor(s) ? 0.25 : 1,
      s.label,
      onPointClick,
      { ...dotGeometry(pres.lineWidth), markers: pres.markers, ends: endpointsByKey.get(s.key) ?? null },
      chartLang,
    );

  const tableNode = (
    <div id={panelId} role="tabpanel" aria-label={t(chartLang, 'chart.tabTable')} className="mt-2 overflow-x-auto">
      {/* Spec strings only (U6): the header is the spec's own xHeader and
        * series labels, every cell its own `formattedValue`. No CSV export —
        * D11's CSV-injection defense is not built for this tier. */}
      <table className="w-full text-sm" aria-label={heading}>
        <thead>
          <tr>
            <th scope="col" className="border-b border-border px-2 py-1 text-left font-medium text-muted-foreground">
              {activeSpec.xHeader}
            </th>
            {seriesMeta.map((s) => (
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
              {seriesMeta.map((s) => (
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
          {activeForm === 'line' ? (
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
                  strokeOpacity={dimmedFor(s) ? 0.25 : 1}
                  data-series-dimmed={dimmedFor(s) ? 'true' : undefined}
                  connectNulls={false}
                  dot={dotFor(s)}
                  activeDot={false}
                  isAnimationActive={false}
                >
                  {showValueLabels ? valueLabels(s.key, 'top') : null}
                </Line>
              ))}
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
              {visibleSeries.map((s) => (
                <Area
                  key={s.key}
                  type="linear"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  fill={pres.areaFill === 'gradient' ? `url(#fill-${domId}-${s.key})` : s.color}
                  fillOpacity={pres.areaFill === 'gradient' ? (dimmedFor(s) ? 0.4 : 1) : dimmedFor(s) ? 0.1 : 0.25}
                  strokeWidth={LINE_WIDTH_PX[pres.lineWidth]}
                  strokeOpacity={dimmedFor(s) ? 0.25 : 1}
                  data-series-dimmed={dimmedFor(s) ? 'true' : undefined}
                  connectNulls={false}
                  dot={dotFor(s)}
                  activeDot={false}
                  isAnimationActive={false}
                >
                  {showValueLabels ? valueLabels(s.key, 'top') : null}
                </Area>
              ))}
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
                  fillOpacity={dimmedFor(s) ? 0.25 : 1}
                  data-series-dimmed={dimmedFor(s) ? 'true' : undefined}
                  isAnimationActive={false}
                >
                  {showValueLabels ? valueLabels(s.key, 'right') : null}
                </Bar>
              ))}
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
                  fillOpacity={dimmedFor(s) ? 0.25 : 1}
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
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ChartHistoryActions undo={undo} redo={redo} canUndo={canUndo} canRedo={canRedo} history={history} lang={chartLang} />
          {activeForm !== 'table' ? (
            <ChartConfigTrigger
              open={styleOpen}
              onToggle={() => setStyleOpen((open) => !open)}
              controlsId={styleControlsId}
              triggerId={styleTriggerId}
              lang={chartLang}
              compact
            />
          ) : null}
          {dataEdit !== null ? (
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
      {/* A data command that could not be drawn: one digit-free line, and the
        * previous chart stays on screen so Undo is a real way back. */}
      {renderFailure !== null ? (
        <p role="status" className="mt-2 text-xs text-warning">
          {t(chartLang, renderFailure)}
        </p>
      ) : null}
      {activeForm === 'table' ? tableNode : plotNode}
      {activeForm !== 'table' && seriesMeta.length > 1 ? (
        <>
          <SeriesLegend
            seriesMeta={seriesMeta}
            hiddenKeys={state.hiddenKeys}
            highlightedKey={state.highlightedKey}
            onToggle={(key) => dispatch({ kind: 'toggleSeries', key }, 'canvas')}
            onHighlight={(key) => dispatch({ kind: 'setHighlight', key }, 'canvas')}
            lang={chartLang}
          />
          {state.hiddenKeys.size > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t(chartLang, 'chart.hiddenSeriesDisclosure', { n: state.hiddenKeys.size, m: seriesMeta.length })}
            </p>
          ) : null}
        </>
      ) : null}
      {activeForm !== 'table' ? (
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
          />
        </div>
      ) : null}
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
      {/* Doorway B, directly under the caption (Task 8). OUTSIDE
        * `containerRef` like everything the reader wrote, so the one figure
        * it can show — the turn's credit cost — never enters an export. */}
      {dataEdit !== null ? (
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
        />
      ) : null}
      {/* Under the plot, above the Style region — and available in Tabel form
        * too: WHICH data is drawn is orthogonal to how it is shown. */}
      {dataEdit !== null ? (
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
      {activeForm !== 'table' ? (
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
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          <p>{provenanceLine}</p>
          <p>{activeSpec.disclaimerLine}</p>
        </div>
        <ChartDownloadMenu
          containerRef={containerRef}
          attributionText={`${activeSpec.disclaimerLine} · checkdecijfers.nl`}
          filenameBase={`checkdecijfers-your-data-${activeSpec.provenance.datasetId}`}
          syncedAt={activeSpec.provenance.capturedAt}
        />
      </div>
    </div>
  );
}
