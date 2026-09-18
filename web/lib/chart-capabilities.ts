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
import type { ClientChartInstruction, DatasetProfile, UserChartSpec } from '../backend/attachments/types.ts';
import type { ChartDocState } from './chart-commands.ts';
import { columnHeaderLabel, digitFree } from './chart-data-instruction.ts';
import type { PresentationKey } from './chart-presentation.ts';
import { areaFormAllowed, hbarFormAllowed, lineFormAllowed, type ChartForm } from './chart-view-state.ts';
import { t, type Lang, type MessageKey } from './i18n/messages.ts';
import type { PlottableSpec } from '../components/chart.tsx';

/** The card's own `formAllowed`, over the same three predicates — so what
 * the chat is told matches the tabs the reader can actually click. */
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
