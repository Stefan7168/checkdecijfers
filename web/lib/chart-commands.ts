// Chart co-pilot phase 1 (session 112, ADR 056): the command vocabulary
// both doorways (panel/canvas now, chat in phase 2-3) write to. Pure, no
// React. A command NEVER carries a data value — only series keys, period
// codes, presentation enum values, template ids and text the reader typed.
import { z } from 'zod';
import type { ChartSpec } from '../backend/chart/types.ts';
import { validateInstructionObject } from '../backend/attachments/instruct/schema.ts';
import { reviveClientInstruction, type ClientChartInstruction, type DatasetProfile } from '../backend/attachments/types.ts';
import type { ChartNote } from '../components/chart-notes.tsx';
import {
  chartViewReducer,
  fallbackForm,
  initialViewState,
  isChartForm,
  type ChartForm,
  type ChartViewState,
} from './chart-view-state.ts';
import { sanitizeOverrides, type PresentationOverrides } from './chart-presentation.ts';
import { CHART_TEMPLATES, templateById, type ChartTemplateId } from './chart-templates.ts';

export type ChartCommandSource = 'panel' | 'canvas' | 'chat';
export const CHART_COMMAND_SOURCES: readonly ChartCommandSource[] = ['panel', 'canvas', 'chat'];

export type ChartCommandParams =
  | { kind: 'setForm'; form: ChartForm }
  | { kind: 'toggleSeries'; key: string }
  | { kind: 'setHighlight'; key: string | null }
  /** Inverse-only kind: restores hidden-set membership AND the highlight in
   * one step (undoing "hide the highlighted series", where toggleSeries's
   * own reducer coupling clears the highlight alongside the hide). Also
   * usable directly by a doorway that wants to set both in one command
   * (e.g. the chart canvas's legend, per Task 3's contract). */
  | { kind: 'setSeriesView'; hiddenKeys: string[]; highlightedKey: string | null }
  | { kind: 'setPeriodRange'; range: [string, string] | null }
  | { kind: 'setPresentation'; patch: PresentationOverrides }
  /** Full replacement — the inverse of every presentation-changing kind. */
  | { kind: 'replacePresentation'; overrides: PresentationOverrides }
  | { kind: 'resetPresentation' }
  | { kind: 'applyTemplate'; templateId: ChartTemplateId }
  | { kind: 'setReading'; index: number | null }
  /** `index` is set only by an inverse (undo of a removal) so the note
   * returns to its original position. */
  | { kind: 'addNote'; note: ChartNote; index?: number }
  | { kind: 'removeNote'; noteId: string }
  | { kind: 'setTitle'; title: string | null }
  | { kind: 'setCaption'; caption: string | null }
  /** Co-pilot phase 2 (session 113): the own-data card's data command — WHICH
   * columns, aggregate and derived reading the chart draws. Still never a
   * data value: an instruction is column ids and enum values only. `summary`
   * is the doorway's own deterministic, digit-free label for the history
   * menu (Task 6's summarizeInstruction). */
  | { kind: 'setInstruction'; instruction: ClientChartInstruction; summary: string };

export type ChartCommandKind = ChartCommandParams['kind'];
export const CHART_COMMAND_KINDS: readonly ChartCommandKind[] = [
  'setForm',
  'toggleSeries',
  'setHighlight',
  'setSeriesView',
  'setPeriodRange',
  'setPresentation',
  'replacePresentation',
  'resetPresentation',
  'applyTemplate',
  'setReading',
  'addNote',
  'removeNote',
  'setTitle',
  'setCaption',
  'setInstruction',
];

export type ChartCommand = ChartCommandParams & { id: string; at: string; source: ChartCommandSource };

export interface ChartDocState extends ChartViewState {
  notes: ChartNote[];
  /** Reader's own title; null = the spec's title. */
  title: string | null;
  caption: string | null;
  /** Co-pilot phase 2: the own-data chart's instruction; null on a CBS chart,
   * which draws a server-built spec instead. */
  instruction: ClientChartInstruction | null;
}

export const CHART_TITLE_MAX_LENGTH = 120;
export const CHART_CAPTION_MAX_LENGTH = 280;
export const CHART_NOTE_MAX_LENGTH = 280;
export const CHART_INSTRUCTION_SUMMARY_MAX_LENGTH = 120;

export function initialDocState(
  initialForm: ChartForm,
  initialPresentation: PresentationOverrides = {},
  instruction: ClientChartInstruction | null = null,
): ChartDocState {
  return { ...initialViewState(initialForm, initialPresentation), notes: [], title: null, caption: null, instruction };
}

