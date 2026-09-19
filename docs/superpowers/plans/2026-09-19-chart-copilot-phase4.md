# Chart co-pilot phase 4 — storytelling primitives — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add six chart-editing primitives (goal line, era shading, dim-not-hide, a reader-chosen
headline number, a difference arrow, an average line), each reachable from the panel first and the
chat co-pilot second, without weakening any data-provenance invariant.

**Architecture:** Every primitive is either (a) the reader's own typed text, rendered in the existing
notes-style layer that sits outside the chart's own drawn image (so it can never be mistaken for a
plotted number and needs no invariant exemption), or (b) a real number, which is either already bound
to a spec point (headline number — a pure *selection*, no computation) or freshly computed by a
**server-side re-run of a registered derivation function over this chart's own already-audited cells**
(difference/average — Option A, owner-approved 2026-09-19). No primitive's *command* ever carries a
freshly-computed number — only the "recipe" (which points, which calculation) — so undo/redo/reload
always replay the recipe, never trust a smuggled-in figure.

**Tech Stack:** Next.js 16 / React / TypeScript / Zod / Vitest / Playwright (this repo's existing stack
— see `web/CLAUDE.md`).

**Spec:** [docs/superpowers/specs/2026-09-17-chart-copilot-design.md](../../superpowers/specs/2026-09-17-chart-copilot-design.md)
§9 (commit `ffa316a4`). Executors read the spec section too, not just this plan.

## Global Constraints

- A command never carries a freshly-computed numeric value (spec §9, "Command log rule kept intact").
  Reader-typed values (goal line, era-shading label) are fine as command payloads — they are the
  reader's own words, not a data claim.
- Every new `ChartCommand` kind is **additive only** — never change the shape of an existing kind.
  `chart_edits` rows are live in production (own-data tier) and replayed via `parseCommandLog`; an
  existing member's schema is a persisted contract.
- A reader-typed value (goal line, era-shading label) must render **outside** `chartContainerRef`
  (`web/components/chart.tsx`), exactly like `ChartNotes` — never inside the exported image, never
  scanned as chart data.
- A calculated value (headline override, difference, average) must always be bound to a real
  `resultId` (or a `DerivationRecord`'s own source ids) the same way every other plotted number is —
  never invented, never estimated in the browser.
- Chat vocabulary can never exceed panel vocabulary: every new capability needs a panel control with
  `data-command-kind`, pinned by `web/components/chart-commands-contract.test.tsx`.
- No new CBS/Eurostat fetch and no new `audit_answers` row for any of the six primitives — same rule
  every other chat/panel edit already follows.
- Plain Dutch/English UI copy per this repo's i18n convention (`web/lib/i18n/messages.ts` — every
  string needs an `nl` and an `en` entry).

---

## File Structure

New files://
- `src/chart/spec-cells.ts` — pure helper: flattens a `ChartSpec` into minimal, derivation-ready cell
  records keyed by `resultId`.
- `web/components/chart-goal-line.tsx` — goal-line overlay UI (mirrors `chart-notes.tsx`).
- `web/components/chart-era-shading.tsx` — era-shading overlay UI (mirrors `chart-notes.tsx`).
- `web/app/chart-derivation-actions.ts` — server action: re-run a registered derivation over an
  already-audited chart's cells (mirrors `web/app/chart-edits-actions.ts`).
- `web/lib/chart-derived-overlay.ts` — pure client-side types/helpers for pending/resolved derived
  overlays (the difference arrow / average line's non-command-log state).

Modified files (touched by more than one task — see **Dispatch order** below):
- `src/query/derivations.ts` — add `deriveMean`.
- `src/query/types.ts` — add the `'mean'` `DerivationRecord` member.
- `web/lib/chart-commands.ts` — add all six new `ChartCommand` kinds in one pass (Task 1 only).
- `web/lib/chart-view-state.ts` — add `dimmedKeys` to `ChartViewState`.
- `web/components/chart.tsx` — mount each new overlay/control (Tasks 2, 3, 4, 5, 7).
- `web/lib/i18n/messages.ts` — new UI strings (each task adds its own keys).
- `web/components/chart-commands-contract.test.tsx` — extended once, last (Task 8).

## Dispatch order

Task 1 (command log) and Task 6 (`deriveMean` + server action) touch no file the other touches — run
them **in parallel**. Every other task depends on Task 1's new command kinds and touches
`chart.tsx`, so Tasks 2, 3, 4, 5 and 7 must **start from a checkout that already has Task 1 merged**;
build them in parallel worktrees, then **merge one at a time**, resolving the small, expected
`chart.tsx` diff overlaps by hand (precedent: session 110's 20-branch batch, session 114's fix round —
this is normal, not a sign anything is wrong). Task 8 runs last, after every UI task has landed.

```
Wave 1 (parallel):      Task 1, Task 6
Wave 2 (parallel build,  Task 2, Task 3, Task 4, Task 5, Task 7
         sequential merge)
Wave 3:                  Task 8
```

---

### Task 1: Command log — six new command kinds

**Files:**
- Modify: `web/lib/chart-commands.ts`
- Modify: `web/lib/chart-view-state.ts`
- Test: `web/lib/chart-commands.test.ts` (existing file — extend it)

**Interfaces:**
- Produces (used by every later task):
  - `ChartCommandParams` gains:
    ```ts
    | { kind: 'addGoalLine'; goalLine: GoalLine }
    | { kind: 'removeGoalLine'; id: string }
    | { kind: 'addEraShading'; era: EraShading }
    | { kind: 'removeEraShading'; id: string }
    | { kind: 'setDimmed'; hiddenKeys: string[]; dimmedKeys: string[] }
    | { kind: 'setHeadlineOverride'; resultId: string | null }
    | { kind: 'addDerivedOverlay'; overlay: DerivedOverlayRequest }
    | { kind: 'removeDerivedOverlay'; id: string }
    ```
  - `GoalLine = { id: string; value: number; label: string }` (new export, `chart-commands.ts`)
  - `EraShading = { id: string; fromPeriodCode: string; toPeriodCode: string; label: string }`
  - `DerivedOverlayRequest = { id: string; calcKind: 'difference' | 'mean'; resultIds: string[] }`
  - `ChartDocState` gains: `goalLines: GoalLine[]`, `eraShadings: EraShading[]`,
    `derivedOverlayRequests: DerivedOverlayRequest[]`.
  - `ChartViewState` gains: `dimmedKeys: Set<string>`.
  - `CHART_GOAL_LINE_LABEL_MAX_LENGTH = 60`, `CHART_ERA_SHADING_LABEL_MAX_LENGTH = 60` (new exported
    constants, same convention as `CHART_NOTE_MAX_LENGTH`).

- [ ] **Step 1: Write the failing tests for `dimmedKeys` in the view-state reducer**

```ts
// web/lib/chart-view-state.test.ts (existing file — add these cases)
import { chartViewReducer, initialViewState } from './chart-view-state.ts';

it('setDimmed replaces hiddenKeys and dimmedKeys together', () => {
  const state = { ...initialViewState('line'), hiddenKeys: new Set(['s0']) };
  const next = chartViewReducer(state, { type: 'setDimmed', hiddenKeys: [], dimmedKeys: ['s1'] });
  expect(next.hiddenKeys).toEqual(new Set());
  expect(next.dimmedKeys).toEqual(new Set(['s1']));
});

it('toggleDim on a shown series marks it dimmed and clears any hide', () => {
  const state = { ...initialViewState('line'), hiddenKeys: new Set(['s0']) };
  const next = chartViewReducer(state, { type: 'toggleDim', key: 's0' });
  expect(next.hiddenKeys.has('s0')).toBe(false);
  expect(next.dimmedKeys.has('s0')).toBe(true);
});

it('toggleDim on an already-dimmed series un-dims it back to shown', () => {
  const state = { ...initialViewState('line'), dimmedKeys: new Set(['s0']) };
  const next = chartViewReducer(state, { type: 'toggleDim', key: 's0' });
  expect(next.dimmedKeys.has('s0')).toBe(false);
  expect(next.hiddenKeys.has('s0')).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run lib/chart-view-state.test.ts`
Expected: FAIL — `dimmedKeys`/`toggleDim`/`setDimmed` don't exist yet.

- [ ] **Step 3: Implement `dimmedKeys` in `chart-view-state.ts`**

Add to `ChartViewState`:
```ts
export interface ChartViewState {
  form: ChartForm;
  hiddenKeys: Set<string>;
  /** Shown but visually de-emphasised (opacity), distinct from hidden. A key
   * is never in both sets at once — every transition below enforces that. */
  dimmedKeys: Set<string>;
  highlightedKey: string | null;
  periodRange: [string, string] | null;
  presentation: PresentationOverrides;
  selectedReading: number | null;
}
```
Add to `ChartViewAction`:
```ts
  | { type: 'setDimmed'; hiddenKeys: string[]; dimmedKeys: string[] }
  | { type: 'toggleDim'; key: string }
```
Add to `initialViewState`'s return: `dimmedKeys: new Set(),`.
Add to `chartViewReducer`'s switch:
```ts
    case 'setDimmed':
      return { ...state, hiddenKeys: new Set(action.hiddenKeys), dimmedKeys: new Set(action.dimmedKeys) };
    case 'toggleDim': {
      const dimmed = new Set(state.dimmedKeys);
      const hidden = new Set(state.hiddenKeys);
      hidden.delete(action.key);
      if (dimmed.has(action.key)) dimmed.delete(action.key);
      else dimmed.add(action.key);
      return { ...state, hiddenKeys: hidden, dimmedKeys: dimmed };
    }
```
Also add the `setView` case's restored shape (extend its `Pick<...>` to include `dimmedKeys` so Story
mode restores dim state the same way it restores hidden/highlight/zoom — see existing `setView`
handler and its type).

