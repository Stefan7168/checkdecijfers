// Co-pilot phase 2 (session 113, Task 8) — the chat doorway's two pure
// inputs. PURE: no React, no server call, no LLM.
//
// `ownDataCapabilities` is what the browser TELLS the co-pilot this chart can
// do right now. It is ADVISORY only (copilot/types.ts's own note): the
// server enum-checks it before it can reach the prompt, and the authority on
// whether a command may apply is `validateCommand` on dispatch. Its job is
// narrower — so the model refuses a request the panel could not honour
// either, instead of asking for something that is not on offer.
//
// `exampleChips` is the cheapest-mechanism half of the doorway (CLAUDE.md's
// standing rule): three deterministic, digit-free suggestions computed from
// the chart already on screen. No prompt, no spend, no new way to misfire.
import { PRESENTATION_KEYS, TEMPLATE_IDS, type CopilotCapabilities } from '../backend/attachments/copilot/types.ts';
import type { CbsCopilotCapabilities } from '../backend/chart/copilot/types.ts';
export type { CbsCopilotCapabilities };
import type { ClientChartInstruction, DatasetProfile, UserChartSpec } from '../backend/attachments/types.ts';
import type { ChartDocState } from './chart-commands.ts';
import { columnHeaderLabel, digitFree } from './chart-data-instruction.ts';
import { allowedForms } from './chart-fit.ts';
import type { PresentationKey } from './chart-presentation.ts';
import { areaFormAllowed, hbarFormAllowed, isTabularForm, lineFormAllowed, type ChartForm } from './chart-view-state.ts';
import { t, type Lang, type MessageKey } from './i18n/messages.ts';
import type { PlottableSpec } from '../components/chart.tsx';
import type { ChartSpec } from '../backend/chart/types.ts';

/** The own-data card's own `formAllowed` (user-chart.tsx), over the same
 * three predicates — so what the chat is told matches the tabs the reader
 * can actually click. Phase 5 (chart-fit scorer): deliberately still the
 * original five forms, NOT chart-fit.ts's `allowedForms` — user-chart.tsx has
 * no render branch for dumbbell/slope/heatmap yet, and the chat must never
 * offer a shape its own panel cannot draw (plan Global Constraints). */
function formsFor(spec: PlottableSpec, seriesCount: number): CopilotCapabilities['forms'] {
  const forms: CopilotCapabilities['forms'] = [];
  if (lineFormAllowed(spec, seriesCount)) forms.push('line');
  if (areaFormAllowed(spec, seriesCount)) forms.push('area');
  forms.push('bar');
  if (hbarFormAllowed(spec)) forms.push('hbar');
  forms.push('table');
  return forms;
}

export function ownDataCapabilities(input: {
  spec: PlottableSpec;
  form: ChartForm;
  seriesCount: number;
  /** `resolvePresentation(...).applicable` — which style keys this form
   * actually offers (a bar chart has no line width, a table has nothing). */
  applicable: ReadonlySet<PresentationKey>;
  lang: Lang;
}): CopilotCapabilities {
  const { spec, form, seriesCount, applicable, lang } = input;
  return {
    forms: formsFor(spec, seriesCount),
    // Intersection, not either list alone: `applicable` can name a key the
    // chat has no vocabulary for (`valueLabels`, locked per form), and
    // PRESENTATION_KEYS names keys a given form does not offer.
    presentationKeys: PRESENTATION_KEYS.filter((key) => applicable.has(key)),
    // The gallery is the Style panel's own first tab, and that panel is not
    // mounted at all in table form — so neither is a template.
    templates: form === 'table' ? [] : [...TEMPLATE_IDS],
    lang,
  };
}

// Co-pilot phase 3 (session 114, Task 2) — the CBS/Eurostat tier's own
// capability list + example chips; the type is the backend's own.

/** No data-side capability on this tier at all (R1/R6/R11: selection only).
 * Phase 5 (chart-fit scorer, session 116): the forms list comes from
 * chart-fit.ts's `allowedForms` — the SAME scorer chart.tsx's own tabs read
 * — so the chat never offers a form the reader could not also reach by
 * clicking, including the three phase-5 shapes (dumbbell/slope/heatmap).
 * Deliberately NOT `formsFor`: that stays the own-data tier's five-form
 * list until user-chart.tsx grows matching render code (plan Global
 * Constraints — CBS/Eurostat card only).
 *
 * Phase 5b follow-up (#300, #302): `allowedForms` is PURELY STRUCTURAL — it
 * reads `regionScope`, `kind` and point shape, never the live state of the
 * three verified-whole forms. chart.tsx's own Weergave tabs layer more on
 * top of that structural ceiling: a pending or refused server verdict, a
 * hidden series, an alternate reading, a missing audit row, and the
 * reader's period window (a multi-period chart windowed down to one period
 * IS pie-shaped on screen). So the caller passes (1) the WINDOWED spec plus
 * its `regionScope` — the same `wholeGuardSpec` the tabs read, hence the
 * `Pick<ChartSpec, 'regionScope'>` in the type — and (2) `liveWholeForms`,
 * the tabs' own `canUsePie`/`canUseStacked`/`canUseStacked100` verdicts.
 * The list below is the structural ceiling INTERSECTED with those live
 * gates: this only ever narrows, never widens — so the chat never offers a
 * roster form the tab itself has disabled right now, and never withholds
 * one the tab currently allows. */
