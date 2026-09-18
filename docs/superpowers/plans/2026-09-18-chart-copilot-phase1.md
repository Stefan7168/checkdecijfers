# Chart co-pilot phase 1 — command log, undo/redo, in-place title/caption, account persistence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every edit a reader makes to a chart (panel, canvas, later chat) becomes a small serialisable command on one undo/redo history per chart, with ⌘Z/⇧⌘Z at the card, a history popover, in-place title and caption editing, and the command log saved per account in a new `chart_edits` table (migration file only; the owner applies it).

**Architecture:** A pure module `web/lib/chart-commands.ts` defines the command vocabulary with `applyCommand` / `invertCommand` / `validateCommand` over a `ChartDocState` (= today's `ChartViewState` + notes + title + caption). A pure `web/lib/chart-history.ts` keeps `{ past, future }` (one gesture = one entry; transient entries merge until sealed). A hook `web/lib/use-chart-history.ts` wraps both in one `useReducer`. `chart.tsx` swaps its `useReducer(chartViewReducer)` for that hook; every existing control dispatches a command; story/stage/spec-swap paths keep bypassing history via `dispatchRaw`. The honesty locks in `resolvePresentation`, `windowSpec`, `fallbackForm` keep running per render, unchanged. Persistence mirrors the journalist-headline feature exactly (`src/chart/headline-store.ts` → `src/chart/edits-store.ts`; `web/app/chart-headline-actions.ts` → `web/app/chart-edits-actions.ts`; migration 031 → 034; retention legs in `src/answer/audit/retention.ts`).

**Tech Stack:** TypeScript, React 19, Next.js server actions, Recharts (untouched), zod 4, vitest + @testing-library/react (jsdom) in `web/`, vitest + PGlite in the root, Playwright hermetic harness (`web/e2e`, `scripts/dev-harness`).

**Spec:** [docs/superpowers/specs/2026-09-17-chart-copilot-design.md](../specs/2026-09-17-chart-copilot-design.md) §3.1, §5 phase 1, §6, §7 decision 2. ADR [056](../../decisions/056-chart-copilot.md) decisions 1 and 4. Owner decision [#274](../../open-questions.md).

## Global Constraints

- **Zero LLM calls, zero prompt bytes** in this phase (spec §5 phase 1; CLAUDE.md "cheapest mechanism first").
- **Commands never carry numbers from the data** (R1/R6/R11 by construction): a command holds series KEYS (`s0`, `s1`…), period CODES, presentation enum values, template ids, note/title/caption text typed by the reader. `windowSpec()` stays a verbatim projection.
- **Chart edits never write audit rows** and never change an answer's numbers (ADR 056 consequences).
- **Migration is FILE-ONLY** (`migrations/034_chart_edits.sql`); never run `npm run db:migrate` against a real database in this plan. Every reader/writer degrades gracefully when the table is absent (`to_regclass` guard, the migration-031 precedent).
- **Story mode, stage mode, the spec-swap reset and the embed page's `?form=` seed are NOT history entries** — they are the app driving the view, not the reader editing it.
- **The journalist headline (`chart_headlines`, AI-drafted, digit-scanned) is untouched in this phase**: its existing edit/save flow stays as is and is not on the history. Title and caption are the two NEW in-place texts (assumption, recorded in open-questions by the docs task).
- **Copy:** every new interface string gets an `nl` AND an `en` entry in `web/lib/i18n/messages.ts` (ADR 040); Dutch first. No `chart.*` string may contain a digit (the whole-card digit scan tests).
- **Repo is public. Never name the competitor** — "Competitor G" only, and only in docs.
- **Commits:** one commit per task on `main` (owner-present session; the session pushes after the full verification block, never a subagent). Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- **Run tests from the right folder:** web tests `cd web && npx vitest run <file>`; root tests `npx vitest run <file>` from the repo root; typecheck `cd web && npm run typecheck` and root `npm run typecheck`. Run suites in the FOREGROUND and read the exit code (an OOM-killed run prints no summary — treat "no summary" as a failure, not a pass).
- Follow the file's existing comment style (why-comments, session tag "session 112") but keep new comments short.

---

## File structure

| File | Responsibility |
|---|---|
| `web/lib/chart-commands.ts` (new) | Command vocabulary, `ChartDocState`, `applyCommand`, `invertCommand`, `validateCommand`, `parseCommandLog` (zod), limits. Pure, no React. |
| `web/lib/chart-history.ts` (new) | `ChartHistory` value type + pure `pushCommand`, `seal`, `undo`, `redo`, `replayLog`, `serializeHistory`. |
| `web/lib/use-chart-history.ts` (new) | The React hook: one reducer over `{ state, history }`, `dispatch` (commands), `dispatchRaw` (view actions that bypass history), `undo`/`redo`/`seal`/`replace`. |
| `web/lib/chart-view-state.ts` (modify) | Unchanged reducer; only re-used. |
| `web/components/chart.tsx` (modify) | Swap the reducer for the hook; every control dispatches commands; undo/redo/history controls; ⌘Z; in-place title + caption; hydrate/save the log. |
| `web/components/chart-history-menu.tsx` (new) | The small history popover (list of entries with source icons + Undo/Redo). |
| `web/components/chart-config-panel.tsx` (modify) | New optional `onSeal` prop, called when a colour picker interaction ends. |
| `web/lib/i18n/messages.ts` (modify) | New `chart.history.*`, `chart.command.*`, `chart.title.*`, `chart.caption.*` keys, nl + en. |
| `migrations/034_chart_edits.sql` (new) | The table. File only. |
| `src/chart/edits-store.ts` (new) | `upsertChartEdits`, `getOwnChartEdits`, size caps, `to_regclass` guard. |
| `src/answer/audit/retention.ts` (modify) | `headlineDelete` generalised to `hardDeletes[]`; a `chart_edits` leg in all three callers. |
| `web/app/chart-edits-actions.ts` (new) | `fetchChartEdits`, `saveChartEdits` server actions. |
| `web/e2e/chart-copilot.spec.ts` (new) | Hermetic Playwright: hide a series → ⌘Z → back; hide → reload → still hidden. |
| Tests | `web/lib/chart-commands.test.ts`, `web/lib/chart-history.test.ts`, `web/lib/use-chart-history.test.ts`, `web/components/chart-commands-contract.test.tsx`, `web/components/chart-history-ui.test.tsx`, `web/components/chart-title-caption.test.tsx`, `web/components/chart-edits-persistence.test.tsx`, `tests/chart/edits-store.test.ts`, `tests/audit/retention.test.ts` (extend). |

---

### Task 1: The pure command module

**Files:**
- Create: `web/lib/chart-commands.ts`
- Test: `web/lib/chart-commands.test.ts`

**Interfaces:**
- Consumes: `ChartViewState`, `ChartForm`, `chartViewReducer`, `fallbackForm`, `initialViewState` from `web/lib/chart-view-state.ts`; `PresentationOverrides`, `sanitizeOverrides` from `web/lib/chart-presentation.ts`; `ChartTemplateId`, `CHART_TEMPLATES`, `templateById` from `web/lib/chart-templates.ts`; `ChartNote` (type only) from `web/components/chart-notes.tsx`; `ChartSpec` from `web/backend/chart/types.ts`.
- Produces (used by Tasks 2–7):

```ts
export type ChartCommandSource = 'panel' | 'canvas' | 'chat';
export type ChartCommandParams =
  | { kind: 'setForm'; form: ChartForm }
  | { kind: 'toggleSeries'; key: string }
  | { kind: 'setHighlight'; key: string | null }
  | { kind: 'setPeriodRange'; range: [string, string] | null }
  | { kind: 'setPresentation'; patch: PresentationOverrides }
  | { kind: 'replacePresentation'; overrides: PresentationOverrides }
  | { kind: 'resetPresentation' }
  | { kind: 'applyTemplate'; templateId: ChartTemplateId }
  | { kind: 'setReading'; index: number | null }
  | { kind: 'addNote'; note: ChartNote; index?: number }
  | { kind: 'removeNote'; id: string }
  | { kind: 'setTitle'; title: string | null }
  | { kind: 'setCaption'; caption: string | null };
export type ChartCommandKind = ChartCommandParams['kind'];
export const CHART_COMMAND_KINDS: readonly ChartCommandKind[];
export type ChartCommand = ChartCommandParams & { id: string; at: string; source: ChartCommandSource };
export interface ChartDocState extends ChartViewState { notes: ChartNote[]; title: string | null; caption: string | null }
export const CHART_TITLE_MAX_LENGTH = 120;
export const CHART_CAPTION_MAX_LENGTH = 280;
export const CHART_NOTE_MAX_LENGTH = 280;
export function initialDocState(initialForm: ChartForm, initialPresentation?: PresentationOverrides): ChartDocState;
export function applyCommand(state: ChartDocState, cmd: ChartCommandParams): ChartDocState;
export function invertCommand(before: ChartDocState, cmd: ChartCommandParams): ChartCommandParams;
export interface CommandContext { spec: Pick<ChartSpec, 'kind' | 'series'>; alternatesCount: number }
export function validateCommand(cmd: ChartCommandParams, ctx: CommandContext): boolean;
export function parseCommandLog(raw: unknown): ChartCommand[] | null;
export function newCommandId(): string;
export function makeCommand(params: ChartCommandParams, source: ChartCommandSource, now?: Date): ChartCommand;
```

- [ ] **Step 1: Write the failing tests**

`web/lib/chart-commands.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  CHART_COMMAND_KINDS,
  initialDocState,
  invertCommand,
  makeCommand,
  parseCommandLog,
  validateCommand,
  type ChartCommandParams,
  type ChartDocState,
} from './chart-commands.ts';
import type { ChartPoint, ChartSeries, ChartSpec } from '../backend/chart/types.ts';

function point(periodCode: string, value: number): ChartPoint {
  return { resultId: `r-${periodCode}`, periodCode, periodLabel: periodCode, value, formattedValue: String(value), provisional: false, note: null };
}
function series(label: string, codes: string[]): ChartSeries {
  return { label, regionCode: null, points: codes.map((c, i) => point(c, i + 1)) };
}
function spec(): ChartSpec {
  return {
    kind: 'line',
    title: 'Werkloosheid',
    unit: '%',
    dimLabels: {},
    series: [series('Nederland', ['2020', '2021', '2022']), series('Utrecht', ['2020', '2021', '2022'])],
    attribution: { tableId: '80590ned', tableTitle: 't', retrievedAt: '2026-01-01', period: '2020-2022' },
    provisionalNote: null,
    nullNotes: [],
    definitionLine: null,
  } as unknown as ChartSpec;
}
// If ChartPoint/ChartSeries/ChartSpec have other required fields, copy the
// exact helper shapes from web/lib/chart-view-state.test.ts instead of guessing.

const ctx = { spec: spec(), alternatesCount: 1 };

/** Deterministic PRNG so a failing run can be replayed by seed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)]!;
}
function randomCommand(r: () => number, state: ChartDocState, n: number): ChartCommandParams {
  const kind = pick(r, CHART_COMMAND_KINDS);
  switch (kind) {
    case 'setForm': return { kind, form: pick(r, ['line', 'bar', 'table'] as const) };
    case 'toggleSeries': return { kind, key: pick(r, ['s0', 's1']) };
    case 'setHighlight': return { kind, key: pick(r, ['s0', 's1', null]) };
    case 'setPeriodRange': return { kind, range: r() < 0.3 ? null : ['2020', pick(r, ['2021', '2022'])] };
    case 'setPresentation': return { kind, patch: r() < 0.5 ? { lineWidth: pick(r, ['thin', 'thick'] as const) } : { seriesColors: { 0: '#112233' } } };
    case 'replacePresentation': return { kind, overrides: { grid: 'none' } };
    case 'resetPresentation': return { kind };
    case 'applyTemplate': return { kind, templateId: pick(r, ['classic', 'newsroom'] as const) };
    case 'setReading': return { kind, index: pick(r, [null, 0]) };
    case 'addNote': return { kind, note: { id: `n${n}`, resultId: 'r-2021', periodLabel: '2021', seriesLabel: 'Nederland', text: `noot ${n}` } };
    case 'removeNote': return state.notes.length > 0 ? { kind, id: pick(r, state.notes).id } : { kind: 'setCaption', caption: null };
    case 'setTitle': return { kind, title: r() < 0.3 ? null : `titel ${n}` };
    case 'setCaption': return { kind, caption: r() < 0.3 ? null : `bijschrift ${n}` };
  }
}
/** Sets are compared as sorted arrays so deep equality is meaningful. */
function plain(s: ChartDocState): unknown {
  return { ...s, hiddenKeys: [...s.hiddenKeys].sort() };
}

describe('applyCommand / invertCommand', () => {
  it('property: for 200 random command lists, applying inverses in reverse restores the original state', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      const start = initialDocState('line', {});
      let state = start;
      const inverses: ChartCommandParams[] = [];
      const len = 1 + Math.floor(r() * 12);
      for (let i = 0; i < len; i++) {
        const cmd = randomCommand(r, state, i);
        expect(validateCommand(cmd, ctx), `seed ${seed} step ${i} ${JSON.stringify(cmd)}`).toBe(true);
        inverses.push(invertCommand(state, cmd));
        state = applyCommand(state, cmd);
      }
      for (const inv of inverses.reverse()) state = applyCommand(state, inv);
      expect(plain(state), `seed ${seed}`).toEqual(plain(start));
    }
  });

  it('undoing a note removal puts the note back at its original position', () => {
    let s = initialDocState('line');
    const a = { id: 'a', resultId: 'r-2020', periodLabel: '2020', seriesLabel: 'Nederland', text: 'a' };
    const b = { id: 'b', resultId: 'r-2021', periodLabel: '2021', seriesLabel: 'Nederland', text: 'b' };
    s = applyCommand(s, { kind: 'addNote', note: a });
    s = applyCommand(s, { kind: 'addNote', note: b });
    const remove: ChartCommandParams = { kind: 'removeNote', id: 'a' };
    const inv = invertCommand(s, remove);
    s = applyCommand(applyCommand(s, remove), inv);
    expect(s.notes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('toggleSeries hiding the highlighted series clears the highlight (the reducer coupling survives)', () => {
    let s = initialDocState('line');
    s = applyCommand(s, { kind: 'setHighlight', key: 's1' });
    s = applyCommand(s, { kind: 'toggleSeries', key: 's1' });
    expect(s.highlightedKey).toBeNull();
    expect([...s.hiddenKeys]).toEqual(['s1']);
  });

  it('applyTemplate replaces the presentation with the template overrides', () => {
    let s = initialDocState('line', { lineWidth: 'thick' });
    s = applyCommand(s, { kind: 'applyTemplate', templateId: 'classic' });
    expect(s.presentation.lineWidth).toBe('normal');
  });
});

describe('validateCommand', () => {
  it('rejects a series key, period code, reading index or form the chart does not have', () => {
    expect(validateCommand({ kind: 'toggleSeries', key: 's9' }, ctx)).toBe(false);
    expect(validateCommand({ kind: 'setHighlight', key: 's9' }, ctx)).toBe(false);
    expect(validateCommand({ kind: 'setPeriodRange', range: ['2019', '2021'] }, ctx)).toBe(false);
    expect(validateCommand({ kind: 'setPeriodRange', range: ['2022', '2020'] }, ctx)).toBe(false);
    expect(validateCommand({ kind: 'setReading', index: 1 }, ctx)).toBe(false);
    expect(validateCommand({ kind: 'setForm', form: 'hbar' }, ctx)).toBe(false); // line-kind spec: no hbar
    expect(validateCommand({ kind: 'setForm', form: 'area' }, ctx)).toBe(false); // two series: no area
    expect(validateCommand({ kind: 'addNote', note: { id: 'x', resultId: 'nope', periodLabel: '', seriesLabel: '', text: 't' } }, ctx)).toBe(false);
    expect(validateCommand({ kind: 'setTitle', title: 'x'.repeat(121) }, ctx)).toBe(false);
    expect(validateCommand({ kind: 'setCaption', caption: 'x'.repeat(281) }, ctx)).toBe(false);
    expect(validateCommand({ kind: 'setPresentation', patch: { lineWidth: 'huge' as never } }, ctx)).toBe(false);
    expect(validateCommand({ kind: 'applyTemplate', templateId: 'nope' as never }, ctx)).toBe(false);
  });
  it('accepts a line-kind two-series spec switching to bar or table', () => {
    expect(validateCommand({ kind: 'setForm', form: 'bar' }, ctx)).toBe(true);
    expect(validateCommand({ kind: 'setForm', form: 'table' }, ctx)).toBe(true);
  });
});

describe('parseCommandLog', () => {
  it('round-trips a serialised log and rejects garbage', () => {
    const log = [makeCommand({ kind: 'setForm', form: 'bar' }, 'panel'), makeCommand({ kind: 'setTitle', title: 'Kop' }, 'canvas')];
    const parsed = parseCommandLog(JSON.parse(JSON.stringify(log)));
    expect(parsed).toEqual(log);
    expect(parseCommandLog(null)).toBeNull();
    expect(parseCommandLog([{ kind: 'setForm' }])).toBeNull();
    expect(parseCommandLog([{ ...log[0], kind: 'launchMissiles' }])).toBeNull();
    expect(parseCommandLog([{ ...log[0], source: 'robot' }])).toBeNull();
  });
  it('a command carries only keys, codes, enum values and typed text — never a data value', () => {
    const log = [makeCommand({ kind: 'toggleSeries', key: 's0' }, 'canvas')];
    expect(JSON.stringify(log)).not.toMatch(/"value"|formattedValue/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run lib/chart-commands.test.ts`
Expected: FAIL — cannot resolve `./chart-commands.ts`.

- [ ] **Step 3: Write the module**

`web/lib/chart-commands.ts`:

```ts
// Chart co-pilot phase 1 (session 112, ADR 056): the command vocabulary
// both doorways (panel/canvas now, chat in phase 2-3) write to. Pure, no
// React. A command NEVER carries a data value — only series keys, period
// codes, presentation enum values, template ids and text the reader typed.
import { z } from 'zod';
import type { ChartSpec } from '../backend/chart/types.ts';
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
  | { kind: 'removeNote'; id: string }
  | { kind: 'setTitle'; title: string | null }
  | { kind: 'setCaption'; caption: string | null };

export type ChartCommandKind = ChartCommandParams['kind'];
export const CHART_COMMAND_KINDS: readonly ChartCommandKind[] = [
  'setForm', 'toggleSeries', 'setHighlight', 'setPeriodRange', 'setPresentation', 'replacePresentation',
  'resetPresentation', 'applyTemplate', 'setReading', 'addNote', 'removeNote', 'setTitle', 'setCaption',
];

export type ChartCommand = ChartCommandParams & { id: string; at: string; source: ChartCommandSource };

export interface ChartDocState extends ChartViewState {
  notes: ChartNote[];
  /** Reader's own title; null = the spec's title. */
  title: string | null;
  caption: string | null;
}

export const CHART_TITLE_MAX_LENGTH = 120;
export const CHART_CAPTION_MAX_LENGTH = 280;
export const CHART_NOTE_MAX_LENGTH = 280;

export function initialDocState(initialForm: ChartForm, initialPresentation: PresentationOverrides = {}): ChartDocState {
  return { ...initialViewState(initialForm, initialPresentation), notes: [], title: null, caption: null };
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
      return { ...state, notes: state.notes.filter((n) => n.id !== cmd.id) };
    case 'setTitle':
      return { ...state, title: cmd.title };
    case 'setCaption':
      return { ...state, caption: cmd.caption };
  }
}

export function invertCommand(before: ChartDocState, cmd: ChartCommandParams): ChartCommandParams {
  switch (cmd.kind) {
    case 'setForm':
      return { kind: 'setForm', form: before.form };
```

**The one subtle case is `toggleSeries`:** hiding the highlighted series also clears the highlight (the reducer coupling), so a plain toggle is not its own inverse. Add one more kind to the union, an inverse-only kind that restores the hidden set and the highlight in one step:

```ts
  /** Inverse-only kind: restores hidden-set membership AND the highlight in
   * one step (undoing "hide the highlighted series"). */
  | { kind: 'setSeriesView'; hiddenKeys: string[]; highlightedKey: string | null }
```

Add `'setSeriesView'` to `CHART_COMMAND_KINDS`, to `applyCommand` (`return { ...state, hiddenKeys: new Set(cmd.hiddenKeys), highlightedKey: cmd.highlightedKey }`), to the zod schema and to `validateCommand` (every key must be a real series key). Its own inverse is again a `setSeriesView` of the before-state. The rest of `invertCommand`:

```ts
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
      return { kind: 'removeNote', id: cmd.note.id };
    case 'removeNote': {
      const index = before.notes.findIndex((n) => n.id === cmd.id);
      // Unknown id: the removal is a no-op, so its inverse is the same no-op.
      return index === -1 ? { kind: 'removeNote', id: cmd.id } : { kind: 'addNote', note: before.notes[index]!, index };
    }
    case 'setTitle':
      return { kind: 'setTitle', title: before.title };
    case 'setCaption':
      return { kind: 'setCaption', caption: before.caption };
```

Update `randomCommand` in the test so `'setSeriesView'` produces `{ kind, hiddenKeys: r() < 0.5 ? ['s0'] : [], highlightedKey: pick(r, ['s0', 's1', null]) }` (and note the contract test in Task 3 maps it to the legend, same control as `toggleSeries`).

Validation and parsing:

```ts
export interface CommandContext {
  spec: Pick<ChartSpec, 'kind' | 'series'>;
  alternatesCount: number;
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
      return typeof cmd.id === 'string' && cmd.id.length > 0;
    case 'setTitle':
      return cmd.title === null || (cmd.title.trim().length > 0 && cmd.title.length <= CHART_TITLE_MAX_LENGTH);
    case 'setCaption':
      return cmd.caption === null || (cmd.caption.trim().length > 0 && cmd.caption.length <= CHART_CAPTION_MAX_LENGTH);
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
const paramsSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('setForm'), form: z.enum(['line', 'area', 'bar', 'hbar', 'table']) }),
  z.object({ kind: z.literal('toggleSeries'), key: z.string() }),
  z.object({ kind: z.literal('setHighlight'), key: z.string().nullable() }),
  z.object({ kind: z.literal('setSeriesView'), hiddenKeys: z.array(z.string()), highlightedKey: z.string().nullable() }),
  z.object({ kind: z.literal('setPeriodRange'), range: rangeSchema }),
  z.object({ kind: z.literal('setPresentation'), patch: z.record(z.string(), z.unknown()) }),
  z.object({ kind: z.literal('replacePresentation'), overrides: z.record(z.string(), z.unknown()) }),
  z.object({ kind: z.literal('resetPresentation') }),
  z.object({ kind: z.literal('applyTemplate'), templateId: z.string() }),
  z.object({ kind: z.literal('setReading'), index: z.number().int().nullable() }),
  z.object({ kind: z.literal('addNote'), note: noteSchema, index: z.number().int().optional() }),
  z.object({ kind: z.literal('removeNote'), id: z.string() }),
  z.object({ kind: z.literal('setTitle'), title: z.string().max(CHART_TITLE_MAX_LENGTH).nullable() }),
  z.object({ kind: z.literal('setCaption'), caption: z.string().max(CHART_CAPTION_MAX_LENGTH).nullable() }),
]);
const commandSchema = paramsSchema.and(
  z.object({ id: z.string().min(1).max(64), at: z.string().min(1).max(40), source: z.enum(['panel', 'canvas', 'chat']) }),
);
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
    if (c.kind === 'applyTemplate') return c as ChartCommand;
    return c as ChartCommand;
  });
}
```

Check zod 4's API names before writing (`z.discriminatedUnion`, `z.record(keySchema, valueSchema)`, `.and`); if `.and` on a discriminated union misbehaves in zod 4, write `commandSchema` as a second discriminated union whose members each spread the three envelope fields.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run lib/chart-commands.test.ts`
Expected: PASS (all describes). Then `cd web && npm run typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add web/lib/chart-commands.ts web/lib/chart-commands.test.ts
git commit -m "feat(chart): pure command vocabulary with apply/invert/validate (co-pilot phase 1, ADR 056)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: History (pure) + the React hook

**Files:**
- Create: `web/lib/chart-history.ts`, `web/lib/use-chart-history.ts`
- Test: `web/lib/chart-history.test.ts`, `web/lib/use-chart-history.test.ts`

**Interfaces:**
- Consumes: Task 1's `ChartCommand`, `ChartCommandParams`, `ChartDocState`, `applyCommand`, `invertCommand`, `validateCommand`, `CommandContext`, `makeCommand`, `initialDocState`; `ChartViewAction`, `chartViewReducer` from `chart-view-state.ts`.
- Produces:

```ts
// chart-history.ts
export interface HistoryEntry { command: ChartCommand; inverse: ChartCommandParams; transient: boolean }
export interface ChartHistory { past: HistoryEntry[]; future: HistoryEntry[] }
export const HISTORY_CAP = 200;
export function emptyHistory(): ChartHistory;
export function pushCommand(h: ChartHistory, state: ChartDocState, command: ChartCommand, opts?: { transient?: boolean }): { history: ChartHistory; state: ChartDocState };
export function seal(h: ChartHistory): ChartHistory;
export function undo(h: ChartHistory, state: ChartDocState): { history: ChartHistory; state: ChartDocState } | null;
export function redo(h: ChartHistory, state: ChartDocState): { history: ChartHistory; state: ChartDocState } | null;
export function replayLog(initial: ChartDocState, log: ChartCommand[], ctx: CommandContext): { history: ChartHistory; state: ChartDocState; dropped: number };
export function serializeHistory(h: ChartHistory): ChartCommand[]; // sealed `past` commands, oldest first
// use-chart-history.ts
export interface UseChartHistory {
  state: ChartDocState; history: ChartHistory; canUndo: boolean; canRedo: boolean;
  dispatch: (params: ChartCommandParams, source: ChartCommandSource, opts?: { transient?: boolean }) => void;
  dispatchRaw: (action: ChartViewAction) => void; // no history entry; 'reset' also clears notes/title/caption AND the history
  undo: () => void; redo: () => void; seal: () => void;
  replace: (next: { state: ChartDocState; history: ChartHistory }) => void;
}
export function useChartHistory(initial: ChartDocState): UseChartHistory;
```

- [ ] **Step 1: Write the failing tests**

`web/lib/chart-history.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { initialDocState, makeCommand } from './chart-commands.ts';
import { emptyHistory, HISTORY_CAP, pushCommand, redo, replayLog, seal, serializeHistory, undo } from './chart-history.ts';

const ctx = {
  spec: { kind: 'line' as const, series: [{ label: 'a', regionCode: null, points: [{ resultId: 'r1', periodCode: '2020', periodLabel: '2020', value: 1, formattedValue: '1', provisional: false, note: null }] }] },
  alternatesCount: 0,
};
// (Mirror the exact point/series shapes from chart-commands.test.ts if the type has more fields.)

describe('chart history', () => {
  it('push, undo, redo, and a new push after undo drops the redo stack', () => {
    let s = initialDocState('line');
    let h = emptyHistory();
    ({ history: h, state: s } = pushCommand(h, s, makeCommand({ kind: 'setForm', form: 'bar' }, 'panel')));
    ({ history: h, state: s } = pushCommand(h, s, makeCommand({ kind: 'setTitle', title: 'Kop' }, 'canvas')));
    expect(h.past).toHaveLength(2);
    const u = undo(h, s)!;
    expect(u.state.title).toBeNull();
    expect(u.history.future).toHaveLength(1);
    const r = redo(u.history, u.state)!;
    expect(r.state.title).toBe('Kop');
    const u2 = undo(r.history, r.state)!;
    const p = pushCommand(u2.history, u2.state, makeCommand({ kind: 'setCaption', caption: 'x' }, 'canvas'));
    expect(p.history.future).toHaveLength(0);
    expect(p.history.past.map((e) => e.command.kind)).toEqual(['setForm', 'setCaption']);
  });

  it('undo on an empty past and redo on an empty future return null', () => {
    const s = initialDocState('line');
    expect(undo(emptyHistory(), s)).toBeNull();
    expect(redo(emptyHistory(), s)).toBeNull();
  });

  it('transient pushes of the same target merge into ONE entry that undoes to the pre-drag state', () => {
    let s = initialDocState('line');
    let h = emptyHistory();
    for (const hex of ['#111111', '#222222', '#333333']) {
      ({ history: h, state: s } = pushCommand(h, s, makeCommand({ kind: 'setPresentation', patch: { seriesColors: { 0: hex } } }, 'panel'), { transient: true }));
    }
    expect(h.past).toHaveLength(1);
    expect(s.presentation.seriesColors).toEqual({ 0: '#333333' });
    h = seal(h);
    expect(h.past[0]!.transient).toBe(false);
    const u = undo(h, s)!;
    expect(u.state.presentation.seriesColors).toBeUndefined();
    // A transient push on a DIFFERENT target starts a new entry.
    let s2 = s;
    let h2 = h;
    ({ history: h2, state: s2 } = pushCommand(h2, s2, makeCommand({ kind: 'setPresentation', patch: { seriesColors: { 1: '#444444' } } }, 'panel'), { transient: true }));
    expect(h2.past).toHaveLength(2);
  });

  it('a non-transient push seals whatever was transient before it', () => {
    let s = initialDocState('line');
    let h = emptyHistory();
    ({ history: h, state: s } = pushCommand(h, s, makeCommand({ kind: 'setPresentation', patch: { seriesColors: { 0: '#111111' } } }, 'panel'), { transient: true }));
    ({ history: h, state: s } = pushCommand(h, s, makeCommand({ kind: 'setForm', form: 'bar' }, 'panel')));
    expect(h.past.map((e) => e.transient)).toEqual([false, false]);
  });

  it('caps the past at HISTORY_CAP, dropping the oldest', () => {
    let s = initialDocState('line');
    let h = emptyHistory();
    for (let i = 0; i < HISTORY_CAP + 5; i++) {
      ({ history: h, state: s } = pushCommand(h, s, makeCommand({ kind: 'setTitle', title: `t${i}` }, 'canvas')));
    }
    expect(h.past).toHaveLength(HISTORY_CAP);
    expect(h.past[0]!.command).toMatchObject({ kind: 'setTitle', title: 't5' });
  });

  it('serializeHistory returns the sealed past commands oldest-first and replayLog rebuilds the same state, dropping invalid ones', () => {
    let s = initialDocState('line');
    let h = emptyHistory();
    ({ history: h, state: s } = pushCommand(h, s, makeCommand({ kind: 'setForm', form: 'bar' }, 'panel')));
    ({ history: h, state: s } = pushCommand(h, s, makeCommand({ kind: 'setTitle', title: 'Kop' }, 'canvas')));
    const log = serializeHistory(h);
    expect(log.map((c) => c.kind)).toEqual(['setForm', 'setTitle']);
    const bad = makeCommand({ kind: 'toggleSeries', key: 's7' }, 'panel');
    const r = replayLog(initialDocState('line'), [...log, bad], ctx);
    expect(r.dropped).toBe(1);
    expect(r.state.form).toBe('bar');
    expect(r.state.title).toBe('Kop');
    expect(r.history.past).toHaveLength(2);
    // Undo works across a reopen: the replayed entries carry real inverses.
    expect(undo(r.history, r.state)!.state.title).toBeNull();
  });

  it('a transient top entry is NOT serialised until sealed', () => {
    let s = initialDocState('line');
    let h = emptyHistory();
    ({ history: h, state: s } = pushCommand(h, s, makeCommand({ kind: 'setPresentation', patch: { seriesColors: { 0: '#111111' } } }, 'panel'), { transient: true }));
    expect(serializeHistory(h)).toHaveLength(0);
    expect(serializeHistory(seal(h))).toHaveLength(1);
  });
});
```

`web/lib/use-chart-history.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { initialDocState } from './chart-commands.ts';
import { useChartHistory } from './use-chart-history.ts';

describe('useChartHistory', () => {
  it('dispatch records an entry; undo/redo move through it; canUndo/canRedo follow', () => {
    const { result } = renderHook(() => useChartHistory(initialDocState('line')));
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.dispatch({ kind: 'setForm', form: 'bar' }, 'panel'));
    expect(result.current.state.form).toBe('bar');
    expect(result.current.canUndo).toBe(true);
    expect(result.current.history.past[0]!.command.source).toBe('panel');
    act(() => result.current.undo());
    expect(result.current.state.form).toBe('line');
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.redo());
    expect(result.current.state.form).toBe('bar');
  });

  it('dispatchRaw applies a view action WITHOUT a history entry, and reset clears notes, title, caption and the history', () => {
    const { result } = renderHook(() => useChartHistory(initialDocState('line')));
    act(() => result.current.dispatch({ kind: 'setTitle', title: 'Kop' }, 'canvas'));
    act(() => result.current.dispatchRaw({ type: 'setView', view: { hiddenKeys: new Set(['s1']), highlightedKey: null, periodRange: null } }));
    expect([...result.current.state.hiddenKeys]).toEqual(['s1']);
    expect(result.current.history.past).toHaveLength(1);
    act(() => result.current.dispatchRaw({ type: 'reset', initialForm: 'bar' }));
    expect(result.current.state).toMatchObject({ form: 'bar', title: null, caption: null, notes: [] });
    expect(result.current.history.past).toHaveLength(0);
    expect(result.current.canUndo).toBe(false);
  });

  it('every command in one render gets a distinct id and ISO timestamp', () => {
    const { result } = renderHook(() => useChartHistory(initialDocState('line')));
    act(() => {
      result.current.dispatch({ kind: 'setTitle', title: 'a' }, 'canvas');
      result.current.dispatch({ kind: 'setTitle', title: 'b' }, 'canvas');
    });
    const [x, y] = result.current.history.past.map((e) => e.command);
    expect(x!.id).not.toBe(y!.id);
    expect(() => new Date(x!.at).toISOString()).not.toThrow();
  });

  it('replace swaps in a hydrated state + history', () => {
    const { result } = renderHook(() => useChartHistory(initialDocState('line')));
    act(() => result.current.replace({ state: { ...initialDocState('bar'), title: 'Hersteld' }, history: { past: [], future: [] } }));
    expect(result.current.state.title).toBe('Hersteld');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run lib/chart-history.test.ts lib/use-chart-history.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the two modules**

`web/lib/chart-history.ts`:

```ts
// Chart co-pilot phase 1 (session 112, ADR 056): one undo/redo history per
// chart instance. One gesture = one entry; a `transient` push (a colour
// picker mid-drag) merges into the previous transient entry of the same
// target until sealed. Pure — the hook in use-chart-history.ts owns React.
import {
  applyCommand,
  invertCommand,
  validateCommand,
  type ChartCommand,
  type ChartCommandParams,
  type ChartDocState,
  type CommandContext,
} from './chart-commands.ts';

export interface HistoryEntry {
  command: ChartCommand;
  inverse: ChartCommandParams;
  transient: boolean;
}
export interface ChartHistory {
  past: HistoryEntry[];
  future: HistoryEntry[];
}
export const HISTORY_CAP = 200;

export function emptyHistory(): ChartHistory {
  return { past: [], future: [] };
}

/** What a transient command "targets": consecutive transient pushes with the
 * same target merge. A presentation patch targets its key set (and for
 * seriesColors the series index), so dragging series 0's colour and then
 * series 1's colour are two entries. */
function transientTarget(cmd: ChartCommandParams): string {
  if (cmd.kind === 'setPresentation') {
    const keys = Object.keys(cmd.patch).sort();
    const colourIdx = cmd.patch.seriesColors ? Object.keys(cmd.patch.seriesColors).sort().join(',') : '';
    return `${cmd.kind}:${keys.join(',')}:${colourIdx}`;
  }
  return cmd.kind;
}

export function pushCommand(
  h: ChartHistory,
  state: ChartDocState,
  command: ChartCommand,
  opts: { transient?: boolean } = {},
): { history: ChartHistory; state: ChartDocState } {
  const top = h.past[h.past.length - 1];
  const next = applyCommand(state, command);
  if (opts.transient && top && top.transient && transientTarget(top.command) === transientTarget(command)) {
    // Merge: keep the first inverse (pre-drag state) and the original id/at.
    const merged: HistoryEntry = { ...top, command: { ...command, id: top.command.id, at: top.command.at } };
    return { history: { past: [...h.past.slice(0, -1), merged], future: [] }, state: next };
  }
  const sealedPast = top && top.transient ? [...h.past.slice(0, -1), { ...top, transient: false }] : h.past;
  const entry: HistoryEntry = { command, inverse: invertCommand(state, command), transient: opts.transient === true };
  const past = [...sealedPast, entry];
  return { history: { past: past.length > HISTORY_CAP ? past.slice(past.length - HISTORY_CAP) : past, future: [] }, state: next };
}

export function seal(h: ChartHistory): ChartHistory {
  const top = h.past[h.past.length - 1];
  if (!top || !top.transient) return h;
  return { ...h, past: [...h.past.slice(0, -1), { ...top, transient: false }] };
}

export function undo(h: ChartHistory, state: ChartDocState): { history: ChartHistory; state: ChartDocState } | null {
  const sealed = seal(h);
  const top = sealed.past[sealed.past.length - 1];
  if (!top) return null;
  return {
    history: { past: sealed.past.slice(0, -1), future: [top, ...sealed.future] },
    state: applyCommand(state, top.inverse),
  };
}

export function redo(h: ChartHistory, state: ChartDocState): { history: ChartHistory; state: ChartDocState } | null {
  const [head, ...rest] = h.future;
  if (!head) return null;
  // Recompute the inverse against the CURRENT state so a redo after any
  // intervening raw view change still undoes to what the reader sees now.
  const entry: HistoryEntry = { ...head, inverse: invertCommand(state, head.command), transient: false };
  return { history: { past: [...h.past, entry], future: rest }, state: applyCommand(state, head.command) };
}

export function replayLog(
  initial: ChartDocState,
  log: ChartCommand[],
  ctx: CommandContext,
): { history: ChartHistory; state: ChartDocState; dropped: number } {
  let state = initial;
  let history = emptyHistory();
  let dropped = 0;
  for (const command of log) {
    if (!validateCommand(command, ctx)) {
      dropped++;
      continue;
    }
    ({ history, state } = pushCommand(history, state, command));
  }
  return { history, state, dropped };
}

export function serializeHistory(h: ChartHistory): ChartCommand[] {
  return h.past.filter((e) => !e.transient).map((e) => e.command);
}
```

`web/lib/use-chart-history.ts`:

```ts
'use client';
// Chart co-pilot phase 1 (session 112): the one reducer chart.tsx drives.
// Commands go through the history; `dispatchRaw` is for the app moving the
// view itself (story steps, stage, the spec-swap reset, the embed page's
// `?form=` seed) — those are never a reader's edit and never undoable.
import { useCallback, useMemo, useReducer } from 'react';
import { chartViewReducer, type ChartViewAction } from './chart-view-state.ts';
import { initialDocState, makeCommand, type ChartCommandParams, type ChartCommandSource, type ChartDocState, type ChartCommand } from './chart-commands.ts';
import { emptyHistory, pushCommand, redo as redoPure, seal as sealPure, undo as undoPure, type ChartHistory } from './chart-history.ts';

interface Snapshot {
  state: ChartDocState;
  history: ChartHistory;
}
type Action =
  | { type: 'command'; command: ChartCommand; transient: boolean }
  | { type: 'raw'; action: ChartViewAction }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'seal' }
  | { type: 'replace'; next: Snapshot };

function reducer(snap: Snapshot, action: Action): Snapshot {
  switch (action.type) {
    case 'command':
      return pushCommand(snap.history, snap.state, action.command, { transient: action.transient });
    case 'raw': {
      if (action.action.type === 'reset') {
        return { state: initialDocState(action.action.initialForm, action.action.initialPresentation), history: emptyHistory() };
      }
      return { ...snap, state: { ...snap.state, ...chartViewReducer(snap.state, action.action) } };
    }
    case 'undo':
      return undoPure(snap.history, snap.state) ?? snap;
    case 'redo':
      return redoPure(snap.history, snap.state) ?? snap;
    case 'seal': {
      const history = sealPure(snap.history);
      return history === snap.history ? snap : { ...snap, history };
    }
    case 'replace':
      return action.next;
  }
}

export interface UseChartHistory {
  state: ChartDocState;
  history: ChartHistory;
  canUndo: boolean;
  canRedo: boolean;
  dispatch: (params: ChartCommandParams, source: ChartCommandSource, opts?: { transient?: boolean }) => void;
  dispatchRaw: (action: ChartViewAction) => void;
  undo: () => void;
  redo: () => void;
  seal: () => void;
  replace: (next: Snapshot) => void;
}

export function useChartHistory(initial: ChartDocState): UseChartHistory {
  const [snap, send] = useReducer(reducer, initial, (s: ChartDocState): Snapshot => ({ state: s, history: emptyHistory() }));
  // id/at are minted HERE (impure), never inside the reducer — React may
  // run a reducer twice in StrictMode and the two runs must agree.
  const dispatch = useCallback<UseChartHistory['dispatch']>((params, source, opts) => {
    send({ type: 'command', command: makeCommand(params, source), transient: opts?.transient === true });
  }, []);
  const dispatchRaw = useCallback((action: ChartViewAction) => send({ type: 'raw', action }), []);
  const undo = useCallback(() => send({ type: 'undo' }), []);
  const redo = useCallback(() => send({ type: 'redo' }), []);
  const seal = useCallback(() => send({ type: 'seal' }), []);
  const replace = useCallback((next: Snapshot) => send({ type: 'replace', next }), []);
  return useMemo(
    () => ({
      state: snap.state,
      history: snap.history,
      canUndo: snap.history.past.length > 0,
      canRedo: snap.history.future.length > 0,
      dispatch,
      dispatchRaw,
      undo,
      redo,
      seal,
      replace,
    }),
    [snap, dispatch, dispatchRaw, undo, redo, seal, replace],
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run lib/chart-history.test.ts lib/use-chart-history.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add web/lib/chart-history.ts web/lib/chart-history.test.ts web/lib/use-chart-history.ts web/lib/use-chart-history.test.ts
git commit -m "feat(chart): undo/redo history with transient merging + the useChartHistory hook (co-pilot phase 1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Wire chart.tsx to the history — every control dispatches a command; Undo/Redo + ⌘Z; the contract test

**Files:**
- Modify: `web/components/chart.tsx` (the `useReducer` at ~line 1714; dispatch sites at ~1760, 1984, 2167, 2616, 2674, 2734, 2760, 3369–3370, 3392–3396, 3708, 3770, 3799, 3846, 3996, 4012–4018; notes state ~1776; reset block ~1984–1994; card actions row ~3443)
- Modify: `web/components/chart-config-panel.tsx` (add `onSeal?: () => void`)
- Modify: `web/lib/i18n/messages.ts`
- Test: `web/components/chart-commands-contract.test.tsx`, `web/components/chart-history-ui.test.tsx`; existing `web/components/chart.test.tsx` and `chart-notes.test.tsx` must stay green.

**Interfaces:**
- Consumes: Task 2's `useChartHistory`; Task 1's `initialDocState`, `CHART_COMMAND_KINDS`.
- Produces: every dispatching control carries `data-command-kind="<kind>"` (the contract test reads it); card-level Undo/Redo buttons with `aria-label` = `t(lang,'chart.history.undo'|'chart.history.redo')`; the card root handles ⌘Z / ⇧⌘Z / Ctrl+Z / Ctrl+Y.

**Rules for the rewrite (read before touching the file):**
- Keep the variable name `state` (hundreds of reads). Replace `const [state, dispatch] = useReducer(...)` with:
  ```ts
  const {
    state, history, canUndo, canRedo,
    dispatch: dispatchCommand, dispatchRaw, undo, redo, seal: sealHistory, replace: replaceHistory,
  } = useChartHistory(initialDocState(initialForm, initialPresentation));
  ```
  and delete the `useReducer` import if nothing else uses it. Add `data-testid`-free `data-command-kind` attributes (a data attribute, no behaviour).
- **Raw (no history):** ~1760 `initialFormOverride` → `dispatchRaw({ type: 'setForm', … })`; ~1984 the spec-swap `reset` → `dispatchRaw({ type: 'reset', … })` and DELETE the now-redundant `setNotes([])` / `setPendingPoint(null)` stays; ~2167, 2674, 2734 `setView` → `dispatchRaw`; ~2760 story-step `setHighlight` → `dispatchRaw`.
- **Commands (history):**
  - `selectForm` (~2616): `dispatchCommand({ kind: 'setForm', form: next }, 'panel')`; the form tab buttons get `data-command-kind="setForm"`.
  - Legend (~3369): `onToggle={(key) => dispatchCommand({ kind: 'toggleSeries', key }, 'canvas')}`, `onHighlight={(key) => dispatchCommand({ kind: 'setHighlight', key }, 'canvas')}`. `SeriesLegend` lives in chart.tsx (find `function SeriesLegend`): add `data-command-kind="toggleSeries"` on its hide button and `data-command-kind="setHighlight"` on its highlight button, plus `data-command-kind="setSeriesView"` on the legend's wrapping element (the inverse-only kind's "control" is the legend as a whole).
  - Reading selects (~3708, ~3846): `dispatchCommand({ kind: 'setReading', index }, 'panel')`, `data-command-kind="setReading"` on both `<select>`s.
  - Zoom selects (~3770, ~3799): `dispatchCommand({ kind: 'setPeriodRange', range }, 'panel')`, `data-command-kind="setPeriodRange"` on both.
  - Panel `onChange` (~3996): transient when the patch is a colour-only change: `const transient = Object.keys(patch).every((k) => k === 'seriesColors' || k === 'frameBackground'); dispatchCommand({ kind: 'setPresentation', patch }, 'panel', { transient });` keep the `trackChartStyleEvent` calls. Pass `onSeal={sealHistory}` to `ChartConfigPanel`.
  - `onApplyTemplate` (~4012): ONE command `dispatchCommand({ kind: 'applyTemplate', templateId: id }, 'panel')`; keep `setFrameImage(null)` and the tracking call.
  - `onReset` (~4018): `dispatchCommand({ kind: 'resetPresentation' }, 'panel')`; keep the rest.
  - In `chart-config-panel.tsx`: add `onSeal?: () => void` to `ChartConfigPanelProps`; call it from the colour picker's `onBlur` and from the `ColorField`'s `onCommit` path (find the `<input type="color">` at ~line 401 and the `commit` at ~433). Put `data-command-kind="setPresentation"` on the panel's root element, `data-command-kind="applyTemplate"` on each template button (find `onApplyTemplate?.(` call sites), `data-command-kind="resetPresentation"` on the "Standaard" reset button (find `onReset()`), `data-command-kind="replacePresentation"` on the panel root too (inverse-only kind; the panel is its control) — a single element may carry only one `data-command-kind`, so use a SPACE-SEPARATED list on the root: `data-command-kind="setPresentation replacePresentation"` and have the contract test split on whitespace.
  - Notes (~3384–3396): `notes={state.notes}`; `onSave` → `dispatchCommand({ kind: 'addNote', note: { id: `${pendingPoint.resultId}-${newCommandId()}`, ...pendingPoint, text } }, 'canvas')` (drop `noteIdCounter`); `onDelete={(id) => dispatchCommand({ kind: 'removeNote', noteId: id }, 'canvas')}`. Delete the `const [notes, setNotes] = useState…` line. In `chart-notes.tsx` add `data-command-kind="addNote"` on the Save button and `data-command-kind="removeNote"` on each delete button (find them by their `t(lang, 'chart.notes.…')` labels).
  - `setTitle`/`setCaption` get their controls in Task 5; the contract test in this task lists them as `pending` via `it.todo` and Task 5 turns them into real assertions.
- **Undo/Redo controls:** a new small group rendered in the card header's right column, BEFORE the existing `data-slot="chart-card-actions"` block and gated `!embedMode && !inStage` (NOT gated on form — undo must work on the table form too):
  ```tsx
  {!embedMode && !inStage ? (
    <div className="flex shrink-0 items-center gap-1" data-slot="chart-history-actions">
      <Button type="button" variant="ghost" size="sm" onClick={undo} disabled={!canUndo} aria-label={t(chartLang, 'chart.history.undo')} title={t(chartLang, 'chart.history.undoHint')}>
        <Undo2 className="size-4" aria-hidden="true" />
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={redo} disabled={!canRedo} aria-label={t(chartLang, 'chart.history.redo')} title={t(chartLang, 'chart.history.redoHint')}>
        <Redo2 className="size-4" aria-hidden="true" />
      </Button>
      {/* Task 4 adds <ChartHistoryMenu …/> here */}
    </div>
  ) : null}
  ```
  `Undo2`/`Redo2` come from `lucide-react` (already a dependency; check how other components import icons, e.g. `grep -rn "from 'lucide-react'" web/components | head -3`).
- **Keyboard:** on the card root `<div className={frameClass}>` add `onKeyDown={onHistoryKeyDown}`:
  ```ts
  function onHistoryKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (embedMode || inStage) return;
    if (!(event.metaKey || event.ctrlKey)) return;
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    // A text field's own undo wins (native ⌘Z inside an input/textarea).
    if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && event.shiftKey) { event.preventDefault(); redo(); return; }
    if (key === 'z') { event.preventDefault(); undo(); return; }
    if (key === 'y' && event.ctrlKey) { event.preventDefault(); redo(); }
  }
  ```
  (`KeyboardEvent` is already imported as a type from 'react' in chart.tsx.)
- **i18n keys (nl / en)** — add next to the existing `chart.headline.*` block in BOTH `nl` and `en`:
  ```
  'chart.history.undo': 'Ongedaan maken' / 'Undo'
  'chart.history.redo': 'Opnieuw' / 'Redo'
  'chart.history.undoHint': 'Ongedaan maken (⌘Z / Ctrl+Z)' / 'Undo (⌘Z / Ctrl+Z)'
  'chart.history.redoHint': 'Opnieuw (⇧⌘Z / Ctrl+Y)' / 'Redo (⇧⌘Z / Ctrl+Y)'
  ```

- [ ] **Step 1: Write the failing tests**

`web/components/chart-commands-contract.test.tsx` — the spec §6 "no chat-only capability" contract, in its phase-1 form: every command kind has an on-screen control.

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartStyleProvider } from '../lib/chart-style-context.tsx';
import { CHART_COMMAND_KINDS, type ChartCommandKind } from '../lib/chart-commands.ts';
import type { ChartSpec } from '../backend/chart/types.ts';

// Same server-action mocks as chart-headline-ui.test.tsx (copy that file's
// vi.hoisted/vi.mock block verbatim — chart.tsx imports these modules).
// ...

import { ChartView } from './chart.tsx';

function twoSeriesLineSpec(): ChartSpec { /* copy from chart.test.tsx (search `function twoSeriesLineSpec`) */ }

afterEach(cleanup);

/** Kinds whose control only exists inside the open Style panel. */
const PANEL_KINDS: ChartCommandKind[] = ['setPresentation', 'replacePresentation', 'resetPresentation', 'applyTemplate'];
/** Kinds whose control only exists once a point has been clicked / a note exists. */
const NOTE_KINDS: ChartCommandKind[] = ['addNote', 'removeNote'];

function kindsInDom(container: HTMLElement): Set<string> {
  const out = new Set<string>();
  for (const el of container.querySelectorAll('[data-command-kind]')) {
    for (const k of (el.getAttribute('data-command-kind') ?? '').split(/\s+/)) if (k) out.add(k);
  }
  return out;
}

describe('command ↔ control contract (ADR 056 decision 2, phase-1 form)', () => {
  it('every command kind is reachable from an on-screen control', async () => {
    const { container } = render(
      <ChartStyleProvider initialStyle={null} signedIn={false} brandLookupAvailable={false}>
        <ChartView spec={twoSeriesLineSpec()} alternates={[{ label: 'alt', spec: twoSeriesLineSpec() }]} embed={{ auditId: 1 }} />
      </ChartStyleProvider>,
    );
    // (Check ChartStyleProvider's real prop names in web/lib/chart-style-context.tsx.)
    // Open the style panel so its kinds mount.
    fireEvent.click(screen.getByRole('button', { name: /Opmaak/ }));
    // Click a plotted point so the note editor mounts, then save a note so a delete button exists.
    const point = container.querySelector('[data-label-for], .recharts-dot, [role="button"][aria-label*="notitie" i]');
    if (point) fireEvent.click(point);
    // (If the click-to-annotate affordance needs a different selector, take it from chart-notes.test.tsx.)
    const found = kindsInDom(container);
    const missing = CHART_COMMAND_KINDS.filter((k) => !found.has(k) && !NOTE_KINDS.includes(k) && k !== 'setTitle' && k !== 'setCaption');
    expect(missing, `command kinds with no control: ${missing.join(', ')}`).toEqual([]);
    expect(PANEL_KINDS.every((k) => found.has(k))).toBe(true);
  });
  it.todo('setTitle and setCaption have in-place controls (Task 5 turns this on)');
  it('addNote/removeNote controls exist in the notes editor (rendered directly)', async () => {
    const { ChartNotes } = await import('./chart-notes.tsx');
    const { container } = render(
      <ChartNotes
        notes={[{ id: 'n1', resultId: 'r', periodLabel: '2020', seriesLabel: 'NL', text: 'x' }]}
        pendingPoint={{ resultId: 'r', periodLabel: '2020', seriesLabel: 'NL' }}
        idPrefix="t"
        onSave={() => {}}
        onCancelPending={() => {}}
        onDelete={() => {}}
      />,
    );
    const found = kindsInDom(container);
    expect(found.has('addNote')).toBe(true);
    expect(found.has('removeNote')).toBe(true);
  });
});
```

`web/components/chart-history-ui.test.tsx`:

```tsx
// Same mock block as chart-headline-ui.test.tsx at the top.
import { ChartView } from './chart.tsx';
import { twoSeriesLineSpec } from './chart.test-fixtures.ts'; // if chart.test.tsx does not export fixtures, copy the factory inline

describe('undo / redo at the chart card', () => {
  it('hiding a series then Undo brings it back; Redo hides it again', () => {
    const { container } = render(<ChartView spec={twoSeriesLineSpec()} />);
    expect(container.querySelectorAll('.recharts-line-curve')).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: /verberg|hide/i })[0]!); // take the exact label from SeriesLegend's t() key
    expect(container.querySelectorAll('.recharts-line-curve')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
    expect(container.querySelectorAll('.recharts-line-curve')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw' }));
    expect(container.querySelectorAll('.recharts-line-curve')).toHaveLength(1);
  });

  it('⌘Z on the card undoes; ⇧⌘Z redoes; both buttons are disabled when there is nothing to do', () => {
    const { container } = render(<ChartView spec={twoSeriesLineSpec()} />);
    const undoBtn = screen.getByRole('button', { name: 'Ongedaan maken' });
    expect(undoBtn).toBeDisabled();
    fireEvent.click(screen.getByRole('tab', { name: /Staaf|Bar/ }));
    expect(undoBtn).toBeEnabled();
    fireEvent.keyDown(container.firstElementChild!, { key: 'z', metaKey: true });
    expect(screen.getByRole('tab', { name: /Lijn|Line/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(container.firstElementChild!, { key: 'z', metaKey: true, shiftKey: true });
    expect(screen.getByRole('tab', { name: /Staaf|Bar/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('⌘Z inside a text field is left to the field', () => {
    render(<ChartView spec={twoSeriesLineSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: /Staaf|Bar/ }));
    // The zoom <select> is not a text field, but an <input> is: use the headline input if present, otherwise skip.
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'z', metaKey: true });
    expect(screen.getByRole('tab', { name: /Staaf|Bar/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('a story step and the spec-swap reset never create history entries', () => {
    // Render with a spec, switch form (1 entry), then rerender with a different spec: Undo is disabled again.
    const { rerender } = render(<ChartView spec={twoSeriesLineSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: /Staaf|Bar/ }));
    expect(screen.getByRole('button', { name: 'Ongedaan maken' })).toBeEnabled();
    const other = twoSeriesLineSpec();
    other.title = 'Andere grafiek';
    rerender(<ChartView spec={other} />);
    expect(screen.getByRole('button', { name: 'Ongedaan maken' })).toBeDisabled();
  });

  it('embed mode and stage mode render no undo controls', () => {
    render(<ChartView spec={twoSeriesLineSpec()} embedMode embed={{ auditId: 1 }} embedFooter="x" />);
    expect(screen.queryByRole('button', { name: 'Ongedaan maken' })).toBeNull();
  });

  it('the embed dialog still receives the current form (serialises the same state as before)', () => {
    // chart-embed-dialog.test.tsx already pins `currentForm`; here only assert the prop path did not break:
    render(<ChartView spec={twoSeriesLineSpec()} embed={{ auditId: 1 }} />);
    fireEvent.click(screen.getByRole('tab', { name: /Staaf|Bar/ }));
    fireEvent.click(screen.getByRole('button', { name: /Embed/ }));
    expect(screen.getByText(/form=bar|Staaf/)).toBeTruthy(); // adjust to what the dialog actually renders for "as shown"
  });
});
```

Take every exact accessible name from the existing tests (`chart.test.tsx` for the tab names and legend buttons, `chart-embed-dialog.test.tsx` for the embed dialog) — never guess a label.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run components/chart-commands-contract.test.tsx components/chart-history-ui.test.tsx`
Expected: FAIL — no `data-command-kind` attributes, no Undo button.

- [ ] **Step 3: Implement the rewrite per the rules above**

Also add the i18n keys. Keep `chartViewReducer` and `ChartViewAction` exports untouched.

- [ ] **Step 4: Run the full web suite + typecheck**

Run: `cd web && npm run typecheck && npx vitest run`
Expected: all green, including the existing `chart.test.tsx` (its digit-scan tests must still pass — the new buttons carry no digits; the ⌘Z hint strings contain no digits either) and `chart-notes.test.tsx`. Fix any test that pinned the old `noteIdCounter` id format by asserting on behaviour, not the id string.

- [ ] **Step 5: Commit**

```bash
git add web/components/chart.tsx web/components/chart-config-panel.tsx web/components/chart-notes.tsx web/lib/i18n/messages.ts web/components/chart-commands-contract.test.tsx web/components/chart-history-ui.test.tsx
git commit -m "feat(chart): every control dispatches a command; Undo/Redo + ⌘Z at the card; command↔control contract test (co-pilot phase 1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The history popover

**Files:**
- Create: `web/components/chart-history-menu.tsx`
- Modify: `web/components/chart.tsx` (mount it in the `chart-history-actions` group), `web/lib/i18n/messages.ts`
- Test: `web/components/chart-history-menu.test.tsx`

**Interfaces:**
- Consumes: `ChartHistory`, `HistoryEntry` (Task 2); `ChartCommand` (Task 1); `t`, `Lang`; `DropdownMenu*` from `./ui/dropdown-menu.tsx` (see `thread-sidebar.tsx` for the house usage).
- Produces:

```ts
export function describeCommand(cmd: ChartCommand, lang: Lang): string; // one plain sentence, no digits from data
export function ChartHistoryMenu(props: { history: ChartHistory; lang: Lang; onUndoTo: (index: number) => void; onRedoTo: (index: number) => void }): JSX.Element;
```

Behaviour: a ghost `Button` with a `History` lucide icon, `aria-label` `chart.history.menu`; opens a `DropdownMenu` listing `past` newest-first (each: source icon — `SlidersHorizontal` for panel, `MousePointerClick` for canvas, `MessageSquare` for chat — with an `sr-only` label from `chart.history.source.<source>`, then the description) followed by `future` items dimmed (`text-muted-foreground`) with the `chart.history.undone` prefix. Clicking a past item calls `onUndoTo(i)` (undo until that entry is the newest remaining → i.e. undo `past.length - 1 - i` times); clicking a future item calls `onRedoTo(i)` (redo `i + 1` times). Empty state: one disabled item `chart.history.empty`.

`describeCommand` uses these keys (nl / en):
```
'chart.command.setForm': 'Weergave: {form}' / 'View: {form}'         — {form} = t(lang,'chart.form.<form>') if such keys exist, else the form word from the tablist labels
'chart.command.toggleSeries': 'Reeks verborgen of getoond' / 'Series hidden or shown'
'chart.command.setSeriesView': 'Reeksen hersteld' / 'Series restored'
'chart.command.setHighlight': 'Reeks in de schijnwerper' / 'Series highlighted'
'chart.command.setHighlightOff': 'Schijnwerper uit' / 'Highlight off'
'chart.command.setPeriodRange': 'Periode aangepast' / 'Period adjusted'
'chart.command.setPeriodRangeOff': 'Hele periode' / 'Full period'
'chart.command.setPresentation': 'Opmaak: {keys}' / 'Style: {keys}'   — {keys} = the patch's key names joined by ', '
'chart.command.replacePresentation': 'Opmaak hersteld' / 'Style restored'
'chart.command.resetPresentation': 'Opmaak teruggezet' / 'Style reset'
'chart.command.applyTemplate': 'Sjabloon: {id}' / 'Template: {id}'
'chart.command.setReading': 'Andere lezing' / 'Other reading'
'chart.command.addNote': 'Notitie toegevoegd' / 'Note added'
'chart.command.removeNote': 'Notitie verwijderd' / 'Note removed'
'chart.command.setTitle': 'Titel aangepast' / 'Title edited'
'chart.command.setTitleOff': 'Titel hersteld' / 'Title restored'
'chart.command.setCaption': 'Bijschrift aangepast' / 'Caption edited'
'chart.command.setCaptionOff': 'Bijschrift verwijderd' / 'Caption removed'
'chart.history.menu': 'Geschiedenis van bewerkingen' / 'Edit history'
'chart.history.empty': 'Nog geen bewerkingen' / 'No edits yet'
'chart.history.undone': 'ongedaan gemaakt' / 'undone'
'chart.history.source.panel': 'via het paneel' / 'via the panel'
'chart.history.source.canvas': 'op de grafiek' / 'on the chart'
'chart.history.source.chat': 'via de chat' / 'via chat'
```
`{form}`, `{keys}`, `{id}` never contain digits from data (form/template ids and presentation key names are enum strings) — the digit-scan tests stay clean. The `t()` helper supports `{var}` substitution (see its signature at messages.ts ~line 1681).

- [ ] **Step 1: Write the failing test** (`web/components/chart-history-menu.test.tsx`)

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeCommand } from '../lib/chart-commands.ts';
import type { ChartHistory } from '../lib/chart-history.ts';
import { ChartHistoryMenu, describeCommand } from './chart-history-menu.tsx';

afterEach(cleanup);

function history(): ChartHistory {
  return {
    past: [
      { command: makeCommand({ kind: 'setForm', form: 'bar' }, 'panel'), inverse: { kind: 'setForm', form: 'line' }, transient: false },
      { command: makeCommand({ kind: 'toggleSeries', key: 's1' }, 'canvas'), inverse: { kind: 'setSeriesView', hiddenKeys: [], highlightedKey: null }, transient: false },
    ],
    future: [{ command: makeCommand({ kind: 'setTitle', title: 'Kop' }, 'canvas'), inverse: { kind: 'setTitle', title: null }, transient: false }],
  };
}

describe('ChartHistoryMenu', () => {
  it('lists past entries newest-first with their source, then undone entries dimmed', () => {
    render(<ChartHistoryMenu history={history()} lang="nl" onUndoTo={() => {}} onRedoTo={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Geschiedenis van bewerkingen' }));
    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toHaveTextContent('Reeks verborgen of getoond');
    expect(items[0]).toHaveTextContent('op de grafiek');
    expect(items[1]).toHaveTextContent('Weergave');
    expect(items[2]).toHaveTextContent('ongedaan gemaakt');
  });
  it('clicking a past entry undoes back to it; clicking an undone entry redoes up to it', () => {
    const onUndoTo = vi.fn();
    const onRedoTo = vi.fn();
    render(<ChartHistoryMenu history={history()} lang="nl" onUndoTo={onUndoTo} onRedoTo={onRedoTo} />);
    fireEvent.click(screen.getByRole('button', { name: 'Geschiedenis van bewerkingen' }));
    const items = screen.getAllByRole('menuitem');
    fireEvent.click(items[1]!);
    expect(onUndoTo).toHaveBeenCalledWith(0);
    fireEvent.click(items[2]!);
    expect(onRedoTo).toHaveBeenCalledWith(0);
  });
  it('empty history shows the empty line', () => {
    render(<ChartHistoryMenu history={{ past: [], future: [] }} lang="en" onUndoTo={() => {}} onRedoTo={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit history' }));
    expect(screen.getByText('No edits yet')).toBeTruthy();
  });
  it('describeCommand never emits a digit for a command without typed text', () => {
    const cmds = [
      makeCommand({ kind: 'setPeriodRange', range: ['2020JJ00', '2024JJ00'] }, 'panel'),
      makeCommand({ kind: 'setPresentation', patch: { lineWidth: 'thick', seriesColors: { 0: '#112233' } } }, 'panel'),
      makeCommand({ kind: 'setReading', index: 2 }, 'panel'),
    ];
    for (const c of cmds) expect(describeCommand(c, 'nl')).not.toMatch(/\d/);
  });
});
```

If the dropdown primitive renders items with a different role in jsdom, take the role from `thread-sidebar`'s own test.

- [ ] **Step 2: Run to verify it fails.** `cd web && npx vitest run components/chart-history-menu.test.tsx` → module not found.

- [ ] **Step 3: Implement** `chart-history-menu.tsx` + the keys + the mount in chart.tsx:

```tsx
<ChartHistoryMenu
  history={history}
  lang={chartLang}
  onUndoTo={(i) => { for (let n = history.past.length - 1 - i; n > 0; n--) undo(); }}
  onRedoTo={(i) => { for (let n = 0; n <= i; n++) redo(); }}
/>
```
(`undo`/`redo` are reducer sends, so several in one handler queue correctly.)

- [ ] **Step 4: Run** `cd web && npm run typecheck && npx vitest run components/chart-history-menu.test.tsx components/chart.test.tsx` → green (the digit-scan tests in chart.test.tsx must stay green with the menu button in the card).

- [ ] **Step 5: Commit**

```bash
git add web/components/chart-history-menu.tsx web/components/chart-history-menu.test.tsx web/components/chart.tsx web/lib/i18n/messages.ts
git commit -m "feat(chart): edit-history popover with source icons; click to undo/redo to an entry (co-pilot phase 1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: In-place title and caption editing

**Files:**
- Modify: `web/components/chart.tsx` (heading at ~3413–3423: `{displaySpec.title}`; a caption block directly ABOVE `{!styleOpen ? notesNode : null}` at ~4253 and in the dock/modal layout where `notesNode` is placed ~3958 — put the caption INSIDE `notesNode`'s sibling position, i.e. define `captionNode` next to `notesNode` and render it wherever `notesNode` is rendered, just before it), `web/lib/i18n/messages.ts`
- Modify: `web/components/chart-commands-contract.test.tsx` (turn the `it.todo` into a real assertion)
- Test: `web/components/chart-title-caption.test.tsx`

**Interfaces:**
- Consumes: `state.title`, `state.caption`, `dispatchCommand`, `CHART_TITLE_MAX_LENGTH`, `CHART_CAPTION_MAX_LENGTH`.
- Produces: heading shows `state.title ?? displaySpec.title`; when a title override is set, the ORIGINAL spec title moves into the subtitle line as its first span (the official measure name never leaves the card); a caption paragraph `data-testid="chart-caption"`; controls with `data-command-kind="setTitle"` / `"setCaption"`.

Behaviour:
- Not in `embedMode`, not `inStage`: the heading gets a small ghost "edit" button next to it (`Pencil` icon, `aria-label` `chart.title.edit`, `data-command-kind="setTitle"`). Clicking it (or double-clicking the heading) swaps the heading for an `<input maxLength={CHART_TITLE_MAX_LENGTH}>` prefilled with the current display title; Enter or blur commits `dispatchCommand({ kind: 'setTitle', title: trimmed === '' || trimmed === displaySpec.title ? null : trimmed }, 'canvas')` (only when it differs from `state.title`); Escape cancels. Only the reader's own text is ever stored (an unchanged spec title stays `null`).
- In embed mode / stage mode: render `state.title ?? displaySpec.title` read-only (the embed page will show the persisted title once Task 7 hydrates; for the public embed route that is a later phase — it does not fetch the log; note it in the docs task).
- Caption: when `state.caption === null`, a quiet text button `chart.caption.add` (`data-command-kind="setCaption"`); when set, a `<p data-testid="chart-caption" className="mt-2 text-sm text-muted-foreground">` with an edit button. The editor is a single-line `<input maxLength={CHART_CAPTION_MAX_LENGTH}>` with Save/Cancel buttons (same markup pattern as the headline editor at ~3491); Save with an empty value dispatches `setCaption null`.
- Both editors render OUTSIDE `chartContainerRef` (the export never includes them — same rule as notes; state that in a one-line comment).
- i18n (nl / en):
  ```
  'chart.title.edit': 'Titel bewerken' / 'Edit title'
  'chart.title.placeholder': 'Eigen titel' / 'Your own title'
  'chart.title.original': 'Oorspronkelijke titel: {title}' / 'Original title: {title}'   — the sr-only/`title` attribute on the subtitle span
  'chart.caption.add': 'Bijschrift toevoegen' / 'Add a caption'
  'chart.caption.edit': 'Bijschrift bewerken' / 'Edit caption'
  'chart.caption.placeholder': 'Bijschrift onder de grafiek' / 'Caption under the chart'
  'chart.caption.save': 'Opslaan' / 'Save'
  'chart.caption.cancel': 'Annuleren' / 'Cancel'
  ```

- [ ] **Step 1: Write the failing tests** (`web/components/chart-title-caption.test.tsx`, same mock block as `chart-headline-ui.test.tsx`)

```tsx
describe('in-place title', () => {
  it('editing the title replaces the heading, keeps the spec title in the subtitle, and Undo restores it', () => {
    render(<ChartView spec={twoSeriesLineSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Titel bewerken' }));
    const input = screen.getByPlaceholderText('Eigen titel') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Mijn kop' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Mijn kop');
    expect(screen.getByText(twoSeriesLineSpec().title)).toBeTruthy(); // the original in the subtitle
    fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(twoSeriesLineSpec().title);
  });
  it('an empty or unchanged title clears the override (no history entry for a no-op)', () => {
    render(<ChartView spec={twoSeriesLineSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Titel bewerken' }));
    fireEvent.keyDown(screen.getByPlaceholderText('Eigen titel'), { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Ongedaan maken' })).toBeDisabled();
  });
  it('Escape cancels without a history entry; a title longer than the cap is cut by the input', () => {
    render(<ChartView spec={twoSeriesLineSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Titel bewerken' }));
    const input = screen.getByPlaceholderText('Eigen titel') as HTMLInputElement;
    expect(input.maxLength).toBe(120);
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Ongedaan maken' })).toBeDisabled();
  });
  it('embed mode shows no edit button', () => {
    render(<ChartView spec={twoSeriesLineSpec()} embedMode embed={{ auditId: 1 }} embedFooter="x" />);
    expect(screen.queryByRole('button', { name: 'Titel bewerken' })).toBeNull();
  });
});

describe('caption', () => {
  it('adding, editing and removing a caption are three undoable steps', () => {
    render(<ChartView spec={twoSeriesLineSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bijschrift toevoegen' }));
    fireEvent.change(screen.getByPlaceholderText('Bijschrift onder de grafiek'), { target: { value: 'Bron: eigen bewerking' } });
    fireEvent.click(screen.getByRole('button', { name: 'Opslaan' }));
    expect(screen.getByTestId('chart-caption')).toHaveTextContent('Bron: eigen bewerking');
    fireEvent.click(screen.getByRole('button', { name: 'Bijschrift bewerken' }));
    fireEvent.change(screen.getByPlaceholderText('Bijschrift onder de grafiek'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Opslaan' }));
    expect(screen.queryByTestId('chart-caption')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
    expect(screen.getByTestId('chart-caption')).toHaveTextContent('Bron: eigen bewerking');
  });
  it('the caption is rendered outside the export container', () => {
    const { container } = render(<ChartView spec={twoSeriesLineSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bijschrift toevoegen' }));
    fireEvent.change(screen.getByPlaceholderText('Bijschrift onder de grafiek'), { target: { value: 'tekst' } });
    fireEvent.click(screen.getByRole('button', { name: 'Opslaan' }));
    const svgHost = container.querySelector('.recharts-wrapper')!.closest('[data-chart-container], [data-testid="chart-container"]');
    // Use whatever attribute chartContainerRef's div carries (grep `ref={chartContainerRef}` in chart.tsx and add data-testid="chart-container" if it has none).
    expect(svgHost?.contains(screen.getByTestId('chart-caption'))).toBe(false);
  });
});
```

And in the contract test replace the `it.todo` with a test that renders `ChartView` (non-embed) and asserts `kindsInDom(container)` has `setTitle` and `setCaption`.

- [ ] **Step 2: Run to verify failure.** `cd web && npx vitest run components/chart-title-caption.test.tsx components/chart-commands-contract.test.tsx`

- [ ] **Step 3: Implement** per the behaviour list. Reuse `Button` from `./ui/button.tsx` and the headline editor's class strings for the inputs.

- [ ] **Step 4: Run** `cd web && npm run typecheck && npx vitest run` — the whole web suite green (the digit-scan tests render no title override, so nothing new to bind; the new strings carry no digits).

- [ ] **Step 5: Commit**

```bash
git add web/components/chart.tsx web/lib/i18n/messages.ts web/components/chart-title-caption.test.tsx web/components/chart-commands-contract.test.tsx
git commit -m "feat(chart): in-place title and caption editing as undoable commands (co-pilot phase 1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Migration 034 + `chart_edits` store + retention legs (root workspace)

**Files:**
- Create: `migrations/034_chart_edits.sql`, `src/chart/edits-store.ts`
- Modify: `src/answer/audit/retention.ts` (~lines 226–275, 337–372, 389–430, 451–495)
- Test: `tests/chart/edits-store.test.ts`, `tests/audit/retention.test.ts` (extend)

**Interfaces:**
- Produces:

```ts
export const CHART_EDITS_MAX_JSON = 65_536;
export interface UpsertChartEditsInput { auditAnswerId: number; userId: string; log: unknown[] }
export async function upsertChartEdits(db: Db, input: UpsertChartEditsInput): Promise<boolean>; // false = guard did not match / table absent / too large
export async function getOwnChartEdits(db: Db, auditAnswerId: number, userId: string): Promise<unknown[] | null>;
```

- [ ] **Step 1: Write the migration**

`migrations/034_chart_edits.sql` (first check `ls migrations | tail -1` is `033_…` and run `npm run migrations:check-numbers` after adding):

```sql
-- 034 — chart_edits (session 112, chart co-pilot phase 1, ADR 056 decision 4,
-- owner decision docs/open-questions.md #274): one row per (audit answer,
-- user) holding that reader's serialised command log for the chart — form,
-- zoom, hidden/highlighted series, style, template, notes, title, caption.
-- A command never carries a data value (only keys, codes, enum values and
-- text the reader typed); the answer's numbers are untouched (R1/R6).
--
-- ⚠ FILE-ONLY until the owner-supervised apply (migrations 016/017/019/026/
-- 028/030/031 precedent). Deploy-order-safe: every reader/writer in
-- src/chart/edits-store.ts treats an absent table as "no edits yet" /
-- "cannot save right now", never throws.
--
-- PERSONAL DATA from this commit on (mirrors 031): it joins the retention
-- job in the SAME change (retention.ts hard-delete legs). No GRANT/RLS here:
-- migration 003's rls_auto_enable locks every later table automatically.
--
-- Plain Postgres only — identical on Supabase and PGlite (ADR 009).

create table chart_edits (
  audit_answer_id bigint not null references audit_answers(id),
  user_id text not null,
  log jsonb not null,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (audit_answer_id, user_id)
);
```

- [ ] **Step 2: Write the failing store test** (`tests/chart/edits-store.test.ts`, copy `withDb`/`insertAuditRow` from `tests/chart/headline-store.test.ts`)

```ts
describe('chart_edits store', () => {
  it('upserts only into the caller\'s own chart-bearing user answer row, and reads it back', async () => {
    await withDb(async (db) => {
      const mine = await insertAuditRow(db, { userId: 'u1' });
      const theirs = await insertAuditRow(db, { userId: 'u2' });
      const noChart = await insertAuditRow(db, { userId: 'u1', chartEmitted: false });
      const log = [{ kind: 'setForm', form: 'bar', id: 'a', at: '2026-09-18T00:00:00.000Z', source: 'panel' }];
      expect(await upsertChartEdits(db, { auditAnswerId: mine, userId: 'u1', log })).toBe(true);
      expect(await upsertChartEdits(db, { auditAnswerId: theirs, userId: 'u1', log })).toBe(false);
      expect(await upsertChartEdits(db, { auditAnswerId: noChart, userId: 'u1', log })).toBe(false);
      expect(await getOwnChartEdits(db, mine, 'u1')).toEqual(log);
      expect(await getOwnChartEdits(db, mine, 'u2')).toBeNull();
      // Second save replaces, bumps updated_at.
      expect(await upsertChartEdits(db, { auditAnswerId: mine, userId: 'u1', log: [] })).toBe(true);
      expect(await getOwnChartEdits(db, mine, 'u1')).toEqual([]);
    });
  });
  it('refuses a log above CHART_EDITS_MAX_JSON', async () => {
    await withDb(async (db) => {
      const mine = await insertAuditRow(db, { userId: 'u1' });
      const big = [{ kind: 'setTitle', title: 'x'.repeat(CHART_EDITS_MAX_JSON), id: 'a', at: 'now', source: 'canvas' }];
      expect(await upsertChartEdits(db, { auditAnswerId: mine, userId: 'u1', log: big })).toBe(false);
    });
  });
  it('degrades to false/null when the table is absent (pre-migration deploy window)', async () => {
    await withDb(async (db) => {
      const mine = await insertAuditRow(db, { userId: 'u1' });
      await db.query('drop table chart_edits');
      expect(await upsertChartEdits(db, { auditAnswerId: mine, userId: 'u1', log: [] })).toBe(false);
      expect(await getOwnChartEdits(db, mine, 'u1')).toBeNull();
    });
  });
});
```

- [ ] **Step 3: Write the store** (`src/chart/edits-store.ts`, mirror `headline-store.ts`)

```ts
import type { Db } from '../db/types.ts';

export const CHART_EDITS_MAX_JSON = 65_536;

async function tableExists(db: Db): Promise<boolean> {
  const { rows } = await db.query(`select to_regclass('public.chart_edits') as t`);
  return rows[0]?.t != null;
}

export interface UpsertChartEditsInput { auditAnswerId: number; userId: string; log: unknown[] }

export async function upsertChartEdits(db: Db, input: UpsertChartEditsInput): Promise<boolean> {
  const json = JSON.stringify(input.log);
  if (json.length > CHART_EDITS_MAX_JSON) return false;
  if (!(await tableExists(db))) return false;
  const { rows } = await db.query(
    `insert into chart_edits (audit_answer_id, user_id, log)
     select a.id, $3::text, $2::jsonb
       from audit_answers a
      where a.id = $1 and a.user_id = $3 and a.kind = 'answer' and a.source_tag = 'user' and a.chart_emitted
     on conflict (audit_answer_id, user_id) do update
       set log = excluded.log, updated_at = now()
     returning audit_answer_id`,
    [input.auditAnswerId, json, input.userId],
  );
  return rows.length > 0;
}

export async function getOwnChartEdits(db: Db, auditAnswerId: number, userId: string): Promise<unknown[] | null> {
  if (!(await tableExists(db))) return null;
  const { rows } = await db.query(`select log from chart_edits where audit_answer_id = $1 and user_id = $2`, [auditAnswerId, userId]);
  if (rows.length === 0) return null;
  const log = rows[0]!.log;
  return Array.isArray(log) ? log : null;
}
```

- [ ] **Step 4: Retention legs.** In `retention.ts` rename the type `HeadlineDelete` → `HardDelete` with a `table: string` field, change the parameter `headlineDelete?: HeadlineDelete` → `hardDeletes: HardDelete[] = []`, and loop:

```ts
for (const del of hardDeletes) {
  const { rows: reg } = await tx.query(`select to_regclass($1) as t`, [`public.${del.table}`]);
  if (reg[0]?.t != null) await tx.query(del.sql, del.params);
}
```

Then in each of the three callers pass an array with the existing `chart_headlines` leg PLUS:

```ts
{ table: 'chart_edits', sql: `delete from chart_edits where audit_answer_id in (select id from audit_answers where user_id = $1)`, params: [userId] }
```
(user leg), the thread leg with the same subselect the headline thread leg uses, and the purge leg with `${AUDIT_PURGE_WHERE}` and `[cutoffIso, anonIso]`. Keep every comment that explains the headline leg; add one line for chart_edits.

Extend `tests/audit/retention.test.ts` with:

```ts
it('deleting a user\'s history hard-deletes their chart_edits rows too (migration 034)', async () => {
  await withDb(async (db) => {
    const id = await insertAuditRow(db, { userId: 'u1' }); // reuse the file's own audit-row helper
    await db.query(`insert into chart_edits (audit_answer_id, user_id, log) values ($1, 'u1', '[]'::jsonb)`, [id]);
    await deleteUserQuestionHistory(db, 'u1');
    const { rows } = await db.query(`select count(*)::int as n from chart_edits`);
    expect(rows[0]!.n).toBe(0);
  });
});
it('the expiry purge takes chart_edits with the purged answers', async () => { /* same shape, using purgeExpiredQuestionHistory with a cutoff in the future */ });
```
(Copy the exact helper names and the purge call convention from the tests already in that file.)

- [ ] **Step 5: Run** `npm run migrations:check-numbers && npx vitest run tests/chart/edits-store.test.ts tests/audit/retention.test.ts tests/chart/headline-store.test.ts tests/db && npm run typecheck` → green.

- [ ] **Step 6: Commit**

```bash
git add migrations/034_chart_edits.sql src/chart/edits-store.ts src/answer/audit/retention.ts tests/chart/edits-store.test.ts tests/audit/retention.test.ts
git commit -m "feat(chart): chart_edits table (migration 034, file-only) + store + GDPR retention legs (co-pilot phase 1, #274)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Server actions, hydrate + save in the card, Playwright proof

**Files:**
- Create: `web/app/chart-edits-actions.ts`, `web/e2e/chart-copilot.spec.ts`
- Modify: `web/components/chart.tsx`
- Test: `web/components/chart-edits-persistence.test.tsx`; update the `vi.mock` blocks in `chart-headline-ui.test.tsx`, `chart-history-ui.test.tsx`, `chart-title-caption.test.tsx`, `chart-commands-contract.test.tsx`, `chart.test.tsx` and any other test that renders `ChartView` to also mock `../app/chart-edits-actions.ts` (`fetchChartEdits` resolving `{ ok: true, log: null }`, `saveChartEdits` resolving `{ ok: true }`).

**Interfaces:**

```ts
// web/app/chart-edits-actions.ts ('use server')
export type FetchChartEditsResponse = { ok: true; log: unknown[] | null } | { ok: false };
export async function fetchChartEdits(rawAuditId: unknown): Promise<FetchChartEditsResponse>;
export async function saveChartEdits(rawAuditId: unknown, rawLog: unknown): Promise<{ ok: boolean }>;
```

Server action rules (mirror `chart-headline-actions.ts`): `currentUserId()` null → `{ ok: false }`; audit id must be a positive safe integer; `saveChartEdits` runs `parseCommandLog(rawLog)` (Task 1) and refuses `null`; stores the PARSED log (never the raw input); `reportError` on throw.

Client (chart.tsx):
- `const editsKey = !embedMode && !inStage && signedIn && embed?.auditId !== undefined ? embed.auditId : null;`
- Hydrate: `useEffect` on `[editsKey]` — if `editsKey === null` return; `fetchChartEdits(editsKey)` → if `ok && log` → `parsed = parseCommandLog(log)`; if parsed and `history.past.length === 0` (reader has not started editing) → `const r = replayLog(initialDocState(initialForm, initialPresentation), parsed, { spec, alternatesCount: alternates.length }); replaceHistory({ state: r.state, history: r.history }); lastSavedRef.current = JSON.stringify(serializeHistory(r.history));`. Guard with a `cancelled` flag like the headline fetch.
- Save: `useEffect` on `[history, editsKey]` — if `editsKey === null` return; `const json = JSON.stringify(serializeHistory(history)); if (json === lastSavedRef.current) return;` debounce 800 ms with `setTimeout`, then `saveChartEdits(editsKey, JSON.parse(json))` and on `ok` set `lastSavedRef.current = json`. Clear the timer in the effect cleanup. A transient (unsealed) top entry is not in `serializeHistory`, so mid-drag saves never fire.
- `lastSavedRef` starts at `'[]'` so an untouched chart never saves an empty log.

- [ ] **Step 1: Write the failing component test** (`web/components/chart-edits-persistence.test.tsx`, with the full mock block; `signedIn` comes from `ChartStyleProvider` — check its props in `web/lib/chart-style-context.tsx`)

```tsx
describe('chart_edits persistence', () => {
  it('a saved log is replayed on mount and stays undoable', async () => {
    chartEditsActions.fetchChartEdits.mockResolvedValueOnce({ ok: true, log: [{ kind: 'setForm', form: 'bar', id: 'a', at: '2026-09-18T00:00:00.000Z', source: 'panel' }] });
    render(<Provider signedIn><ChartView spec={twoSeriesLineSpec()} embed={{ auditId: 5 }} /></Provider>);
    await waitFor(() => expect(screen.getByRole('tab', { name: /Staaf|Bar/ })).toHaveAttribute('aria-selected', 'true'));
    fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
    expect(screen.getByRole('tab', { name: /Lijn|Line/ })).toHaveAttribute('aria-selected', 'true');
  });
  it('an invalid stored command is dropped, the rest applied', async () => {
    chartEditsActions.fetchChartEdits.mockResolvedValueOnce({ ok: true, log: [
      { kind: 'toggleSeries', key: 's9', id: 'x', at: 'now', source: 'panel' },
      { kind: 'setTitle', title: 'Hersteld', id: 'y', at: 'now', source: 'canvas' },
    ] });
    render(<Provider signedIn><ChartView spec={twoSeriesLineSpec()} embed={{ auditId: 5 }} /></Provider>);
    await waitFor(() => expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Hersteld'));
  });
  it('an edit is saved once, debounced, with the serialised log; undo saves the shorter log', async () => {
    vi.useFakeTimers();
    render(<Provider signedIn><ChartView spec={twoSeriesLineSpec()} embed={{ auditId: 5 }} /></Provider>);
    fireEvent.click(screen.getByRole('tab', { name: /Staaf|Bar/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Lijn|Line/ }));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(chartEditsActions.saveChartEdits).toHaveBeenCalledTimes(1);
    const [id, log] = chartEditsActions.saveChartEdits.mock.calls[0]!;
    expect(id).toBe(5);
    expect((log as unknown[]).map((c: any) => c.kind)).toEqual(['setForm', 'setForm']);
    fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(chartEditsActions.saveChartEdits).toHaveBeenCalledTimes(2);
    expect((chartEditsActions.saveChartEdits.mock.calls[1]![1] as unknown[]).length).toBe(1);
    vi.useRealTimers();
  });
  it('never fetches or saves when signed out, in embed mode, or without an audit id', async () => {
    render(<Provider signedIn={false}><ChartView spec={twoSeriesLineSpec()} embed={{ auditId: 5 }} /></Provider>);
    render(<ChartView spec={twoSeriesLineSpec()} />);
    fireEvent.click(screen.getAllByRole('tab', { name: /Staaf|Bar/ })[0]!);
    await act(() => new Promise((r) => setTimeout(r, 900)));
    expect(chartEditsActions.fetchChartEdits).not.toHaveBeenCalled();
    expect(chartEditsActions.saveChartEdits).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure.** `cd web && npx vitest run components/chart-edits-persistence.test.tsx`

- [ ] **Step 3: Implement** the actions file and the two effects; update the other tests' mock blocks.

- [ ] **Step 4: Playwright** — `web/e2e/chart-copilot.spec.ts` (copy the imports, `ask`, `signInAsHarnessUser` usage and the `REGION_SERIES_INTENT` question from `answer.spec.ts`; read that file's header comment on how a hand-authored intent is asked in the harness):

```ts
test.describe.serial('chart co-pilot phase 1', () => {
  test.beforeEach(async ({ context, baseURL }) => { await signInAsHarnessUser(context, baseURL!); });

  test('hide a series → ⌘Z brings it back → the edit survives a reload', async ({ page }) => {
    await page.goto('/');
    await ask(page, REGION_SERIES_QUESTION); // the (f) question: two regions, two lines
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });
    // Hide Rotterdam via the legend (take the exact accessible name from chart.tsx's SeriesLegend t() keys).
    await page.getByRole('button', { name: /Rotterdam/ }).first().click();
    await expect(page.locator('.recharts-line-curve')).toHaveCount(1);
    await page.getByRole('button', { name: 'Ongedaan maken' }).click();
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2);
    await page.getByRole('button', { name: 'Opnieuw' }).click();
    await expect(page.locator('.recharts-line-curve')).toHaveCount(1);
    // Keyboard: focus the card (click its heading) and press ⌘Z / Ctrl+Z.
    await page.getByRole('heading', { level: 3 }).first().click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2);
    await page.keyboard.press(process.platform === 'darwin' ? 'Shift+Meta+z' : 'Control+y');
    await expect(page.locator('.recharts-line-curve')).toHaveCount(1);
    // Persistence: wait past the debounce, reload the thread (see answer.spec.ts (c) for how a thread is reopened), the series is still hidden.
    await page.waitForTimeout(1500);
    await page.reload();
    await expect(page.locator('.recharts-line-curve')).toHaveCount(1, { timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Ongedaan maken' })).toBeEnabled();
  });
});
```

Verify first that the harness database has the `chart_edits` table: `scripts/dev-harness/pglite-preload.mjs` builds it via `tests/helpers/pglite-db.ts` → `applyMigrations` (all files in `migrations/`), so 034 is applied there automatically — confirm by grepping `applyMigrations` in that helper. Run: `cd web && npx playwright test e2e/chart-copilot.spec.ts` (first run may need `npx playwright install chromium`). If the harness cannot start on this machine, say so in the report — do not mark the e2e as passing.

- [ ] **Step 5: Run everything** — `cd web && npm run typecheck && npx vitest run` and root `npm run typecheck` → green.

- [ ] **Step 6: Commit**

```bash
git add web/app/chart-edits-actions.ts web/components/chart.tsx web/components/*.test.tsx web/e2e/chart-copilot.spec.ts
git commit -m "feat(chart): save the command log per account and restore it on reopen; Playwright undo + reload proof (co-pilot phase 1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Docs (the session does this itself, after the review gates)

- [ ] `docs/RUNBOOK.md`: a "Supervised live step — migration 034 chart_edits (FILE-ONLY, not yet run)" section in the style of the 031 section (~line 467): `npm run db:migrate` from the repo root, expect exactly `034_chart_edits.sql`, additive only; before the apply the app silently does not save edits (guard), after it saving starts with no deploy needed.
- [ ] `docs/decisions/056-chart-copilot.md`: an "As built — phase 1 (session 112)" note: the file list above, the `setSeriesView` inverse-only kind, the transient/seal contract, what bypasses history, the journalist headline left out of the history (assumption), title/caption never in exports, the public embed page not yet reading the log.
- [ ] `docs/decisions/038-chart-view-state-editing.md`: addendum — the reducer now sits under the command log; decision F (notes session-only) superseded by #274.
- [ ] `docs/open-questions.md`: #274 → built (file-only migration pending the owner); #212 addendum "phase 1 built"; new rows: (a) headline not on the history / public embed does not read the log yet (phase 3), (b) exports do not include title/caption (like notes), (c) hand-rolled seeded generator instead of fast-check (no new dependency, cheapest-mechanism rule).
- [ ] `docs/08-build-plan.md`: phase 1 marked built with the measured test counts; phase 2 next.
- [ ] `docs/04-architecture.md`: capability row for the command log.
- [ ] `docs/03-mvp-scope.md`: only if its co-pilot row wording says "not built".
- [ ] `docs/STATUS.md` + `docs/status-archive.md`, `docs/lessons-learned.md`, session-113 kickoff, memory — at wrap-up per CLAUDE.md.

---

## Self-review (done while writing)

- **Spec coverage:** §3.1 commands (Task 1), history + ⌘Z + popover (Tasks 2–4), doorway A rewrite (Task 3), title/caption (Task 5), persistence + retention (Tasks 6–7), §6 property test (Task 1), contract test (Task 3/5), Playwright click → ⌘Z → revert + reload (Task 7), "embed still serialises the same state" (Task 3 test). §3.1's `setNote` is `addNote`; `setHeadline` deliberately deferred (Global Constraints). Chart-fit scorer, chat route, capabilities payload: phases 2–5, not here.
- **Type consistency:** `dispatchCommand(params, source, opts)` everywhere; `replaceHistory({ state, history })`; `serializeHistory(history)`; `replayLog(initial, log, ctx)`; `setSeriesView` present in the union, the kinds list, apply, invert, validate, zod, the test generator and the contract test.
- **Placeholders:** none; where a label must be copied from an existing test, the plan names that test.