- [ ] **Step 4: Run to verify pass**

Run: `cd web && npx vitest run lib/chart-view-state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/lib/chart-view-state.ts web/lib/chart-view-state.test.ts
git commit -m "feat(web): three-state series view (shown/dimmed/hidden) in chart view-state"
```

- [ ] **Step 6: Write the failing tests for the five new command kinds**

```ts
// web/lib/chart-commands.test.ts (existing file — add these cases)
import { applyCommand, invertCommand, validateCommand, initialDocState, type CommandContext } from './chart-commands.ts';

const ctx: CommandContext = { spec: { kind: 'line', series: [{ points: [{ resultId: 'r1', periodCode: '2020', value: 1 }, { resultId: 'r2', periodCode: '2021', value: 2 }] }] as any }, alternatesCount: 0 };

it('addGoalLine/removeGoalLine round-trip through apply+invert', () => {
  let state = initialDocState('line');
  const goalLine = { id: 'g1', value: 100, label: 'Doel' };
  state = applyCommand(state, { kind: 'addGoalLine', goalLine });
  expect(state.goalLines).toEqual([goalLine]);
  const inverse = invertCommand(state, { kind: 'addGoalLine', goalLine });
  state = applyCommand(state, inverse);
  expect(state.goalLines).toEqual([]);
});

it('validateCommand refuses an era shading whose range is not on the chart', () => {
  const era = { id: 'e1', fromPeriodCode: '1999', toPeriodCode: '2000', label: 'x' };
  expect(validateCommand({ kind: 'addEraShading', era }, ctx)).toBe(false);
});

it('validateCommand accepts an era shading whose range is on the chart', () => {
  const era = { id: 'e1', fromPeriodCode: '2020', toPeriodCode: '2021', label: 'x' };
  expect(validateCommand({ kind: 'addEraShading', era }, ctx)).toBe(true);
});

it('validateCommand refuses setHeadlineOverride pointing at an unknown resultId', () => {
  expect(validateCommand({ kind: 'setHeadlineOverride', resultId: 'nope' }, ctx)).toBe(false);
  expect(validateCommand({ kind: 'setHeadlineOverride', resultId: 'r1' }, ctx)).toBe(true);
  expect(validateCommand({ kind: 'setHeadlineOverride', resultId: null }, ctx)).toBe(true);
});

it('addDerivedOverlay/removeDerivedOverlay round-trip; validateCommand checks resultIds are on the chart', () => {
  const overlay = { id: 'd1', calcKind: 'difference' as const, resultIds: ['r1', 'r2'] };
  expect(validateCommand({ kind: 'addDerivedOverlay', overlay }, ctx)).toBe(true);
  expect(validateCommand({ kind: 'addDerivedOverlay', overlay: { ...overlay, resultIds: ['r1', 'nope'] } }, ctx)).toBe(false);
  let state = initialDocState('line');
  state = applyCommand(state, { kind: 'addDerivedOverlay', overlay });
  expect(state.derivedOverlayRequests).toEqual([overlay]);
});

it('parseCommandLog accepts a log containing every new kind', () => {
  const raw = [
    { kind: 'addGoalLine', goalLine: { id: 'g1', value: 1, label: 'x' }, id: 'c1', at: new Date().toISOString(), source: 'panel' },
    { kind: 'setDimmed', hiddenKeys: [], dimmedKeys: ['s0'], id: 'c2', at: new Date().toISOString(), source: 'panel' },
  ];
  expect(parseCommandLog(raw)).not.toBeNull();
});
```

- [ ] **Step 7: Run to verify failure**

Run: `cd web && npx vitest run lib/chart-commands.test.ts`
Expected: FAIL — new kinds/fields don't exist.

- [ ] **Step 8: Implement the five new kinds in `chart-commands.ts`**

Add near the top, after the existing type exports:
```ts
export interface GoalLine {
  id: string;
  value: number;
  label: string;
}
export interface EraShading {
  id: string;
  fromPeriodCode: string;
  toPeriodCode: string;
  label: string;
}
export interface DerivedOverlayRequest {
  id: string;
  calcKind: 'difference' | 'mean';
  resultIds: string[];
}
export const CHART_GOAL_LINE_LABEL_MAX_LENGTH = 60;
export const CHART_ERA_SHADING_LABEL_MAX_LENGTH = 60;
```

Extend `ChartCommandParams` with the eight new members listed in **Interfaces** above (append to the
existing union; do not touch any existing member). Extend `CHART_COMMAND_KINDS` with the eight new
kind strings.

Extend `ChartDocState`:
```ts
export interface ChartDocState extends ChartViewState {
  notes: ChartNote[];
  title: string | null;
  caption: string | null;
  instruction: ClientChartInstruction | null;
  goalLines: GoalLine[];
  eraShadings: EraShading[];
  derivedOverlayRequests: DerivedOverlayRequest[];
}
```
Update `initialDocState` to seed the three new arrays as `[]`.

