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
import { COPILOT_FORMS, PRESENTATION_KEYS, TEMPLATE_IDS, type CopilotCapabilities } from '../backend/attachments/copilot/types.ts';
import type { CbsCopilotCapabilities } from '../backend/chart/copilot/types.ts';
export type { CbsCopilotCapabilities };
import type { ClientChartInstruction, DatasetProfile, UserChartSpec } from '../backend/attachments/types.ts';
import type { ChartDocState } from './chart-commands.ts';
import { columnHeaderLabel, digitFree } from './chart-data-instruction.ts';
import { allowedForms } from './chart-fit.ts';
import type { PresentationKey } from './chart-presentation.ts';
import {
  isTabularForm,
  ownDataPieFormAllowed,
  ownDataStacked100FormAllowed,
  ownDataStackedFormAllowed,
  type ChartForm,
} from './chart-view-state.ts';
import { t, type Lang, type MessageKey } from './i18n/messages.ts';
import type { PlottableSpec } from '../components/chart.tsx';
import type { ChartSpec } from '../backend/chart/types.ts';

/** Own-data chart-fit parity (plan 2026-09-22, Task 1): the SCORER-FED forms
 * user-chart.tsx has a RENDER BRANCH for. The shared scorer can say
 * "dumbbell" for a two-point spec, but the chat must never offer a shape
 * its own panel cannot draw (plan Global Constraints) — so the scorer's
 * verdict is capped to this list: dumbbell joined in Task 2. Pie, stacked
 * and stacked100 are deliberately NOT here although user-chart.tsx renders
 * all three since Task 3: for own-data they never come from `allowedForms`
 * at all (its pie/stacked guards read the CBS roster provenance
 * `regionScope`, which an own-data spec never carries, so they are `false`
 * for every own-data spec by construction) — they come from own-data's OWN
 * shape-only guards, appended by `ownDataWholeForms` below. Keeping them
 * off this cap is also what makes the scorer's roster verdict irrelevant
 * here even for a spec that DID carry a scope (the tripwire test): the
 * three appear exactly once, from the own-data guards, never twice. */
const OWN_DATA_RENDERABLE_FORMS: readonly ChartForm[] = ['line', 'area', 'bar', 'hbar', 'table', 'dumbbell', 'slope', 'heatmap'];

/** Own-data parity (Task 3): the three whole forms, on SHAPE alone — the
 * own-data guards (chart-view-state.ts), which never read provenance: an
 * own-data chart has no registry-known roster and no published total, so
 * the forms are unconditional and the honesty lives in the note the card
 * renders under them. Same fixed order as the scorer's own tail
 * (chart-fit.ts: pie, stacked, stacked100), so the combined list below
 * keeps chart.tsx's tab order. */
function ownDataWholeForms(spec: PlottableSpec, seriesCount: number): ChartForm[] {
  const forms: ChartForm[] = [];
  if (ownDataPieFormAllowed(spec, seriesCount)) forms.push('pie');
  if (ownDataStackedFormAllowed(spec, seriesCount)) forms.push('stacked');
  if (ownDataStacked100FormAllowed(spec, seriesCount)) forms.push('stacked100');
  return forms;
}

/** Every form the own-data card can honestly show for `spec` right now, in
 * the scorer's own fixed order: chart-fit.ts's `allowedForms` — the SAME
 * scorer chart.tsx's tabs and `cbsCapabilities` below read, replacing the
 * hand-written five-guard copy this tier used to keep in step by hand —
 * capped to what user-chart.tsx actually renders, then the three whole
 * forms from own-data's own guards, last (Task 3). Exported so the cap is
 * testable on its own, apart from the wire cap `ownDataCapabilities`
 * applies on top. */
export function ownDataRenderableForms(spec: PlottableSpec, seriesCount: number): ChartForm[] {
  return [
    ...allowedForms(spec, seriesCount).filter((form) => OWN_DATA_RENDERABLE_FORMS.includes(form)),
    ...ownDataWholeForms(spec, seriesCount),
  ];
}

/** The own-data co-pilot's SERVER allowlist (src/attachments/copilot/types.ts
 * `COPILOT_FORMS`): `sanitizeCapabilities` silently drops any form off it
 * before the prompt is built, and the model's own `setForm` schema is the
 * same list. Before Task 5 (plan 2026-09-22) that list stayed at the
 * original five forms — a form the panel could already draw (slope, heatmap,
 * dumbbell, pie, stacked, stacked100) was still one the chat could not be
 * told about, since claiming it here would only have sent a value the server
 * discarded, while widening the list from here (rather than at the source,
 * together with the prompt's hand-listed forms, the `COPILOT_PROMPT_VERSION`
 * bump and the offline fixture regen, one combined change) would have
 * changed the prompt bytes of every own-data co-pilot request whose chart is
 * slope/heatmap-shaped (the e2e fixture's own 2 × 2 chart is one) and
 * orphaned the recorded fixtures. Task 5 widened `COPILOT_FORMS` to all
 * eleven forms, which is what lets every one of them through this filter —
 * still with no edit needed here. */
function isCopilotForm(form: ChartForm): form is CopilotCapabilities['forms'][number] {
  return (COPILOT_FORMS as readonly string[]).includes(form);
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
    // Three separate steps, on purpose (Task 1): what the scorer offers,
    // capped to what this card renders (`ownDataRenderableForms` — since
    // Task 3 with the own-data whole forms appended), then capped to what
    // the server will accept on the wire (`isCopilotForm`). Task 5 widened
    // the wire step (COPILOT_FORMS 5 -> 11). Neither step touches the other.
    forms: ownDataRenderableForms(spec, seriesCount).filter(isCopilotForm),
    // Intersection, not either list alone: `applicable` can name a key the
    // chat has no vocabulary for (`valueLabels`, locked per form), and
    // PRESENTATION_KEYS names keys a given form does not offer.
    presentationKeys: PRESENTATION_KEYS.filter((key) => applicable.has(key)),
    // The gallery is the Style panel's own first tab, and user-chart.tsx
    // mounts that panel for neither tabular form (table AND heatmap, the
    // shared `isTabularForm` — Task 1) — so neither offers a template. The
    // same predicate `cbsCapabilities` below reads, never a second
    // `=== 'table'` spelling.
    templates: isTabularForm(form) ? [] : [...TEMPLATE_IDS],
    // Own-data wiring of the CBS tier's co-pilot phase 6 addDerivedOverlay
    // (open-questions #289/#295's own precedent): the SAME `form === 'line'
    // || form === 'area'` test `cbsCapabilities` below uses for its own
    // `overlays` field — an overlay only ever draws on a line/area
    // rendering. NOT mentioned in the prompt text (a byte change there
    // would re-hash every fixture): enforced only at
    // src/attachments/copilot/map.ts's addDerivedOverlay case.
    overlays: form === 'line' || form === 'area',
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
 * The own-data tier reads the same scorer since Task 1 of the 2026-09-22
 * parity plan (`ownDataRenderableForms` above), capped to the forms
 * user-chart.tsx can draw — this tier's cap is chart.tsx's own tab set,
 * which already draws all eleven.
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