export function cbsCapabilities(input: {
  /** The spec the tabs guard against (windowed series + the active
   * reading's `regionScope`), NOT the raw unwindowed `spec` prop. */
  spec: PlottableSpec & Pick<ChartSpec, 'regionScope'>;
  form: ChartForm;
  applicable: ReadonlySet<PresentationKey>;
  /** chart.tsx's own `zoomAvailable` (line kind, more than one period code). */
  zoomAvailable: boolean;
  /** chart.tsx's `canUsePie` / `canUseStacked` / `canUseStacked100` — the
   * real gated state of the three verified-whole tabs (structural guard AND
   * live verdict AND local refusals AND the period window). */
  liveWholeForms: { pie: boolean; stacked: boolean; stacked100: boolean };
  lang: Lang;
}): CbsCopilotCapabilities {
  const { spec, form, applicable, zoomAvailable, liveWholeForms, lang } = input;
  const forms = allowedForms(spec, spec.series.length).filter((f) =>
    f === 'pie' ? liveWholeForms.pie : f === 'stacked' ? liveWholeForms.stacked : f === 'stacked100' ? liveWholeForms.stacked100 : true,
  );
  return {
    forms,
    presentationKeys: PRESENTATION_KEYS.filter((key) => applicable.has(key)),
    // Phase 5 final review (Fix 3): the Style panel — and so the template
    // gallery — is mounted for neither of the two tabular forms (table AND
    // heatmap, chart.tsx's `tabularForm`), so neither may advertise a
    // template. Shared predicate, never a second `=== 'table'` spelling.
    templates: isTabularForm(form) ? [] : [...TEMPLATE_IDS],
    zoom: zoomAvailable,
    // Phase 6 final review (fix wave, #310): mirrors chart.tsx's own gate
    // on the difference/mean overlay buttons (`embed !== undefined &&
    // (activeForm === 'line' || activeForm === 'area')`) — the embed check
    // has no bearing here (this bag only ever describes a card the chat
    // doorway is open on), so the form half of that same test is what this
    // tier can see.
    overlays: form === 'line' || form === 'area',
    lang,
  };
}

/** The visible series (not hidden by `hiddenKeys`, the `s${index}` key
 * convention chart.tsx's own `seriesMeta` uses) whose LAST non-null value is
 * highest — "the line on top right now". Mirrors `topSeriesLabel` above but
 * over a `PlottableSpec` (server-drawn CBS points, not a `UserChartSpec`). */
function topVisibleCbsSeriesLabel(spec: PlottableSpec, hiddenKeys: ReadonlySet<string>): string | null {
  let best: { label: string; value: number } | null = null;
  for (const [index, series] of spec.series.entries()) {
    if (hiddenKeys.has(`s${index}`)) continue;
    const plotted = series.points.filter((p) => p.value !== null);
    const last = plotted[plotted.length - 1];
    if (last?.value == null) continue;
    if (best === null || last.value > best.value) best = { label: series.label, value: last.value };
  }
  if (best === null) return null;
  const label = digitFree(best.label);
  return label.length === 0 ? null : label;
}

const CBS_FALLBACK_KEYS_LINE: readonly MessageKey[] = [
  'chart.copilot.example.makeBar',
  'chart.copilot.example.hideGrid',
  'chart.copilot.example.newsroomLook',
];
const CBS_FALLBACK_KEYS_OTHER: readonly MessageKey[] = ['chart.copilot.example.hideGrid', 'chart.copilot.example.newsroomLook'];

/**
 * Exactly three chips for the CBS/Eurostat tier, deterministic, digit-free,
 * in this priority (Task 2 brief): (1) spotlight the top visible series on a
 * multi-series chart, (2) "only the last few years" when the zoom is on
 * offer, (3) a title suggestion per `state.title` — then fill to three from
 * the fallback list (`makeBar` skipped on a chart that is already bars).
 */