Extend `applyCommand`'s switch (append cases, mirroring `addNote`/`removeNote`'s no-op-on-duplicate
and find-or-no-op-on-unknown-id idiom exactly):
```ts
    case 'addGoalLine': {
      if (state.goalLines.some((g) => g.id === cmd.goalLine.id)) return state;
      return { ...state, goalLines: [...state.goalLines, cmd.goalLine] };
    }
    case 'removeGoalLine':
      return { ...state, goalLines: state.goalLines.filter((g) => g.id !== cmd.id) };
    case 'addEraShading': {
      if (state.eraShadings.some((e) => e.id === cmd.era.id)) return state;
      return { ...state, eraShadings: [...state.eraShadings, cmd.era] };
    }
    case 'removeEraShading':
      return { ...state, eraShadings: state.eraShadings.filter((e) => e.id !== cmd.id) };
    case 'setDimmed':
      return withView(state, chartViewReducer(state, { type: 'setDimmed', hiddenKeys: cmd.hiddenKeys, dimmedKeys: cmd.dimmedKeys }));
    case 'setHeadlineOverride':
      return { ...state, headlineOverrideResultId: cmd.resultId };
    case 'addDerivedOverlay': {
      if (state.derivedOverlayRequests.some((o) => o.id === cmd.overlay.id)) return state;
      return { ...state, derivedOverlayRequests: [...state.derivedOverlayRequests, cmd.overlay] };
    }
    case 'removeDerivedOverlay':
      return { ...state, derivedOverlayRequests: state.derivedOverlayRequests.filter((o) => o.id !== cmd.id) };
```
(`setHeadlineOverride` needs `headlineOverrideResultId: string | null` added to `ChartDocState` too,
seeded `null` in `initialDocState` — add it alongside the three arrays above.)

Extend `invertCommand`'s switch, following the exact `addNote`/`removeNote` inversion idiom (duplicate
add → no-op inverse via `setTitle` to the unchanged title; unknown-id remove → no-op inverse of itself;
otherwise the natural opposite):
```ts
    case 'addGoalLine':
      if (before.goalLines.some((g) => g.id === cmd.goalLine.id)) return { kind: 'setTitle', title: before.title };
      return { kind: 'removeGoalLine', id: cmd.goalLine.id };
    case 'removeGoalLine': {
      const found = before.goalLines.find((g) => g.id === cmd.id);
      return found === undefined ? { kind: 'removeGoalLine', id: cmd.id } : { kind: 'addGoalLine', goalLine: found };
    }
    case 'addEraShading':
      if (before.eraShadings.some((e) => e.id === cmd.era.id)) return { kind: 'setTitle', title: before.title };
      return { kind: 'removeEraShading', id: cmd.era.id };
    case 'removeEraShading': {
      const found = before.eraShadings.find((e) => e.id === cmd.id);
      return found === undefined ? { kind: 'removeEraShading', id: cmd.id } : { kind: 'addEraShading', era: found };
    }
    case 'setDimmed':
      return { kind: 'setDimmed', hiddenKeys: [...before.hiddenKeys], dimmedKeys: [...before.dimmedKeys] };
    case 'setHeadlineOverride':
      return { kind: 'setHeadlineOverride', resultId: before.headlineOverrideResultId };
    case 'addDerivedOverlay':
      if (before.derivedOverlayRequests.some((o) => o.id === cmd.overlay.id)) return { kind: 'setTitle', title: before.title };
      return { kind: 'removeDerivedOverlay', id: cmd.overlay.id };
    case 'removeDerivedOverlay': {
      const found = before.derivedOverlayRequests.find((o) => o.id === cmd.id);
      return found === undefined ? { kind: 'removeDerivedOverlay', id: cmd.id } : { kind: 'addDerivedOverlay', overlay: found };
    }
```

Extend `validateCommand`'s switch:
```ts
    case 'addGoalLine':
      return Number.isFinite(cmd.goalLine.value) && cmd.goalLine.label.trim().length > 0 && cmd.goalLine.label.length <= CHART_GOAL_LINE_LABEL_MAX_LENGTH;
    case 'removeGoalLine':
      return typeof cmd.id === 'string' && cmd.id.length > 0;
    case 'addEraShading': {
      const codes = periodCodes(ctx.spec);
      return (
        codes.has(cmd.era.fromPeriodCode) &&
        codes.has(cmd.era.toPeriodCode) &&
        cmd.era.fromPeriodCode <= cmd.era.toPeriodCode &&
        cmd.era.label.trim().length > 0 &&
        cmd.era.label.length <= CHART_ERA_SHADING_LABEL_MAX_LENGTH
      );
    }
    case 'removeEraShading':
      return typeof cmd.id === 'string' && cmd.id.length > 0;
    case 'setDimmed':
      return (
        cmd.hiddenKeys.every((k) => keys.has(k)) &&
        cmd.dimmedKeys.every((k) => keys.has(k)) &&
        cmd.hiddenKeys.every((k) => !cmd.dimmedKeys.includes(k))
      );
    case 'setHeadlineOverride':
      return cmd.resultId === null || resultIds(ctx.spec).has(cmd.resultId);
    case 'addDerivedOverlay':
      return (
        (cmd.overlay.calcKind === 'difference' ? cmd.overlay.resultIds.length === 2 : cmd.overlay.resultIds.length >= 2) &&
        cmd.overlay.resultIds.every((id) => resultIds(ctx.spec).has(id))
      );
    case 'removeDerivedOverlay':
      return typeof cmd.id === 'string' && cmd.id.length > 0;
```