export function newCommandId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function makeCommand(params: ChartCommandParams, source: ChartCommandSource, now: Date = new Date()): ChartCommand {
  return { ...params, id: newCommandId(), at: now.toISOString(), source };
}

function withView(state: ChartDocState, view: ChartViewState): ChartDocState {
  return { ...state, ...view };
}

export function applyCommand(state: ChartDocState, cmd: ChartCommandParams): ChartDocState {
  switch (cmd.kind) {
    case 'setForm':
      return withView(state, chartViewReducer(state, { type: 'setForm', form: cmd.form }));
    case 'toggleSeries':
      return withView(state, chartViewReducer(state, { type: 'toggleSeries', key: cmd.key }));
    case 'setHighlight':
      return withView(state, chartViewReducer(state, { type: 'setHighlight', key: cmd.key }));
    case 'setSeriesView':
      return { ...state, hiddenKeys: new Set(cmd.hiddenKeys), highlightedKey: cmd.highlightedKey };
    case 'setPeriodRange':
      return withView(state, chartViewReducer(state, { type: 'setPeriodRange', range: cmd.range }));
    case 'setPresentation':
      return withView(state, chartViewReducer(state, { type: 'setPresentation', patch: cmd.patch }));
    case 'replacePresentation':
      return { ...state, presentation: { ...cmd.overrides } };
    case 'resetPresentation':
      return withView(state, chartViewReducer(state, { type: 'resetPresentation' }));
    case 'applyTemplate':
      return { ...state, presentation: { ...templateById(cmd.templateId).overrides } };
    case 'setReading':
      return withView(state, chartViewReducer(state, { type: 'setReading', index: cmd.index }));
    case 'addNote': {
      if (state.notes.some((n) => n.id === cmd.note.id)) return state;
      const notes = [...state.notes];
      const at = cmd.index === undefined ? notes.length : Math.min(Math.max(cmd.index, 0), notes.length);
      notes.splice(at, 0, cmd.note);
      return { ...state, notes };
    }
    case 'removeNote':
      return { ...state, notes: state.notes.filter((n) => n.id !== cmd.noteId) };
    case 'setTitle':
      return { ...state, title: cmd.title };
    case 'setCaption':
      return { ...state, caption: cmd.caption };
    case 'setInstruction':
      // A data change invalidates the series keys, the zoom window and the
      // note anchors: all three name rowRefs/codes of the OLD chart. The
      // first two are reset here. The NOTES are deliberately kept: the
      // inverse can only be ONE command (a history entry carries a single
      // inverse), and restoring the instruction is the one that matters —
      // so the card filters notes to those whose resultId exists in the
      // current spec at render time, and a note comes back with its data.
      return { ...state, instruction: cmd.instruction, hiddenKeys: new Set(), highlightedKey: null, periodRange: null };
  }
}

export function invertCommand(before: ChartDocState, cmd: ChartCommandParams): ChartCommandParams {
  switch (cmd.kind) {
    case 'setForm':
      return { kind: 'setForm', form: before.form };
    case 'toggleSeries':
      return { kind: 'setSeriesView', hiddenKeys: [...before.hiddenKeys], highlightedKey: before.highlightedKey };
    case 'setSeriesView':
      return { kind: 'setSeriesView', hiddenKeys: [...before.hiddenKeys], highlightedKey: before.highlightedKey };
    case 'setHighlight':
      return { kind: 'setHighlight', key: before.highlightedKey };
    case 'setPeriodRange':
      return { kind: 'setPeriodRange', range: before.periodRange };
    case 'setPresentation':
    case 'replacePresentation':
    case 'resetPresentation':
    case 'applyTemplate':
      return { kind: 'replacePresentation', overrides: { ...before.presentation } };
    case 'setReading':
      return { kind: 'setReading', index: before.selectedReading };
    case 'addNote':
      // applyCommand treats addNote as a no-op when a note with the same id
      // already exists (before.notes) — its inverse must then also be a
      // no-op, or undoing it would delete that pre-existing note. Re-setting
      // the unchanged title is the cheapest genuine no-op; no extra kind needed.
      if (before.notes.some((n) => n.id === cmd.note.id)) return { kind: 'setTitle', title: before.title };
      return { kind: 'removeNote', noteId: cmd.note.id };
    case 'removeNote': {
      const index = before.notes.findIndex((n) => n.id === cmd.noteId);
      // Unknown id: the removal is a no-op, so its inverse is the same no-op.
      return index === -1 ? { kind: 'removeNote', noteId: cmd.noteId } : { kind: 'addNote', note: before.notes[index]!, index };
    }
    case 'setTitle':
      return { kind: 'setTitle', title: before.title };
    case 'setCaption':
      return { kind: 'setCaption', caption: before.caption };
    case 'setInstruction':
      // Nothing to go back to: the same no-op idiom addNote uses above.
      // The summary is the FORWARD command's — a doorway only ever labels
      // the instruction it is applying, so the previous one's label is not
      // recoverable here; it is a history-menu caption, never a value the
      // chart depends on.
      return before.instruction === null
        ? { kind: 'setTitle', title: before.title }
        : { kind: 'setInstruction', instruction: before.instruction, summary: cmd.summary };
  }
}