export function cbsExampleChips(input: {
  spec: PlottableSpec;
  state: Pick<ChartDocState, 'title' | 'hiddenKeys'>;
  zoomAvailable: boolean;
  lang: Lang;
}): ExampleChip[] {
  const { spec, state, zoomAvailable, lang } = input;
  const chips: ExampleChip[] = [];

  const hasVisibleSeries = spec.series.some((_, index) => !state.hiddenKeys.has(`s${index}`));
  if (spec.series.length > 1 && hasVisibleSeries) {
    const top = topVisibleCbsSeriesLabel(spec, state.hiddenKeys);
    if (top !== null) chips.push(chip(t(lang, 'chart.copilot.example.spotlight', { series: top })));
  }

  if (zoomAvailable) chips.push(chip(t(lang, 'chart.copilot.example.lastYears')));

  chips.push(chip(t(lang, state.title !== null ? 'chart.copilot.example.shorterTitle' : 'chart.copilot.example.addTitle')));

  const fallback = spec.kind === 'line' ? CBS_FALLBACK_KEYS_LINE : CBS_FALLBACK_KEYS_OTHER;
  for (const key of fallback) {
    if (chips.length >= 3) break;
    const filler = chip(t(lang, key));
    if (!chips.some((c) => c.message === filler.message)) chips.push(filler);
  }
  return chips.slice(0, 3);
}

export interface ExampleChip {
  label: string;
  /** What is SENT — always the chip's own words, so the reader asks for
   * exactly what they read. */
  message: string;
}

/** The two filler suggestions, in order, used only when the rules below
 * cannot produce three. */
const FALLBACK_KEYS: readonly MessageKey[] = ['chart.copilot.example.makeBar', 'chart.copilot.example.hideGrid'];

/** The series whose LAST non-null value is the highest — "the line on top
 * right now", which is what a reader means by "spotlight that one". A
 * structural pick over values the spec already carries; nothing is computed
 * into the label, which stays the series' own (digit-free) name. */
function topSeriesLabel(spec: UserChartSpec): string | null {
  let best: { label: string; value: number } | null = null;
  for (const series of spec.series) {
    const plotted = series.points.filter((p) => p.value !== null);
    const last = plotted[plotted.length - 1];
    if (last?.value == null) continue;
    if (best === null || last.value > best.value) best = { label: series.label, value: last.value };
  }
  if (best === null) return null;
  const label = digitFree(best.label);
  return label.length === 0 ? null : label;
}

/** Rule 1: this chart shows raw rows and the file has a column to group by. */
function aggregateChip(
  instruction: ClientChartInstruction,
  profile: DatasetProfile,
  lang: Lang,
): ExampleChip | null {
  if (instruction.aggregate !== null) return null;
  const y = instruction.y[0];
  if (y === undefined) return null;
  if (profile.columns.find((c) => c.id === y)?.type !== 'number') return null;
  const grouping = profile.columns.find((c) => c.distinct !== undefined && c.distinct.length > 0);
  if (grouping === undefined) return null;
  return chip(t(lang, 'chart.copilot.example.totalPer', { col: columnHeaderLabel(grouping.id, profile, lang) }));
}

function chip(words: string): ExampleChip {
  return { label: words, message: words };
}

/**
 * Exactly three chips, deterministic, digit-free, in the priority the Task 8
 * brief fixes: the data suggestion this chart can take, then the view one,
 * then the title one — filled from `FALLBACK_KEYS` when a rule does not
 * apply.
 */
export function exampleChips(input: {
  instruction: ClientChartInstruction;
  profile: DatasetProfile;
  spec: UserChartSpec;
  state: ChartDocState;
  lang: Lang;
}): ExampleChip[] {
  const { instruction, profile, spec, state, lang } = input;
  const chips: ExampleChip[] = [];

  const aggregate = aggregateChip(instruction, profile, lang);
  if (aggregate !== null) chips.push(aggregate);

  const top = spec.series.length > 1 ? topSeriesLabel(spec) : null;
  if (top !== null) chips.push(chip(t(lang, 'chart.copilot.example.spotlight', { series: top })));
  else if (spec.kind === 'bar') chips.push(chip(t(lang, 'chart.copilot.example.highestFirst')));

  chips.push(chip(t(lang, state.title !== null ? 'chart.copilot.example.shorterTitle' : 'chart.copilot.example.addTitle')));

  for (const key of FALLBACK_KEYS) {
    if (chips.length >= 3) break;
    const filler = chip(t(lang, key));
    if (!chips.some((c) => c.message === filler.message)) chips.push(filler);
  }
  return chips.slice(0, 3);
}