Extend the Zod `commandSchema` discriminated union with matching object schemas for all eight new
kinds (copy the `envelope`-spread convention exactly — see `addNote`'s entry for the shape to follow),
and add `headlineOverrideResultId: z.string().nullable()`-equivalent parsing is not needed (it is not
itself a command; only `setHeadlineOverride`'s `resultId` field needs `z.string().nullable()`).

- [ ] **Step 9: Run to verify pass**

Run: `cd web && npx vitest run lib/chart-commands.test.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add web/lib/chart-commands.ts web/lib/chart-commands.test.ts
git commit -m "feat(web): chart co-pilot phase 4 command kinds (goal line, era shading, dim, headline override, derived overlay)"
```

---

### Task 2: Goal line

**Depends on:** Task 1 (merged first).

**Files:**
- Create: `web/components/chart-goal-line.tsx`
- Create: `web/components/chart-goal-line.test.tsx`
- Modify: `web/components/chart.tsx` (mount the overlay outside `chartContainerRef`, near the existing
  `ChartNotes` mount at ~line 3605; add a panel control near the other `data-command-kind` controls,
  ~line 3940-4150 region)
- Modify: `web/lib/i18n/messages.ts` (new keys, e.g. `chartGoalLineAdd`, `chartGoalLineValueLabel`,
  `chartGoalLineTextLabel`, `chartGoalLineRemove`)

**Interfaces:**
- Consumes: `GoalLine`, `CHART_GOAL_LINE_LABEL_MAX_LENGTH` from `chart-commands.ts` (Task 1);
  `dispatchCommand` (existing prop/callback already used by every panel control in `chart.tsx`, same
  signature `toggleSeries`'s button already calls).
- Produces: `ChartGoalLine` React component, `{ goalLines: GoalLine[]; onAdd: (value: number, label:
  string) => void; onRemove: (id: string) => void; lang: Lang }`.

- [ ] **Step 1: Write the failing component test**

```tsx
// web/components/chart-goal-line.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChartGoalLine } from './chart-goal-line.tsx';

describe('ChartGoalLine', () => {
  it('submits a typed value and label via onAdd, never validates against data', () => {
    const onAdd = vi.fn();
    render(<ChartGoalLine goalLines={[]} onAdd={onAdd} onRemove={vi.fn()} lang="nl" idPrefix="t" />);
    fireEvent.click(screen.getByText('Doellijn toevoegen'));
    fireEvent.change(screen.getByLabelText('Waarde'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Doel 2026' } });
    fireEvent.click(screen.getByText('Opslaan'));
    expect(onAdd).toHaveBeenCalledWith(100, 'Doel 2026');
  });

  it('lists existing goal lines with a remove control', () => {
    const onRemove = vi.fn();
    render(<ChartGoalLine goalLines={[{ id: 'g1', value: 50, label: 'Doel' }]} onAdd={vi.fn()} onRemove={onRemove} lang="nl" idPrefix="t" />);
    fireEvent.click(screen.getByLabelText('Doel verwijderen'));
    expect(onRemove).toHaveBeenCalledWith('g1');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run components/chart-goal-line.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `chart-goal-line.tsx`**, structurally copying `chart-notes.tsx`'s file-level
comment and outside-`chartContainerRef` contract (a plain form: numeric input + text input + submit;
a list of existing goal lines each with a remove button carrying `aria-label` `"${label} verwijderen"`
so the test's `getByLabelText` finds it). Use `t(...)`/`Lang` from `web/lib/i18n/messages.ts` for every
string, adding the new keys there first (both `nl` and `en`).

- [ ] **Step 4: Run to verify pass**

Run: `cd web && npx vitest run components/chart-goal-line.test.tsx`
Expected: PASS

- [ ] **Step 5: Wire into `chart.tsx`**

Near the existing `ChartNotes` mount (~3605, outside `chartContainerRef`, same block comment
convention — "outside chartContainerRef, like the caption and the notes"), add:
```tsx
<ChartGoalLine
  goalLines={state.goalLines}
  lang={lang}
  idPrefix={domId}
  onAdd={(value, label) => dispatchCommand({ kind: 'addGoalLine', goalLine: { id: newCommandId(), value, label } }, 'panel')}
  onRemove={(id) => dispatchCommand({ kind: 'removeGoalLine', id }, 'panel')}
/>
```
Add a `data-command-kind="addGoalLine"` attribute on the form's submit button (the contract test scans
for this attribute on every reachable control — see Task 8).

- [ ] **Step 6: Add an e2e case** to the existing `web/e2e/chart-copilot.spec.ts`: open a chart, add a
goal line via the panel, assert the line and its label are visible, assert it is excluded from a PNG
export the same way an existing note already is (reuse that spec's existing export-exclusion assertion
pattern for notes).

- [ ] **Step 7: Run the full web test suite for this file's touches**

Run: `cd web && npx vitest run components/chart-goal-line.test.tsx components/chart.test.tsx`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add web/components/chart-goal-line.tsx web/components/chart-goal-line.test.tsx web/components/chart.tsx web/lib/i18n/messages.ts web/e2e/chart-copilot.spec.ts
git commit -m "feat(web): goal line — reader-typed target value, outside-image overlay"
```

---

### Task 3: Era shading

**Depends on:** Task 1 (merged first).

**Files:**
- Create: `web/components/chart-era-shading.tsx`
- Create: `web/components/chart-era-shading.test.tsx`
- Modify: `web/components/chart.tsx` (same two mount points as Task 2, different block)
- Modify: `web/lib/i18n/messages.ts`

**Interfaces:**
- Consumes: `EraShading`, `CHART_ERA_SHADING_LABEL_MAX_LENGTH` from `chart-commands.ts`;
  `periodCodes`-equivalent range already validated by `validateCommand` server/client-side — the UI
  itself only needs the chart's own period list to populate a from/to select, available from
  `spec.series[0].points.map(p => p.periodCode)` (same list the existing zoom control already builds —
  reuse its helper if one exists in `chart.tsx`, else inline the same one-liner).
- Produces: `ChartEraShading` component, `{ eraShadings: EraShading[]; periodOptions: {code: string;
  label: string}[]; onAdd: (fromPeriodCode: string, toPeriodCode: string, label: string) => void;
  onRemove: (id: string) => void; lang: Lang }`.

- [ ] **Step 1: Write the failing component test**

```tsx
// web/components/chart-era-shading.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChartEraShading } from './chart-era-shading.tsx';

const periodOptions = [{ code: '2019', label: '2019' }, { code: '2020', label: '2020' }, { code: '2021', label: '2021' }];

describe('ChartEraShading', () => {
  it('submits a from/to period pair and a typed label via onAdd', () => {
    const onAdd = vi.fn();
    render(<ChartEraShading eraShadings={[]} periodOptions={periodOptions} onAdd={onAdd} onRemove={vi.fn()} lang="nl" idPrefix="t" />);
    fireEvent.click(screen.getByText('Periode markeren'));
    fireEvent.change(screen.getByLabelText('Van'), { target: { value: '2020' } });
    fireEvent.change(screen.getByLabelText('Tot'), { target: { value: '2021' } });
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Crisis' } });
    fireEvent.click(screen.getByText('Opslaan'));
    expect(onAdd).toHaveBeenCalledWith('2020', '2021', 'Crisis');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run components/chart-era-shading.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `chart-era-shading.tsx`** — same shape as Task 2's component: a form with two
`<select>`s populated from `periodOptions` plus a label input, and a list of existing shadings each with
a remove button. Reader's label goes through the same "never validated against data" path as notes.

- [ ] **Step 4: Run to verify pass**

Run: `cd web && npx vitest run components/chart-era-shading.test.tsx`
Expected: PASS

- [ ] **Step 5: Wire into `chart.tsx`** — mount outside `chartContainerRef` (the shaded band itself
also renders there, as a plain positioned `<div>` computed from the x-scale the chart already exposes
for the zoom/period controls — never inside the exported `<svg>`); add a `data-command-kind=
"addEraShading"` control.

- [ ] **Step 6: Add an e2e case** to `web/e2e/chart-copilot.spec.ts`: shade a range, assert the band and
label render, assert export exclusion (same pattern as Task 2's).

- [ ] **Step 7: Run tests**

Run: `cd web && npx vitest run components/chart-era-shading.test.tsx components/chart.test.tsx`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add web/components/chart-era-shading.tsx web/components/chart-era-shading.test.tsx web/components/chart.tsx web/lib/i18n/messages.ts web/e2e/chart-copilot.spec.ts
git commit -m "feat(web): era shading — reader-marked period range with a typed label"
```

---

### Task 4: Dim instead of hide

**Depends on:** Task 1 (merged first).

**Files:**
- Modify: `web/components/chart.tsx` (the existing legend/series-toggle control that currently only
  supports show/hide — find it via `data-command-kind="toggleSeries"` if that attribute exists, else
  via the `toggleSeries`/`dispatchCommand` call site the legend already uses)
- Modify: `web/lib/i18n/messages.ts`

**Interfaces:**
- Consumes: `dimmedKeys` (Task 1's `ChartViewState` addition), `toggleDim` view action (Task 1).
- No new files — this is the smallest task, purely a UI state extension on an existing control.

- [ ] **Step 1: Find the existing legend control.** Run: `grep -n "toggleSeries" web/components/chart.tsx`
and read the surrounding ~20 lines to find the click handler and the series-row markup.

- [ ] **Step 2: Write the failing test** in `web/components/chart.test.tsx` (existing file):

```tsx
it('a third legend interaction dims a series instead of hiding it', () => {
  // render the chart with a 2-series spec, as the existing toggleSeries
  // tests in this file already do
  const { getByLabelText } = renderChart(twoSeriesSpec);
  const dimButton = getByLabelText('Sectie A dimmen');
  fireEvent.click(dimButton);
  expect(getByLabelText('Sectie A dimmen')).toHaveAttribute('aria-pressed', 'true');
  // the series itself is still drawn, at reduced opacity, not removed
  expect(document.querySelector('[data-series-key="s0"]')).toHaveStyle({ opacity: '0.35' });
});
```

(Match the exact `renderChart`/fixture helpers `chart.test.tsx` already uses elsewhere in the file —
do not invent a new render helper.)

- [ ] **Step 3: Run to verify failure**

Run: `cd web && npx vitest run components/chart.test.tsx -t "dims a series"`
Expected: FAIL

- [ ] **Step 4: Implement.** Add a second button/icon next to the existing hide toggle in the legend
row, `aria-label={`${seriesLabel} dimmen`}`, `aria-pressed={dimmedKeys.has(key)}`,
`data-command-kind="setDimmed"`, calling:
```ts
dispatchCommand({
  kind: 'setDimmed',
  hiddenKeys: [...state.hiddenKeys],
  dimmedKeys: state.dimmedKeys.has(key)
    ? [...state.dimmedKeys].filter((k) => k !== key)
    : [...state.dimmedKeys, key],
}, 'panel');
```
Where the renderer applies series opacity today (search for the existing `hiddenKeys.has` opacity/
display check near the series-drawing code), add: dimmed series get `opacity: 0.35` (pick this repo's
existing "dimmed" convention if one is already used elsewhere — e.g. the highlight feature's own
non-highlighted-series opacity, `chartViewReducer`'s highlight comment mentions "0.25 opacity" for a
DIFFERENT dim case; reuse whatever numeric convention that highlight feature already established rather
than inventing a second one, unless the two dimmings need to look different, in which case pick a
value visually distinct from 0.25 and say so in a one-line comment).

- [ ] **Step 5: Run to verify pass**

Run: `cd web && npx vitest run components/chart.test.tsx -t "dims a series"`
Expected: PASS

- [ ] **Step 6: Add an e2e case** to `web/e2e/chart-copilot.spec.ts`: dim a series via the panel, assert
it's still visible (not `display:none`) at reduced opacity, undo, assert it's fully restored.

- [ ] **Step 7: Commit**

```bash
git add web/components/chart.tsx web/components/chart.test.tsx web/lib/i18n/messages.ts web/e2e/chart-copilot.spec.ts
git commit -m "feat(web): dim-not-hide — a third shown/dimmed/hidden state for chart series"
```

---

### Task 5: Reader-chosen headline number

**Depends on:** Task 1 (merged first).

**Scope note (found during planning):** `web/lib/chart-headline.ts`'s `headlineFigure()` already
selects and renders "the one large number the chart card leads with" — but only ever automatically
(the last plotted point of a single-series line chart). This task does not rebuild that; it lets the
reader **override which point** is featured, reusing the existing rendering.

**Files:**
- Modify: `web/lib/chart-headline.ts` (widen `headlineFigure` to accept an override)
- Modify: `web/lib/chart-headline.test.ts` (existing file)
- Modify: `web/components/chart.tsx` (call site + a new panel control: a click-to-select on any point,
  mirroring the existing click-to-annotate `pendingPoint` flow `ChartNotes` already uses)
- Modify: `web/lib/i18n/messages.ts`

**Interfaces:**
- Consumes: `setHeadlineOverride` command (Task 1), `state.headlineOverrideResultId`.
- Produces: `headlineFigure(spec, overrideResultId?: string | null): HeadlineFigure | null` — when
  `overrideResultId` names a real point in `spec` (any series, not only a single-series line chart —
  widen the eligibility check to "the point exists", keeping the existing single-series default path
  untouched when no override is given), return that point's figure instead of the last-point default.

- [ ] **Step 1: Write the failing test**

```ts
// web/lib/chart-headline.test.ts (existing file — add these cases)
it('an override resultId selects that point instead of the last one', () => {
  const spec = /* existing multi-point fixture already in this file */;
  const figure = headlineFigure(spec, spec.series[0].points[0].resultId);
  expect(figure?.resultId).toBe(spec.series[0].points[0].resultId);
});

it('an override resultId not present in the spec falls back to null, never guesses', () => {
  const spec = /* existing fixture */;
  expect(headlineFigure(spec, 'not-a-real-id')).toBeNull();
});

it('no override keeps the existing last-point default behaviour', () => {
  const spec = /* existing fixture */;
  expect(headlineFigure(spec)).toEqual(headlineFigure(spec, undefined));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run lib/chart-headline.test.ts`
Expected: FAIL — `headlineFigure` doesn't accept a second argument yet (existing calls still pass,
since it's optional — no existing test breaks).

- [ ] **Step 3: Implement.** In `chart-headline.ts`:
```ts
export function headlineFigure(
  spec: Pick<ChartSpec, 'kind' | 'series' | 'unit'>,
  overrideResultId?: string | null,
): HeadlineFigure | null {
  if (overrideResultId) {
    for (const s of spec.series) {
      const point = s.points.find((p) => p.resultId === overrideResultId);
      if (point) return { value: point.formattedValue ?? '', provisional: point.provisional, periodLabel: point.periodLabel, unit: spec.unit, resultId: point.resultId };
    }
    return null;
  }
  if (spec.kind !== 'line' || spec.series.length !== 1) return null;
  const last = lastPlottedPoint(spec.series[0]!.points);
  if (!last) return null;
  return { value: last.formattedValue, provisional: last.provisional, periodLabel: last.periodLabel, unit: spec.unit, resultId: last.resultId };
}
```
(A null `formattedValue` on an overridden point — a genuine CBS gap — surfaces as an empty string
rather than crashing; add a one-line comment noting this is a real, if rare, honest-gap case R11
already allows elsewhere, and confirm the caller in `chart.tsx` doesn't render an empty headline —
skip rendering the headline block entirely when `value === ''`.)

- [ ] **Step 4: Run to verify pass**

Run: `cd web && npx vitest run lib/chart-headline.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into `chart.tsx`.** Update the existing `headlineFigure(spec)` call site (~line
1729 area) to `headlineFigure(spec, state.headlineOverrideResultId)`. Add a click affordance on chart
points (reuse the exact click target `ChartNotes`'s `pendingPoint` flow already attaches to points —
same event, a second action in the same click menu/popover: "maak dit het hoofdcijfer" /
"toon standaard hoofdcijfer" to clear), dispatching:
```ts
dispatchCommand({ kind: 'setHeadlineOverride', resultId: point.resultId }, 'canvas');
```
and a clear action dispatching `{ kind: 'setHeadlineOverride', resultId: null }`. Both need
`data-command-kind="setHeadlineOverride"`.

- [ ] **Step 6: Add an e2e case** to `web/e2e/chart-copilot.spec.ts`: click an earlier point, choose
"make this the headline," assert the big number changes to that point's value, undo, assert it reverts.

- [ ] **Step 7: Commit**

```bash
git add web/lib/chart-headline.ts web/lib/chart-headline.test.ts web/components/chart.tsx web/lib/i18n/messages.ts web/e2e/chart-copilot.spec.ts
git commit -m "feat(web): reader-chosen headline number — override which point is featured"
```

---

### Task 6: `deriveMean` + the on-demand derivation server action

**Depends on:** nothing (parallel with Task 1).

**Files:**
- Modify: `src/query/derivations.ts` (add `deriveMean`)
- Modify: `src/query/types.ts` (add the `'mean'` `DerivationRecord` member)
- Modify: `src/query/derivations.test.ts` (existing file)
- Create: `src/chart/spec-cells.ts`
- Create: `src/chart/spec-cells.test.ts`
- Create: `web/app/chart-derivation-actions.ts`
- Create: `web/app/chart-derivation-actions.test.ts`

**Interfaces:**
- Produces: `deriveMean(cells: Pick<ResultCell, 'resultId' | 'periodCode' | 'regionCode' | 'unit' |
  'value'>[]): DerivationResult`; a `'mean'` `DerivationRecord` variant; `specCellsByResultId(spec:
  ChartSpec): Map<string, Pick<ResultCell, 'resultId' | 'periodCode' | 'regionCode' | 'unit' |
  'value'>>`; `requestChartDerivation(rawKey: unknown, calcKind: 'difference' | 'mean', resultIds:
  unknown): Promise<{ ok: true; record: DerivationRecord } | { ok: false; reason: string }>` (server
  action, consumed by Task 7).

- [ ] **Step 1: Write the failing test for `deriveMean`**

```ts
// src/query/derivations.test.ts (existing file — add these cases)
import { deriveMean } from './derivations.ts';

const cell = (resultId: string, value: number | null, periodCode: string, regionCode: string | null = 'GM0518', unit = 'aantal'): ResultCell => ({
  resultId, value, periodCode, regionCode, unit,
  tableId: 't', measure: 'm', measureTitle: 'm', periodLabel: periodCode, grain: 'year',
  dims: {}, dimLabels: {}, decimals: 0, status: 'Definitief',
} as ResultCell);

describe('deriveMean', () => {
  it('averages ≥2 same-region cells', () => {
    const result = deriveMean([cell('r1', 10, '2019'), cell('r1', 20, '2020'), cell('r1', 30, '2021')]);
    expect(result).toEqual({ ok: true, record: expect.objectContaining({ kind: 'mean', value: 20, sourceResultIds: ['r1', 'r1', 'r1'] }) });
  });

  it('refuses fewer than 2 cells', () => {
    expect(deriveMean([cell('r1', 10, '2019')])).toEqual({ ok: false, reason: expect.stringContaining('needs at least 2') });
  });

  it('refuses when any cell is null (never guesses over a gap)', () => {
    const result = deriveMean([cell('r1', 10, '2019'), cell('r2', null, '2020')]);
    expect(result.ok).toBe(false);
  });

  it('refuses mixed units', () => {
    const result = deriveMean([cell('r1', 10, '2019', 'GM0518', 'aantal'), cell('r2', 20, '2020', 'GM0518', 'euro')]);
    expect(result.ok).toBe(false);
  });

  it('refuses cells spanning more than one region (not a meaningful average)', () => {
    const result = deriveMean([cell('r1', 10, '2019', 'GM0518'), cell('r2', 20, '2020', 'GM0363')]);
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/query/derivations.test.ts`
Expected: FAIL — `deriveMean` doesn't exist.

- [ ] **Step 3: Add the `'mean'` `DerivationRecord` member** in `src/query/types.ts`, next to
`'difference'`:
```ts
  | (DerivationBase & {
      kind: 'mean';
      /** Arithmetic mean of every source cell's value. */
      value: number;
    })
```

- [ ] **Step 4: Implement `deriveMean`** in `src/query/derivations.ts`, right after `deriveDifference`,
reusing `checkComputable` and `checkSingleRegion` exactly as `deriveDifference`/`deriveDirection` do:
```ts
/** Arithmetic mean over ≥2 cells at one place (region), any number of
 * periods. Reuses the same refusal discipline as every other derivation:
 * a null cell or a unit mismatch refuses the whole calculation rather than
 * silently skipping a value (principle c). */
export function deriveMean(cells: Pick<ResultCell, 'resultId' | 'periodCode' | 'regionCode' | 'unit' | 'value'>[]): DerivationResult {
  if (cells.length < 2) {
    return refuse(`mean needs at least 2 source cells, got ${cells.length}`);
  }
  const problem = checkComputable(cells as ResultCell[]) ?? checkSingleRegion(cells as ResultCell[]);
  if (problem) return refuse(problem);
  const sum = cells.reduce((acc, c) => acc + (c.value as number), 0);
  return {
    ok: true,
    record: {
      kind: 'mean',
      explicit: true,
      sourceResultIds: cells.map((c) => c.resultId),
      unit: cells[0]!.unit,
      marking: DERIVED_DATA_MARKING,
      value: sum / cells.length,
    },
  };
}
```
Widen `deriveDifference`'s parameter type the same way (`Pick<ResultCell, 'resultId' | 'periodCode' |
'regionCode' | 'unit' | 'value'>[]`) so both functions accept the same minimal cell shape
`spec-cells.ts` produces — confirm `checkComputable`/`checkSingleRegion`'s own parameter types already
only read those five fields (they do, per their current bodies) so this widening compiles with no
other change.

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/query/derivations.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/query/types.ts src/query/derivations.ts src/query/derivations.test.ts
git commit -m "feat: deriveMean — registered arithmetic-mean derivation (R5)"
```

- [ ] **Step 7: Write the failing test for `specCellsByResultId`**

```ts
// src/chart/spec-cells.test.ts
import { specCellsByResultId } from './spec-cells.ts';
import type { ChartSpec } from './types.ts';

const spec: ChartSpec = {
  schemaVersion: 1, kind: 'line', title: 't', dims: {}, dimLabels: {}, unit: 'aantal',
  series: [{ label: 'Rotterdam', regionCode: 'GM0599', points: [
    { resultId: 'r1', periodCode: '2019', periodLabel: '2019', value: 10, formattedValue: '10', decimals: 0, status: 'Definitief', provisional: false, valueAttribute: 'None' },
    { resultId: 'r2', periodCode: '2020', periodLabel: '2020', value: 20, formattedValue: '20', decimals: 0, status: 'Definitief', provisional: false, valueAttribute: 'None' },
  ] }],
  provisionalNote: null, nullNotes: [], definitionLine: null, attributionLine: '', attribution: {} as ChartSpec['attribution'],
};

it('flattens every series/point into a cell keyed by resultId, carrying the series regionCode and the spec unit', () => {
  const cells = specCellsByResultId(spec);
  expect(cells.get('r1')).toEqual({ resultId: 'r1', periodCode: '2019', regionCode: 'GM0599', unit: 'aantal', value: 10 });
  expect(cells.size).toBe(2);
});
```

- [ ] **Step 8: Run to verify failure**

Run: `npx vitest run src/chart/spec-cells.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 9: Implement `spec-cells.ts`**

```ts
// Flattens an already-built, already-audited ChartSpec back into minimal,
// derivation-ready cells (co-pilot phase 4, #274). This is NOT a new query —
// it re-reads values this chart's own answer already fetched and validated;
// it exists only so an on-demand derivation (difference/mean, requested from
// the chart-editing UI after the fact) can call the SAME registered
// derivation functions the answer pipeline uses, over the SAME cells,
// without a second, hand-rolled arithmetic path (R5).
import type { ResultCell } from '../query/types.ts';
import type { ChartSpec } from './types.ts';

export type DerivationCell = Pick<ResultCell, 'resultId' | 'periodCode' | 'regionCode' | 'unit' | 'value'>;

export function specCellsByResultId(spec: Pick<ChartSpec, 'unit' | 'series'>): Map<string, DerivationCell> {
  const out = new Map<string, DerivationCell>();
  for (const s of spec.series) {
    for (const p of s.points) {
      out.set(p.resultId, { resultId: p.resultId, periodCode: p.periodCode, regionCode: s.regionCode, unit: spec.unit, value: p.value });
    }
  }
  return out;
}
```

- [ ] **Step 10: Run to verify pass**

Run: `npx vitest run src/chart/spec-cells.test.ts`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add src/chart/spec-cells.ts src/chart/spec-cells.test.ts
git commit -m "feat: specCellsByResultId — flatten an audited ChartSpec into derivation-ready cells"
```

- [ ] **Step 12: Write the failing test for the server action**

```ts
// web/app/chart-derivation-actions.test.ts — mirror web/app/chart-edits-actions.test.ts's mocking
// conventions (mock currentUserId, getDb, loadAuditRecord) exactly.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/current-user.ts', () => ({ currentUserId: vi.fn().mockResolvedValue('u1') }));
vi.mock('../lib/db.ts', () => ({ getDb: vi.fn() }));
const loadAuditRecord = vi.fn();
vi.mock('../../src/answer/audit/read.ts', () => ({ loadAuditRecord }));

import { requestChartDerivation } from './chart-derivation-actions.ts';

const spec = { unit: 'aantal', series: [{ label: 'x', regionCode: 'GM0599', points: [
  { resultId: 'r1', periodCode: '2019', periodLabel: '2019', value: 10, formattedValue: '10', decimals: 0, status: 'Definitief', provisional: false, valueAttribute: 'None' },
  { resultId: 'r2', periodCode: '2020', periodLabel: '2020', value: 20, formattedValue: '20', decimals: 0, status: 'Definitief', provisional: false, valueAttribute: 'None' },
] }] };

describe('requestChartDerivation', () => {
  it('refuses a non-answer key (own-data charts have no audit row to re-read)', async () => {
    const result = await requestChartDerivation({ kind: 'turn', id: 1 }, 'difference', ['r1', 'r2']);
    expect(result.ok).toBe(false);
  });

  it('re-derives a difference over the audited chart\'s own cells, no new CBS fetch, no new audit row', async () => {
    loadAuditRecord.mockResolvedValue({ id: 5, response: { chart: spec } });
    const result = await requestChartDerivation({ kind: 'answer', id: 5 }, 'difference', ['r1', 'r2']);
    expect(result).toEqual({ ok: true, record: expect.objectContaining({ kind: 'difference', value: 10 }) });
  });

  it('refuses a resultId not present on that chart, rather than guessing', async () => {
    loadAuditRecord.mockResolvedValue({ id: 5, response: { chart: spec } });
    const result = await requestChartDerivation({ kind: 'answer', id: 5 }, 'difference', ['r1', 'not-real']);
    expect(result.ok).toBe(false);
  });

  it('refuses when the audit row has no chart at all', async () => {
    loadAuditRecord.mockResolvedValue({ id: 5, response: { chart: null } });
    const result = await requestChartDerivation({ kind: 'answer', id: 5 }, 'difference', ['r1', 'r2']);
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 13: Run to verify failure**

Run: `cd web && npx vitest run app/chart-derivation-actions.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 14: Implement `chart-derivation-actions.ts`**, mirroring `chart-edits-actions.ts`'s
structure and error-reporting convention exactly:

```ts
'use server';
// Chart co-pilot phase 4 (session 115, ADR 056, spec §9): re-runs a
// registered derivation (difference/mean) over an ALREADY-AUDITED chart's
// own cells, on demand. No CBS fetch, no new audit_answers row — the source
// cells were already fetched and verified once, when this chart's answer
// was first built; this only re-applies deterministic math to them (R5).
// CBS/Eurostat charts only (kind: 'answer') — an own-data chart already has
// its own aggregate/derive vocabulary (setInstruction, phase 2) and has no
// audit row for this to re-read.
import { z } from 'zod';
import { loadAuditRecord } from '../../src/answer/audit/read.ts';
import { deriveDifference, deriveMean } from '../../src/query/derivations.ts';
import { specCellsByResultId } from '../../src/chart/spec-cells.ts';
import type { DerivationRecord } from '../../src/query/types.ts';
import { currentUserId } from '../lib/current-user.ts';
import { getDb } from '../lib/db.ts';
import { reportError } from '../lib/error-report.ts';

const requestSchema = z.object({
  kind: z.literal('answer'),
  id: z.number().int().positive(),
});
const resultIdsSchema = z.array(z.string().min(1)).min(2).max(12);

export type RequestChartDerivationResponse = { ok: true; record: DerivationRecord } | { ok: false; reason?: string };

export async function requestChartDerivation(
  rawKey: unknown,
  calcKind: 'difference' | 'mean',
  rawResultIds: unknown,
): Promise<RequestChartDerivationResponse> {
  try {
    const userId = await currentUserId();
    if (userId === null) return { ok: false };
    const key = requestSchema.safeParse(rawKey);
    if (!key.success) return { ok: false, reason: 'only a CBS/Eurostat chart can be re-derived this way' };
    const resultIds = resultIdsSchema.safeParse(rawResultIds);
    if (!resultIds.success) return { ok: false };
    const record = await loadAuditRecord(getDb(), key.data.id);
    const spec = record?.response.chart ?? null;
    if (spec === null) return { ok: false, reason: 'this answer has no chart to derive from' };
    const cellsByResultId = specCellsByResultId(spec);
    const cells = resultIds.data.map((id) => cellsByResultId.get(id));
    if (cells.some((c) => c === undefined)) return { ok: false, reason: 'one of those points is not on this chart' };
    const result = calcKind === 'difference' ? deriveDifference(cells as NonNullable<typeof cells[number]>[]) : deriveMean(cells as NonNullable<typeof cells[number]>[]);
    return result.ok ? { ok: true, record: result.record } : { ok: false, reason: result.reason };
  } catch (e) {
    await reportError('requestChartDerivation', e, {});
    return { ok: false };
  }
}
```

- [ ] **Step 15: Run to verify pass**

Run: `cd web && npx vitest run app/chart-derivation-actions.test.ts`
Expected: PASS

- [ ] **Step 16: Commit**

```bash
git add web/app/chart-derivation-actions.ts web/app/chart-derivation-actions.test.ts
git commit -m "feat(web): requestChartDerivation server action — on-demand difference/mean over audited cells"
```

---

### Task 7: Difference arrow + average line UI

**Depends on:** Task 1 (command log, merged first) and Task 6 (server action, merged first).

**Files:**
- Create: `web/lib/chart-derived-overlay.ts`
- Create: `web/lib/chart-derived-overlay.test.ts`
- Modify: `web/components/chart.tsx` (a point-picker control for "difference between two points" and
  "average of the visible range," each producing an `addDerivedOverlay` command, plus a small effect
  that calls `requestChartDerivation` for any pending request and renders the resolved arrow/line
  inside `chartContainerRef` once resolved)
- Modify: `web/lib/i18n/messages.ts`

**Interfaces:**
- Consumes: `DerivedOverlayRequest`, `addDerivedOverlay`/`removeDerivedOverlay` commands (Task 1);
  `requestChartDerivation` (Task 6).
- Produces: `resolveDerivedOverlays(requests: DerivedOverlayRequest[], requester: (calcKind:
  'difference' | 'mean', resultIds: string[]) => Promise<RequestChartDerivationResponse>):
  Promise<Map<string, DerivationRecord>>` — a small pure-ish orchestration helper (real async
  function, injected requester so it's testable without mocking a server action) that `chart.tsx`
  calls from a `useEffect` keyed on `state.derivedOverlayRequests`.

- [ ] **Step 1: Write the failing test for `resolveDerivedOverlays`**

```ts
// web/lib/chart-derived-overlay.test.ts
import { describe, expect, it, vi } from 'vitest';
import { resolveDerivedOverlays } from './chart-derived-overlay.ts';

it('resolves every pending request and keys the results by overlay id', async () => {
  const requester = vi.fn().mockResolvedValue({ ok: true, record: { kind: 'difference', value: 5 } });
  const results = await resolveDerivedOverlays(
    [{ id: 'd1', calcKind: 'difference', resultIds: ['r1', 'r2'] }],
    requester,
  );
  expect(requester).toHaveBeenCalledWith('difference', ['r1', 'r2']);
  expect(results.get('d1')).toEqual({ kind: 'difference', value: 5 });
});

it('a refused request is simply absent from the result map, never a thrown error', async () => {
  const requester = vi.fn().mockResolvedValue({ ok: false, reason: 'nope' });
  const results = await resolveDerivedOverlays([{ id: 'd1', calcKind: 'mean', resultIds: ['r1', 'r2'] }], requester);
  expect(results.has('d1')).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run lib/chart-derived-overlay.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `chart-derived-overlay.ts`**

```ts
// Chart co-pilot phase 4: orchestrates resolving each pending
// DerivedOverlayRequest (the command-log "recipe") into its real
// DerivationRecord via the server action — never storing the resolved
// number in the command log itself (spec §9's command-log rule). The
// requester is injected so this stays testable without mocking a Server
// Action module.
import type { DerivationRecord } from '../../src/query/types.ts';
import type { DerivedOverlayRequest } from './chart-commands.ts';
import type { RequestChartDerivationResponse } from '../app/chart-derivation-actions.ts';

export async function resolveDerivedOverlays(
  requests: DerivedOverlayRequest[],
  requester: (calcKind: 'difference' | 'mean', resultIds: string[]) => Promise<RequestChartDerivationResponse>,
): Promise<Map<string, DerivationRecord>> {
  const out = new Map<string, DerivationRecord>();
  const settled = await Promise.all(requests.map(async (r) => [r.id, await requester(r.calcKind, r.resultIds)] as const));
  for (const [id, response] of settled) {
    if (response.ok) out.set(id, response.record);
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd web && npx vitest run lib/chart-derived-overlay.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/lib/chart-derived-overlay.ts web/lib/chart-derived-overlay.test.ts
git commit -m "feat(web): resolveDerivedOverlays — resolve derived-overlay recipes via the server action"
```

- [ ] **Step 6: Wire into `chart.tsx`.**
- A two-click point picker ("kies twee punten voor het verschil") dispatching:
  ```ts
  dispatchCommand({ kind: 'addDerivedOverlay', overlay: { id: newCommandId(), calcKind: 'difference', resultIds: [firstResultId, secondResultId] } }, 'panel');
  ```
- A "gemiddelde tonen" control over the currently-visible period range dispatching the `'mean'`
  variant with every currently-visible point's `resultId` on the primary series.
- A `useEffect(() => { resolveDerivedOverlays(state.derivedOverlayRequests, requestChartDerivation).then(setResolvedOverlays) }, [state.derivedOverlayRequests])`
  plus `const [resolvedOverlays, setResolvedOverlays] = useState<Map<string, DerivationRecord>>(new Map())`.
- Render each resolved overlay **inside** `chartContainerRef` (it is a real, traceable number, not
  reader content — unlike Tasks 2/3): a difference renders as an arrow between its two points labelled
  with `formattedValue`-equivalent (format `record.value` with this repo's existing Dutch number
  formatter — find and reuse it, do not hand-roll a second one); a mean renders as a horizontal line at
  `record.value` across the averaged range. Bind the rendered number via `data-label-for={record.
  sourceResultIds.join(',')}` — every existing numeric-token scan (R1/R6) already accepts a token bound
  this way.
- A remove control dispatching `removeDerivedOverlay`.
- Every new control gets `data-command-kind="addDerivedOverlay"` / `"removeDerivedOverlay"`.

- [ ] **Step 7: Add e2e cases** to `web/e2e/chart-copilot.spec.ts`: pick two points, add a difference
arrow, assert the correct value renders (compare against a hand-computed fixture, same convention the
existing own-data e2e case already uses); add an average line, assert its value; undo both, assert they
disappear; assert a difference/average request over points that don't share a region is refused with a
visible message, never silently drawn.

- [ ] **Step 8: Run tests**

Run: `cd web && npx vitest run components/chart.test.tsx lib/chart-derived-overlay.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add web/components/chart.tsx web/lib/i18n/messages.ts web/e2e/chart-copilot.spec.ts
git commit -m "feat(web): difference arrow + average line — on-demand derived overlays, drawn on the chart"
```

---

### Task 8: Contract test, property test, final review

**Depends on:** every prior task merged.

**Files:**
- Modify: `web/components/chart-commands-contract.test.tsx`
- Modify: `web/lib/chart-commands.test.ts` (property test)

**Interfaces:**
- Consumes: `CHART_COMMAND_KINDS` (now 22 kinds — the original 14 plus this phase's 8), `applyCommand`,
  `invertCommand`.

- [ ] **Step 1: Write the failing property test**

```ts
// web/lib/chart-commands.test.ts — add near the existing tests
import fc from 'fast-check';

it('property: apply(cmd) then apply(invert(cmd)) returns the original state, for every pure-client command kind', () => {
  fc.assert(
    fc.property(
      fc.constantFrom('addGoalLine', 'removeGoalLine', 'addEraShading', 'removeEraShading', 'setDimmed', 'setHeadlineOverride', 'addDerivedOverlay', 'removeDerivedOverlay'),
      (kind) => {
        // build one representative command per kind against a small fixed
        // ctx/state pair (reuse this file's existing ctx/state fixtures);
        // for each: const before = state; const after = applyCommand(state, cmd); const undone = applyCommand(after, invertCommand(state, cmd)); expect(undone).toEqual(before);
      },
    ),
  );
});
```

(This mirrors whatever property-test harness `chart-commands.test.ts` already uses for the phase 1-3
kinds — if one already exists in this file, extend its `fc.constantFrom` list with the eight new kinds
rather than writing a second, parallel property test.)

- [ ] **Step 2: Run to verify it passes** (the property should already hold if Task 1's `invertCommand`
cases were written correctly — this step is a real regression check, not expected to need new
implementation).

Run: `cd web && npx vitest run lib/chart-commands.test.ts -t "property"`
Expected: PASS. If it fails, the bug is in Task 1's `invertCommand` — fix it there, not here.

- [ ] **Step 3: Extend the contract test.** In `chart-commands-contract.test.tsx`, add one `it(...)`
per new command kind, following the file's existing pattern exactly: render the chart, find the control
by its `data-command-kind` attribute, fire the interaction, assert the resulting `ChartCommand`'s
`kind` matches. Confirm every one of the 8 new kinds has exactly one reachable control (no chat-only
capability — spec §9's contract-test addition #1).

- [ ] **Step 4: Run the full contract suite**

Run: `cd web && npx vitest run components/chart-commands-contract.test.tsx`
Expected: PASS — all 22 kinds covered.

- [ ] **Step 5: Run the whole verification block** (per `CLAUDE.md`'s definition of done — this is the
gate before any push, not optional): typechecks, root suite, web suite (solo, this machine is 8 GB —
see `feedback_verify_exit_codes.md`), `benchmark:run` + `benchmark:score` (14/14 + 6/6 + 0 fabricated),
the three Playwright proofs (`chart-copilot`, `own-data-copilot`, `cbs-copilot`), `next build`, and
`/code-review` at LOW effort over the full phase-4 diff.

- [ ] **Step 6: Commit**

```bash
git add web/components/chart-commands-contract.test.tsx web/lib/chart-commands.test.ts
git commit -m "test(web): chart co-pilot phase 4 — contract + property test coverage for all 22 command kinds"
```

---

## Self-review notes (writing-plans skill, run before handoff)

- **Spec coverage:** all six §9 primitives have a task (2,3,4,5,7 for the six; 1 and 6 are their shared
  foundations; 8 is the cross-cutting gate). The provenance rule (reader content outside the image,
  calculated values via re-run derivation, no value in the command) is enforced by name in Tasks 2, 3,
  6, 7's steps and pinned by Task 8's contract/property tests.
- **Placeholder scan:** no TBD/TODO; every step has real code or an exact grep/run command.
- **Type consistency:** `GoalLine`, `EraShading`, `DerivedOverlayRequest`, `DerivationCell` are defined
  once (Task 1 / Task 6) and referenced by the same names in every later task — checked against each
  task's own Interfaces block above.
- **Scope:** this plan is phase 4 only. Phase 5 (chart-fit scorer + new forms, spec §5.5) is
  deliberately out of scope.