export interface CommandContext {
  spec: Pick<ChartSpec, 'kind' | 'series'>;
  alternatesCount: number;
  /** Present ONLY on an own-data card — the dataset's closed vocabulary
   * (ADR 037 D6). Its absence is what makes `setInstruction` invalid on a
   * CBS chart (D11). */
  profile?: DatasetProfile;
}

function seriesKeys(spec: CommandContext['spec']): Set<string> {
  // The SAME `s${i}` convention chart.tsx's seriesMeta uses (chart.tsx ~line 364).
  return new Set(spec.series.map((_, i) => `s${i}`));
}
function periodCodes(spec: CommandContext['spec']): Set<string> {
  const out = new Set<string>();
  for (const s of spec.series) for (const p of s.points) out.add(p.periodCode);
  return out;
}
function resultIds(spec: CommandContext['spec']): Set<string> {
  const out = new Set<string>();
  for (const s of spec.series) for (const p of s.points) out.add(p.resultId);
  return out;
}
const TEMPLATE_IDS = new Set<string>(CHART_TEMPLATES.map((t) => t.id));

function presentationValid(patch: PresentationOverrides): boolean {
  // sanitizeOverrides drops every unknown/invalid key; a patch survives only
  // if nothing was dropped and it is not empty.
  const clean = sanitizeOverrides(patch);
  const keys = Object.keys(patch);
  return keys.length > 0 && keys.every((k) => k in clean);
}

export function validateCommand(cmd: ChartCommandParams, ctx: CommandContext): boolean {
  const keys = seriesKeys(ctx.spec);
  switch (cmd.kind) {
    case 'setForm':
      return isChartForm(cmd.form) && fallbackForm(cmd.form, ctx.spec, ctx.spec.series.length) === cmd.form;
    case 'toggleSeries':
      return keys.has(cmd.key);
    case 'setHighlight':
      return cmd.key === null || keys.has(cmd.key);
    case 'setSeriesView':
      return cmd.hiddenKeys.every((k) => keys.has(k)) && (cmd.highlightedKey === null || keys.has(cmd.highlightedKey));
    case 'setPeriodRange': {
      if (cmd.range === null) return true;
      // Co-pilot phase 2 (session 113, Task 6): an own-data card has no zoom
      // control at all, and `periodCodes()` would happily accept a pair of
      // its x keys (a UserChartPoint's xKey IS mapped onto `periodCode` by
      // the card's command-spec adapter) — so a non-null range is refused
      // outright wherever a dataset profile is present. Without this rule a
      // stored/chat-borne zoom would replay onto a chart that cannot show one.
      if (ctx.profile !== undefined) return false;
      const codes = periodCodes(ctx.spec);
      return codes.has(cmd.range[0]) && codes.has(cmd.range[1]) && cmd.range[0] <= cmd.range[1];
    }
    case 'setPresentation':
      return presentationValid(cmd.patch);
    case 'replacePresentation':
      return Object.keys(cmd.overrides).length === 0 || presentationValid(cmd.overrides);
    case 'resetPresentation':
      return true;
    case 'applyTemplate':
      return TEMPLATE_IDS.has(cmd.templateId);
    case 'setReading':
      return cmd.index === null || (Number.isInteger(cmd.index) && cmd.index >= 0 && cmd.index < ctx.alternatesCount);
    case 'addNote':
      return resultIds(ctx.spec).has(cmd.note.resultId) && cmd.note.text.trim().length > 0 && cmd.note.text.length <= CHART_NOTE_MAX_LENGTH;
    case 'removeNote':
      return typeof cmd.noteId === 'string' && cmd.noteId.length > 0;
    case 'setTitle':
      return cmd.title === null || (cmd.title.trim().length > 0 && cmd.title.length <= CHART_TITLE_MAX_LENGTH);
    case 'setCaption':
      return cmd.caption === null || (cmd.caption.trim().length > 0 && cmd.caption.length <= CHART_CAPTION_MAX_LENGTH);
    case 'setInstruction': {
      // ADR 037 D11 type guard: no dataset profile, no valid instruction —
      // an own-data command can never replay onto a CBS chart, where there
      // is nothing to check its column ids against.
      if (ctx.profile === undefined) return false;
      if (cmd.summary.trim().length === 0 || cmd.summary.length > CHART_INSTRUCTION_SUMMARY_MAX_LENGTH) return false;
      // Digit-free, like every other history-menu label (R6/#254): a summary
      // is the reader's own words about columns, never a figure.
      if (/\d/.test(cmd.summary)) return false;
      try {
        // The SAME allowlist the server runs (src/attachments/instruct/
        // schema.ts) — never a second, drifting copy of those checks.
        validateInstructionObject(reviveClientInstruction(cmd.instruction), ctx.profile);
        return true;
      } catch {
        return false;
      }
    }
  }
}

const noteSchema = z.object({
  id: z.string().min(1),
  resultId: z.string().min(1),
  periodLabel: z.string(),
  seriesLabel: z.string(),
  text: z.string().max(CHART_NOTE_MAX_LENGTH),
});
const rangeSchema = z.tuple([z.string(), z.string()]).nullable();

const envelope = { id: z.string().min(1).max(64), at: z.string().min(1).max(40), source: z.enum(['panel', 'canvas', 'chat']) };

// zod 4's `.and()` on a discriminated union can lose the discriminant's
// narrowing, so the envelope fields are spread into every member instead of
// intersected on afterward.
const commandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('setForm'), form: z.enum(['line', 'area', 'bar', 'hbar', 'table']), ...envelope }),
  z.object({ kind: z.literal('toggleSeries'), key: z.string(), ...envelope }),
  z.object({ kind: z.literal('setHighlight'), key: z.string().nullable(), ...envelope }),
  z.object({ kind: z.literal('setSeriesView'), hiddenKeys: z.array(z.string()), highlightedKey: z.string().nullable(), ...envelope }),
  z.object({ kind: z.literal('setPeriodRange'), range: rangeSchema, ...envelope }),
  z.object({ kind: z.literal('setPresentation'), patch: z.record(z.string(), z.unknown()), ...envelope }),
  z.object({ kind: z.literal('replacePresentation'), overrides: z.record(z.string(), z.unknown()), ...envelope }),
  z.object({ kind: z.literal('resetPresentation'), ...envelope }),
  z.object({ kind: z.literal('applyTemplate'), templateId: z.string(), ...envelope }),
  z.object({ kind: z.literal('setReading'), index: z.number().int().nullable(), ...envelope }),
  z.object({ kind: z.literal('addNote'), note: noteSchema, index: z.number().int().optional(), ...envelope }),
  z.object({ kind: z.literal('removeNote'), noteId: z.string(), ...envelope }),
  z.object({ kind: z.literal('setTitle'), title: z.string().max(CHART_TITLE_MAX_LENGTH).nullable(), ...envelope }),
  z.object({ kind: z.literal('setCaption'), caption: z.string().max(CHART_CAPTION_MAX_LENGTH).nullable(), ...envelope }),
  // The instruction is left as a bare object here: its own schema needs the
  // dataset profile, which only the card has — `validateCommand` above runs
  // the real check at replay time.
  z.object({
    kind: z.literal('setInstruction'),
    instruction: z.record(z.string(), z.unknown()),
    summary: z.string().max(CHART_INSTRUCTION_SUMMARY_MAX_LENGTH),
    ...envelope,
  }),
]);
// The 200 cap is defensive (a sane upper bound for a stored log), not a contract other code relies on.
export const commandLogSchema = z.array(commandSchema).max(200);

/** Presentation patches are re-sanitised on parse so a stored log can never
 * inject a key the resolver does not know (defence in depth: validateCommand
 * runs again at replay). */
export function parseCommandLog(raw: unknown): ChartCommand[] | null {
  const parsed = commandLogSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.map((c) => {
    if (c.kind === 'setPresentation') return { ...c, patch: sanitizeOverrides(c.patch) } as ChartCommand;
    if (c.kind === 'replacePresentation') return { ...c, overrides: sanitizeOverrides(c.overrides) } as ChartCommand;
    return c as ChartCommand;
  });
}
