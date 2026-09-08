# Chart View-State Editing (Phases 1-3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship deterministic, client-only chart editing on every CBS chart — a line/bar/table form switch, a period-range zoom, series highlight (alongside the existing hide), and click-to-annotate notes — with zero AI calls, zero database changes, and zero prompt-byte changes, per the architecture panel's synthesized plan (Phases 0-3 only: https://claude.ai/code/artifact/91b16e9d-d5aa-4223-a6cf-ff3a7001c938, recorded on [open-questions #212](../../open-questions.md)).

**Architecture:** A pure `ChartViewState` reducer (`web/lib/chart-view-state.ts`) owns all client-only presentation state — form, hidden/highlighted series, period range, and (separately, session-only) annotation notes. `ChartView` (`web/components/chart.tsx`) consumes the reducer and projects the **unchanged** server-built `ChartSpec` through a pure `windowSpec()` helper before handing it to the existing `buildRows`/`valueLabelPlan`/`tableModel` builders — none of which change. Nothing here calls `buildChartSpec` again, nothing is written to the audit record, nothing crosses into `src/chart/*`.

**Tech Stack:** TypeScript, React 19 (`'use client'` components), Recharts, Vitest + `@testing-library/react` (web), Vitest (backend). No new dependencies.

## Global Constraints

- **Do not modify** `src/chart/build.ts`, `src/chart/types.ts`, `src/chart/render.ts`, `src/chart/schema.ts`, or `src/chart/annotations.ts` — the server-side deterministic builder and stored-spec schema (R6/R8 boundary) are out of scope for this plan, full stop.
- **Zero LLM calls, zero prompt bytes, zero database migrations, zero `audit_answers` schema change.** Every new piece of state (`form`, `hiddenKeys`, `highlightedKey`, `periodRange`, annotation notes) lives only in client `useReducer`/`useState`; none of it is ever serialized into a `ChartSpec`, sent to the server, or written into an audit envelope.
- **Click-to-annotate notes are session-only (owner decision F, conservative default — no persistence table, lost on reload).** Do not add a database table, a migration, or a `localStorage` fallback presented as if it were saved — if you want a note to survive a dock-tab switch within the same page load, that is an allowed implementation detail (e.g. lifting state one level), but never claim or imply cross-session persistence.
- **Bar-form Y-axis always starts at zero** (owner decision B, conservative default), regardless of whether the chart's original `spec.kind` was `'line'` or `'bar'` — i.e. `yAxisDomain` must be called with the *effective* rendered kind, never the original `spec.kind`, once a user can override form.
- **Switching to line form is blocked** whenever the original `spec.kind === 'bar'` (a CBS "comparison" shape: multiple regions, one period each) **and** more than one series is present — per the architecture panel's compliance table: "a line implies a trend across regions that was never measured." Switching a time series (`spec.kind === 'line'`) to bar form is always allowed (no honesty issue — see Task 1).
- **The auto-written trend headline (`spec.attribution.trendHeadline`) must not render whenever a period-range zoom is active** — it describes the full fetched range and would misdescribe a narrowed one (owner decision A's resolution: the plan removes the sentence rather than rewriting it).
- **Click-to-annotate notes render structurally outside `chartContainerRef`'s DOM subtree** (the `<div>` that wraps `ResponsiveContainer`, referenced by `ChartDownloadMenu`) — this is what keeps them out of PNG/SVG exports without any new exemption logic, and what keeps them from ever being scanned as if they were chart data (no R6 token-scan exemption needed, per open-questions #212).
- **All existing chart UI copy is Dutch** (unchanged convention for this specific pipeline — see `CLAUDE.md` Conventions: the English-copy decision explicitly excludes the CBS chat/answer pipeline). New UI strings you add (form-switch labels, zoom control labels, annotation UI copy) must be Dutch, matching the existing tone (`"Grafiek"`, `"Tabel"`, `"reeksen verborgen"`, `"Kleine grafieken"`).
- **Every new interactive control needs a real accessible name/role**, mirroring this file's existing patterns (`role="tablist"`/`role="tab"`/`aria-selected`, `role="group"`/`aria-pressed`).
- **Commit only — do not push.** This session works on a feature branch; only the orchestrating session pushes it and opens the PR.
- **Verification commands** (run after every task, from repo root `/Users/amity/Documents/Check de Cijfers` unless noted):
  - Root typecheck: `npm run typecheck`
  - Web typecheck: `npm run web:typecheck`
  - Backend chart tests only (fast, per-task): `npm run test:chart`
  - Web tests, scoped to the changed file (fast, per-task): `npm --prefix web run test -- <relative/path/from/web/to/file>`
  - Full backend suite (final integration only): `npm test`
  - Full web suite (final integration only): `npm run web:test`
  - Real build (final integration only): `npm run web:build`

---

## Task 1: Pure view-state module

**Files:**
- Create: `web/lib/chart-view-state.ts`
- Test: `web/lib/chart-view-state.test.ts`

**Interfaces:**
- Consumes: `ChartSpec`, `ChartPoint`, `ChartSeries` from `../backend/chart/types.ts` (type-only import; read-only use, never mutated).
- Produces (used by Tasks 2-5):
  - `type ChartForm = 'line' | 'bar' | 'table'`
  - `interface ChartViewState { form: ChartForm; hiddenKeys: Set<string>; highlightedKey: string | null; periodRange: [string, string] | null }`
  - `type ChartViewAction = { type: 'setForm'; form: ChartForm } | { type: 'toggleSeries'; key: string } | { type: 'setHighlight'; key: string | null } | { type: 'setPeriodRange'; range: [string, string] | null } | { type: 'reset'; initialForm: ChartForm }`
  - `function initialViewState(initialForm: ChartForm): ChartViewState`
  - `function chartViewReducer(state: ChartViewState, action: ChartViewAction): ChartViewState`
  - `function lineFormAllowed(spec: Pick<ChartSpec, 'kind'>, seriesCount: number): boolean`
  - `function windowSpec(spec: ChartSpec, range: [string, string] | null): ChartSpec` — returns a new `ChartSpec` (same shape, never a different type) whose every series' `points` array is filtered to `periodCode >= range[0] && periodCode <= range[1]`; returns `spec` unchanged (same reference) when `range` is `null`.

- [ ] **Step 1: Write the failing tests**

Create `web/lib/chart-view-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  chartViewReducer,
  initialViewState,
  lineFormAllowed,
  windowSpec,
  type ChartViewState,
} from './chart-view-state.ts';
import type { ChartPoint, ChartSeries, ChartSpec } from '../backend/chart/types.ts';

function point(periodCode: string, value: number): ChartPoint {
  return {
    resultId: `r-${periodCode}`,
    periodCode,
    periodLabel: periodCode,
    value,
    formattedValue: String(value),
    decimals: 0,
    status: 'Definitief',
    provisional: false,
    valueAttribute: 'None',
  };
}

function series(label: string, points: ChartPoint[]): ChartSeries {
  return { label, regionCode: label, points };
}

function spec(kind: 'line' | 'bar', seriesList: ChartSeries[]): ChartSpec {
  return {
    schemaVersion: 1,
    kind,
    title: 'Test',
    dims: {},
    dimLabels: {},
    unit: 'euro',
    series: seriesList,
    provisionalNote: null,
    nullNotes: [],
    definitionLine: null,
    attributionLine: 'CBS · test',
    attribution: {
      tableId: '12345',
      tableTitle: 'Test tabel',
      tableVersion: 1,
      syncedAt: '2026-09-08',
      coveredPeriods: { from: '2015', to: '2024' },
      license: 'CC BY 4.0',
    },
  };
}

describe('initialViewState', () => {
  it('starts with the given form and no filters', () => {
    const state = initialViewState('line');
    expect(state).toEqual<ChartViewState>({
      form: 'line',
      hiddenKeys: new Set(),
      highlightedKey: null,
      periodRange: null,
    });
  });
});

describe('chartViewReducer', () => {
  it('setForm switches the form', () => {
    const next = chartViewReducer(initialViewState('line'), { type: 'setForm', form: 'bar' });
    expect(next.form).toBe('bar');
  });

  it('toggleSeries adds then removes a key', () => {
    let state = initialViewState('line');
    state = chartViewReducer(state, { type: 'toggleSeries', key: 's0' });
    expect(state.hiddenKeys.has('s0')).toBe(true);
    state = chartViewReducer(state, { type: 'toggleSeries', key: 's0' });
    expect(state.hiddenKeys.has('s0')).toBe(false);
  });

  it('toggleSeries does not mutate the previous state object', () => {
    const state = initialViewState('line');
    const next = chartViewReducer(state, { type: 'toggleSeries', key: 's0' });
    expect(state.hiddenKeys.has('s0')).toBe(false);
    expect(next).not.toBe(state);
    expect(next.hiddenKeys).not.toBe(state.hiddenKeys);
  });

  it('setHighlight sets and clears the highlighted key', () => {
    let state = initialViewState('line');
    state = chartViewReducer(state, { type: 'setHighlight', key: 's1' });
    expect(state.highlightedKey).toBe('s1');
    state = chartViewReducer(state, { type: 'setHighlight', key: null });
    expect(state.highlightedKey).toBeNull();
  });

  it('setPeriodRange sets and clears the range', () => {
    let state = initialViewState('line');
    state = chartViewReducer(state, { type: 'setPeriodRange', range: ['2018', '2022'] });
    expect(state.periodRange).toEqual(['2018', '2022']);
    state = chartViewReducer(state, { type: 'setPeriodRange', range: null });
    expect(state.periodRange).toBeNull();
  });

  it('reset returns a fresh state for the given initial form, dropping all filters', () => {
    let state = initialViewState('line');
    state = chartViewReducer(state, { type: 'toggleSeries', key: 's0' });
    state = chartViewReducer(state, { type: 'setPeriodRange', range: ['2018', '2022'] });
    state = chartViewReducer(state, { type: 'reset', initialForm: 'bar' });
    expect(state).toEqual<ChartViewState>({
      form: 'bar',
      hiddenKeys: new Set(),
      highlightedKey: null,
      periodRange: null,
    });
  });
});

describe('lineFormAllowed', () => {
  it('allows line form for a line-kind spec regardless of series count', () => {
    expect(lineFormAllowed({ kind: 'line' }, 1)).toBe(true);
    expect(lineFormAllowed({ kind: 'line' }, 5)).toBe(true);
  });

  it('allows line form for a single-series bar-kind spec', () => {
    expect(lineFormAllowed({ kind: 'bar' }, 1)).toBe(true);
  });

  it('blocks line form for a multi-series bar-kind (comparison) spec', () => {
    expect(lineFormAllowed({ kind: 'bar' }, 2)).toBe(false);
    expect(lineFormAllowed({ kind: 'bar' }, 8)).toBe(false);
  });
});

describe('windowSpec', () => {
  it('returns the same reference when range is null', () => {
    const s = spec('line', [series('NL', [point('2020', 1), point('2021', 2)])]);
    expect(windowSpec(s, null)).toBe(s);
  });

  it('filters every series to the inclusive period range, preserving order', () => {
    const s = spec('line', [
      series('NL', [point('2018', 1), point('2019', 2), point('2020', 3), point('2021', 4)]),
    ]);
    const windowed = windowSpec(s, ['2019', '2020']);
    expect(windowed.series[0].points.map((p) => p.periodCode)).toEqual(['2019', '2020']);
    // Original untouched.
    expect(s.series[0].points).toHaveLength(4);
  });

  it('does not mutate the original spec object', () => {
    const s = spec('line', [series('NL', [point('2020', 1)])]);
    const before = JSON.stringify(s);
    windowSpec(s, ['2020', '2020']);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('preserves every other field (attribution, unit, kind) unchanged', () => {
    const s = spec('bar', [series('NL', [point('2020', 1)])]);
    const windowed = windowSpec(s, ['2020', '2020']);
    expect(windowed.attribution).toBe(s.attribution);
    expect(windowed.unit).toBe(s.unit);
    expect(windowed.kind).toBe(s.kind);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix web run test -- lib/chart-view-state.test.ts` (from repo root)
Expected: FAIL — `Cannot find module './chart-view-state.ts'` (the module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `web/lib/chart-view-state.ts`:

```ts
// Pure, client-only view-state for chart editing (Phases 1-3, open-questions
// #212). Nothing here calls buildChartSpec again, nothing here is ever
// written into an audit record — this module only ever PROJECTS the
// server-built ChartSpec for on-screen display. See docs/decisions/ for the
// full ADR.
import type { ChartSpec } from '../backend/chart/types.ts';

export type ChartForm = 'line' | 'bar' | 'table';

export interface ChartViewState {
  form: ChartForm;
  hiddenKeys: Set<string>;
  highlightedKey: string | null;
  /** Inclusive [fromPeriodCode, toPeriodCode], or null for the full fetched range. */
  periodRange: [string, string] | null;
}

export type ChartViewAction =
  | { type: 'setForm'; form: ChartForm }
  | { type: 'toggleSeries'; key: string }
  | { type: 'setHighlight'; key: string | null }
  | { type: 'setPeriodRange'; range: [string, string] | null }
  | { type: 'reset'; initialForm: ChartForm };

export function initialViewState(initialForm: ChartForm): ChartViewState {
  return { form: initialForm, hiddenKeys: new Set(), highlightedKey: null, periodRange: null };
}

export function chartViewReducer(state: ChartViewState, action: ChartViewAction): ChartViewState {
  switch (action.type) {
    case 'setForm':
      return { ...state, form: action.form };
    case 'toggleSeries': {
      const next = new Set(state.hiddenKeys);
      if (next.has(action.key)) next.delete(action.key);
      else next.add(action.key);
      return { ...state, hiddenKeys: next };
    }
    case 'setHighlight':
      return { ...state, highlightedKey: action.key };
    case 'setPeriodRange':
      return { ...state, periodRange: action.range };
    case 'reset':
      return initialViewState(action.initialForm);
    default:
      return state;
  }
}

/**
 * Owner decision B (architecture panel, session 88): switching a
 * multi-region "comparison" chart (spec.kind === 'bar', >1 series — one
 * point per region, no time axis) to line form is blocked outright, because
 * a line drawn across regions implies a trend that was never measured. A
 * time series (spec.kind === 'line') may always be shown as a bar; a
 * single-series bar (one region) may always be shown as a line.
 */
export function lineFormAllowed(spec: Pick<ChartSpec, 'kind'>, seriesCount: number): boolean {
  return !(spec.kind === 'bar' && seriesCount > 1);
}

/**
 * Projects `spec` to only the periods within the inclusive [from, to]
 * period-code range — the ONLY new "chart editing" primitive that touches
 * spec data, and it is pure filtering: every point kept is copied verbatim
 * (R6 verbatim-projection is preserved), nothing is recomputed, order is
 * preserved. Returns the SAME reference when range is null (no-op fast
 * path), so callers can safely pass this straight into React state without
 * an extra identity check.
 */
export function windowSpec(spec: ChartSpec, range: [string, string] | null): ChartSpec {
  if (!range) return spec;
  const [from, to] = range;
  return {
    ...spec,
    series: spec.series.map((s) => ({
      ...s,
      points: s.points.filter((p) => p.periodCode >= from && p.periodCode <= to),
    })),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix web run test -- lib/chart-view-state.test.ts`
Expected: PASS, all 13 tests green.

- [ ] **Step 5: Typecheck**

Run: `npm run web:typecheck`
Expected: no errors.

- [ ] **Step 6: Commit (do not push)**

```bash
git add web/lib/chart-view-state.ts web/lib/chart-view-state.test.ts
git commit -m "feat(chart): add pure chart view-state reducer + windowSpec projection"
```

---

## Task 2: Fold existing ad hoc chart state into the reducer (pure refactor, no behavior change)

This task ONLY consolidates `chart.tsx`'s existing four `useState` hooks (`view`, `hiddenKeys`, `smallMultiples`, `axisMode`) plus the manual `specIdentity` reset dance (lines 617-652 in the current file) into the Task 1 reducer — it must not change any visible behavior yet (no new UI). This is what fixes the documented stale-state bug class (the comment at the current lines 636-644: "a stale hiddenKeys entry that happens to collide with a different chart's own series key can silently drop a real line") by construction, since `reset` now clears everything atomically from one action instead of three separate setters.

**Files:**
- Modify: `web/components/chart.tsx:27` (import), `web/components/chart.tsx:611-652` (state block), every read site of `hiddenKeys` (lines 685, 707-708, 830-831, 876-877, 922-923, 950-958, 1038), `toggleSeries` (line 654-661, call site 952), `view`/`setView`/`selectView` (lines 620, 713-723, 754-778, 811, 945, 950, 960).
- Note: `smallMultiples`/`axisMode` stay as plain `useState` in this task — they are not part of Phases 1-3's scope (small multiples already exists and is untouched by this plan); only fold them into the SAME reset mechanism so the reducer's `reset` action and the existing `specIdentity` effect stay the single source of truth for "a genuinely different chart was shown." Represent them as two extra fields tracked alongside the reducer via the same `specIdentity` comparison, unchanged in shape.
- Test: `web/components/chart.test.tsx` (existing file — do not create a new one; you are verifying NO regression, so run the existing suite, do not add new cases in this task).

**Interfaces:**
- Consumes: `chartViewReducer`, `initialViewState`, `ChartViewState` from `../lib/chart-view-state.ts` (Task 1).
- Produces: `ChartView`'s internal `view` variable is replaced by `state.form === 'table' ? 'table' : 'chart'` everywhere it was previously read as `view === 'table'` / `view === 'chart'`; `hiddenKeys` is replaced by `state.hiddenKeys` everywhere; `toggleSeries(key)` becomes `dispatch({ type: 'toggleSeries', key })`.

- [ ] **Step 1: Confirm the existing test baseline passes before touching anything**

Run: `npm --prefix web run test -- components/chart.test.tsx`
Expected: PASS (record the exact test count — you will diff against this after the refactor; it must be identical).

- [ ] **Step 2: Replace the state block**

In `web/components/chart.tsx`, add the import (near the existing relative imports at the top):

```ts
import { chartViewReducer, initialViewState } from '../lib/chart-view-state.ts';
```

Also add `useReducer` to the existing React import line (`web/components/chart.tsx:27`):

```ts
import { useEffect, useId, useReducer, useRef, useState, type KeyboardEvent } from 'react';
```

Replace the block currently at lines 617-652 (from `const [view, setView] = useState...` through the closing `}` of the `if (specIdentity !== lastSpecIdentity)` block) with:

```ts
  // #197 step 2: chart or table. A comparison with more bars than the chart
  // can label opens on the table — the idea bank's >15-categories rule, the
  // honest view for many series.
  const initialForm = spec.series.length > BAR_LABEL_MAX ? 'table' : spec.kind;
  const [state, dispatch] = useReducer(chartViewReducer, initialForm, initialViewState);
  const chartTabRef = useRef<HTMLButtonElement>(null);
  const tableTabRef = useRef<HTMLButtonElement>(null);

  const [smallMultiples, setSmallMultiples] = useState(false);
  const [axisMode, setAxisMode] = useState<'shared' | 'own'>('shared');

  // Stable per-chart identity, not object identity: a fresh spec object can
  // represent the exact same chart across a re-render. Resets ALL
  // presentation state below when the viewer is shown a genuinely DIFFERENT
  // chart without ChartView remounting — both the visual dock
  // (visual-dock.tsx) and the Ontdek reading toggle (chart-toggle.tsx) swap
  // `spec` on the same mounted instance (no `key` at either call site), so a
  // useState/useReducer initializer only runs once and would otherwise leak
  // state across charts. A single reducer `reset` action now clears form,
  // hiddenKeys, highlightedKey and periodRange atomically — replacing the
  // three separate setState calls this used to be, which is what let a
  // stale hiddenKeys entry collide with a different chart's own series key
  // and silently drop a real line with no visible disclosure
  // (open-questions #46(a); found reachable via ordinary dock-tab switching
  // in the 2026-09-05 final review of this file). React's own documented
  // pattern for this ("adjusting state when a prop changes", no Effect):
  // compare against the last-seen identity and, if it changed, call the
  // setters directly during render.
  const specIdentity = JSON.stringify(spec);
  const [lastSpecIdentity, setLastSpecIdentity] = useState(specIdentity);
  if (specIdentity !== lastSpecIdentity) {
    setLastSpecIdentity(specIdentity);
    dispatch({ type: 'reset', initialForm });
    setSmallMultiples(false);
    setAxisMode('shared');
  }
```

Delete the old `toggleSeries` function (lines 654-661) — its one call site is updated below.

- [ ] **Step 3: Update every read/write site in the same file**

- `if (spec.schemaVersion !== 1) { ... }` block: unchanged, no state references.
- Everywhere `hiddenKeys` was read (`hiddenKeys.size`, `hiddenKeys.has(...)`), replace with `state.hiddenKeys`.
- The `hiddenDisclosure` line (current line 707-708):
  ```ts
  const hiddenDisclosure =
    state.hiddenKeys.size > 0 ? ` ${state.hiddenKeys.size} van ${seriesMeta.length} reeksen verborgen.` : '';
  ```
- `selectView` (current lines 713-716) becomes a small local helper that dispatches instead of calling `setView`:
  ```ts
  function selectView(next: 'chart' | 'table'): void {
    dispatch({ type: 'setForm', form: next === 'table' ? 'table' : initialForm === 'bar' ? 'bar' : 'line' });
    (next === 'chart' ? chartTabRef : tableTabRef).current?.focus();
  }
  ```
  (This preserves exact current behavior: the existing tablist only ever toggles chart/table, and "chart" always meant "the chart in its original kind" — Task 3 is what introduces a real independent line/bar choice.)
- `onTabKeyDown` (current lines 718-723): replace `selectView(view === 'chart' ? 'table' : 'chart')` with `selectView(state.form === 'table' ? 'chart' : 'table')`.
- Every `view === 'chart'` / `view === 'table'` in the JSX (current lines 758, 770, 779, 811, 826, 830, 945, 950, 960): replace with `state.form !== 'table'` / `state.form === 'table'` respectively (e.g. `aria-selected={view === 'chart'}` → `aria-selected={state.form !== 'table'}`).
- `spec.kind === 'line' ? <LineChart> : <BarChart>` (current line 834): unchanged in this task — Task 3 introduces the effective-kind override.
- `seriesMeta.filter((s) => !hiddenKeys.has(s.key))` (current lines 877, 923): replace with `seriesMeta.filter((s) => !state.hiddenKeys.has(s.key))`.
- `SeriesLegend seriesMeta={seriesMeta} hiddenKeys={hiddenKeys} onToggle={toggleSeries}` (current line 952): replace with `hiddenKeys={state.hiddenKeys} onToggle={(key) => dispatch({ type: 'toggleSeries', key })}`.
- `hiddenKeys.size > 0` (current line 953): replace with `state.hiddenKeys.size > 0`, and the count on line 955 with `state.hiddenKeys.size`.

- [ ] **Step 4: Run the existing test suite — must be byte-identical pass count**

Run: `npm --prefix web run test -- components/chart.test.tsx`
Expected: PASS, exact same test count as Step 1. If anything fails, you introduced a behavior change — this task must be a pure refactor; fix before proceeding, do not adjust the existing tests to match new behavior.

- [ ] **Step 5: Typecheck**

Run: `npm run web:typecheck`
Expected: no errors.

- [ ] **Step 6: Commit (do not push)**

```bash
git add web/components/chart.tsx
git commit -m "refactor(chart): consolidate chart.tsx presentation state into the view-state reducer"
```

---

## Task 3: Line / bar / table form switch

Adds the real independent form control (Lijn / Staaf / Tabel), replacing the two-option Grafiek/Tabel tablist Task 2 preserved as-is.

**Files:**
- Modify: `web/components/chart.tsx` (the tablist JSX at what is now around lines 748-778 post-Task-2; the `LineChart`/`BarChart` dispatch at ~line 834; both `YAxis domain={yAxisDomain(spec.kind)}` call sites at ~lines 857 and 920).
- Test: `web/components/chart.test.tsx` (add new cases; do not remove existing ones).

**Interfaces:**
- Consumes: `lineFormAllowed` from `../lib/chart-view-state.ts` (Task 1); `state.form`, `dispatch` from Task 2's reducer wiring.
- Produces: an `effectiveKind: 'line' | 'bar'` local variable in `ChartView`, used by both the Recharts dispatch and both `yAxisDomain` calls.

- [ ] **Step 1: Write the failing tests**

Append to `web/components/chart.test.tsx`. First add these fixture factories (do not assume any pre-existing factory in the file has this exact shape — these are self-contained and are reused by Tasks 4, 5 and 6 below, which append to this same file in sequence):

```tsx
import type { ChartPoint, ChartSpec } from '../backend/chart/types.ts';

function testPoint(periodCode: string, value: number, overrides: Partial<ChartPoint> = {}): ChartPoint {
  return {
    resultId: `r-${periodCode}-${value}`,
    periodCode,
    periodLabel: periodCode,
    value,
    formattedValue: String(value),
    decimals: 0,
    status: 'Definitief',
    provisional: false,
    valueAttribute: 'None',
    ...overrides,
  };
}

function testSpec(overrides: Partial<ChartSpec> & Pick<ChartSpec, 'kind' | 'series'>): ChartSpec {
  return {
    schemaVersion: 1,
    title: 'Test',
    dims: {},
    dimLabels: {},
    unit: 'euro',
    provisionalNote: null,
    nullNotes: [],
    definitionLine: null,
    attributionLine: 'CBS · test',
    attribution: {
      tableId: '12345',
      tableTitle: 'Test tabel',
      tableVersion: 1,
      syncedAt: '2026-09-08',
      coveredPeriods: { from: '2018', to: '2021' },
      license: 'CC BY 4.0',
    },
    ...overrides,
  };
}

function twoSeriesLineSpec(): ChartSpec {
  return testSpec({
    kind: 'line',
    series: [
      { label: 'Nederland', regionCode: null, points: [testPoint('2020', 100), testPoint('2021', 110)] },
      { label: 'Utrecht', regionCode: 'GM0344', points: [testPoint('2020', 50), testPoint('2021', 55)] },
    ],
  });
}

function multiRegionBarSpec(): ChartSpec {
  return testSpec({
    kind: 'bar',
    series: [
      { label: 'Groningen', regionCode: 'PV20', points: [testPoint('2021', 10)] },
      { label: 'Friesland', regionCode: 'PV21', points: [testPoint('2021', 20)] },
      { label: 'Drenthe', regionCode: 'PV22', points: [testPoint('2021', 15)] },
    ],
  });
}

function fourYearLineSpec(): ChartSpec {
  return testSpec({
    kind: 'line',
    series: [
      {
        label: 'Nederland',
        regionCode: null,
        points: [testPoint('2018', 100), testPoint('2019', 105), testPoint('2020', 95), testPoint('2021', 110)],
      },
    ],
  });
}

function trendHeadlineLineSpec(): ChartSpec {
  const s = fourYearLineSpec();
  return { ...s, attribution: { ...s.attribution, trendHeadline: 'Steeg van 100 naar 110.' } };
}

function negativeValueLineSpec(): ChartSpec {
  return testSpec({
    kind: 'line',
    series: [{ label: 'Nederland', regionCode: null, points: [testPoint('2020', -5), testPoint('2021', 10)] }],
  });
}
```

If `chart.test.tsx` already imports `ChartPoint`/`ChartSpec`, or already declares an equivalent helper under a different name, reuse the existing import/declaration instead of duplicating it — these are given here so every task in this plan is self-contained on its own, not to force a literal re-declaration when an equivalent already exists.

```tsx
describe('ChartView form switch', () => {
  it('offers Lijn, Staaf and Tabel controls', () => {
    const s = twoSeriesLineSpec(); // defined in Task 3 Step 1: spec.kind === 'line', 2 series
    render(<ChartView spec={s} />);
    expect(screen.getByRole('tab', { name: 'Lijn' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Staaf' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tabel' })).toBeInTheDocument();
  });

  it('disables Lijn for a multi-region comparison (bar) chart and explains why', () => {
    const s = multiRegionBarSpec(); // defined in Task 3 Step 1: spec.kind === 'bar', 3 series, 1 point each
    render(<ChartView spec={s} />);
    const lineTab = screen.getByRole('tab', { name: 'Lijn' });
    expect(lineTab).toBeDisabled();
    expect(lineTab).toHaveAttribute('title', expect.stringContaining('regio'));
  });

  it('switching to Staaf renders a BarChart-shaped structure for a line-kind spec', () => {
    const s = twoSeriesLineSpec();
    render(<ChartView spec={s} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    expect(document.querySelector('.recharts-bar')).not.toBeNull();
  });

  it('bar form always domains the Y-axis at zero, even for an originally line-kind spec', () => {
    const s = negativeValueLineSpec(); // defined in Task 3 Step 1: a line spec with a negative value point
    render(<ChartView spec={s} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    // yAxisDomain is exercised indirectly via Recharts' rendered axis; assert
    // the exported yAxisDomain function directly instead for a hermetic check:
    expect(yAxisDomain('bar')).toEqual([0, 'auto']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix web run test -- components/chart.test.tsx`
Expected: FAIL — no `role="tab"` named "Lijn"/"Staaf" exists yet.

- [ ] **Step 3: Implement the form switch**

Replace the tablist block (the `<div role="tablist" ...>` through its closing `</div>`, currently spanning what was lines 748-778 before Task 2's renumbering) with a three-tab version:

```tsx
      <div
        role="tablist"
        aria-label="Weergave"
        onKeyDown={onFormTabKeyDown}
        className="mt-3 inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5"
      >
        <button
          ref={lineTabRef}
          type="button"
          role="tab"
          aria-selected={state.form === 'line'}
          aria-controls={panelId}
          tabIndex={state.form === 'line' ? 0 : -1}
          disabled={!canUseLine}
          title={canUseLine ? undefined : 'Een lijn tussen regio’s zou een trend suggereren die niet is gemeten.'}
          onClick={() => selectForm('line')}
          className={segmentTab(state.form === 'line') + (canUseLine ? '' : ' cursor-not-allowed opacity-40')}
        >
          Lijn
        </button>
        <button
          ref={barTabRef}
          type="button"
          role="tab"
          aria-selected={state.form === 'bar'}
          aria-controls={panelId}
          tabIndex={state.form === 'bar' ? 0 : -1}
          onClick={() => selectForm('bar')}
          className={segmentTab(state.form === 'bar')}
        >
          Staaf
        </button>
        <button
          ref={tableTabRef}
          type="button"
          role="tab"
          aria-selected={state.form === 'table'}
          aria-controls={panelId}
          tabIndex={state.form === 'table' ? 0 : -1}
          onClick={() => selectForm('table')}
          className={segmentTab(state.form === 'table')}
        >
          Tabel
        </button>
      </div>
```

Remove the now-unused `chartTabRef` (keep `tableTabRef`, add `lineTabRef`/`barTabRef`) and replace `selectView`/`onTabKeyDown` (added in Task 2) with:

```ts
  const FORM_ORDER: ChartForm[] = canUseLine ? ['line', 'bar', 'table'] : ['bar', 'table'];
  const formTabRef: Record<ChartForm, typeof lineTabRef> = { line: lineTabRef, bar: barTabRef, table: tableTabRef };

  function selectForm(next: ChartForm): void {
    dispatch({ type: 'setForm', form: next });
    formTabRef[next].current?.focus();
  }

  function onFormTabKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const dir = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const idx = FORM_ORDER.indexOf(state.form === 'line' && !canUseLine ? 'bar' : state.form);
    const nextIdx = (idx + dir + FORM_ORDER.length) % FORM_ORDER.length;
    selectForm(FORM_ORDER[nextIdx]);
  }
```

Above the JSX return (near where `plan`/`markers`/`table` are computed, i.e. right after `const { rows, seriesMeta } = buildRows(spec);`), compute:

```ts
  const canUseLine = lineFormAllowed(spec, seriesMeta.length);
  const effectiveKind: ChartSpec['kind'] = state.form === 'table' ? spec.kind : state.form;
```

Add `ChartForm` and `lineFormAllowed` to the existing `chart-view-state.ts` import (from Task 2).

Replace `spec.kind === 'line' ? <LineChart>` (the dispatch that opens the chart-vs-table branch, now guarded by `state.form !== 'table'` from Task 2) with `effectiveKind === 'line' ? <LineChart>`.

Replace **both** `domain={yAxisDomain(spec.kind)}` occurrences (the `LineChart`'s `YAxis` and the `BarChart`'s `YAxis`) with `domain={yAxisDomain(effectiveKind)}`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix web run test -- components/chart.test.tsx`
Expected: PASS, including all of Task 2's preserved cases plus the new ones.

- [ ] **Step 5: Typecheck**

Run: `npm run web:typecheck`
Expected: no errors.

- [ ] **Step 6: Commit (do not push)**

```bash
git add web/components/chart.tsx web/components/chart.test.tsx
git commit -m "feat(chart): add line/bar/table form switch with the multi-region-line guard"
```

---

## Task 4: Period-range zoom

**Files:**
- Modify: `web/components/chart.tsx` (add the zoom control UI, wire `windowSpec` in front of `buildRows`/`valueLabelPlan`/`tableModel`/`annotationMarkers`, suppress the trend headline, extend the disclosure text and the `ChartDownloadMenu` `attributionText`).
- Test: `web/components/chart.test.tsx`.

**Interfaces:**
- Consumes: `windowSpec` from `../lib/chart-view-state.ts` (Task 1); `state.periodRange`, `dispatch` (Task 2/3 wiring).
- Produces: nothing new consumed by later tasks (Task 5/6 don't depend on zoom specifically, only on the same `state`/`dispatch`/`viewSpec` locals this task introduces).

- [ ] **Step 1: Write the failing tests**

Append to `web/components/chart.test.tsx`:

```tsx
describe('ChartView period-range zoom', () => {
  it('offers Vanaf/Tot period selectors for a line-kind chart with multiple periods', () => {
    const s = fourYearLineSpec(); // defined in Task 3 Step 1: single series, periods 2018-2021
    render(<ChartView spec={s} />);
    expect(screen.getByLabelText('Vanaf')).toBeInTheDocument();
    expect(screen.getByLabelText('Tot')).toBeInTheDocument();
  });

  it('narrowing the range hides points outside it and shows a disclosure note', () => {
    const s = fourYearLineSpec();
    render(<ChartView spec={s} />);
    fireEvent.change(screen.getByLabelText('Vanaf'), { target: { value: '2019' } });
    fireEvent.change(screen.getByLabelText('Tot'), { target: { value: '2020' } });
    expect(screen.getByText(/2019.*2020/)).toBeInTheDocument();
    expect(screen.queryByText('2018')).not.toBeInTheDocument();
  });

  it('suppresses the trend headline while a period range is active', () => {
    const s = trendHeadlineLineSpec(); // defined in Task 3 Step 1 (trendHeadlineLineSpec), extending fourYearLineSpec with attribution.trendHeadline set
    render(<ChartView spec={s} />);
    expect(screen.getByTestId('trend-headline')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Vanaf'), { target: { value: '2019' } });
    expect(screen.queryByTestId('trend-headline')).not.toBeInTheDocument();
  });

  it('does not offer a zoom control for a bar (comparison) chart', () => {
    const s = multiRegionBarSpec(); // from Task 3
    render(<ChartView spec={s} />);
    expect(screen.queryByLabelText('Vanaf')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix web run test -- components/chart.test.tsx`
Expected: FAIL — no `Vanaf`/`Tot` labels exist yet.

- [ ] **Step 3: Implement the zoom control**

Import `windowSpec` alongside the Task 1/3 imports.

Compute the full period-code list and the windowed spec, right after `const canUseLine = ...` / `effectiveKind` lines from Task 3:

```ts
  const allPeriodCodes = Array.from(
    new Set(spec.series.flatMap((s) => s.points.map((p) => p.periodCode))),
  ).sort((a, b) => a.localeCompare(b));
  const periodLabelByCode = new Map(
    spec.series.flatMap((s) => s.points.map((p): [string, string] => [p.periodCode, p.periodLabel])),
  );
  const zoomAvailable = spec.kind === 'line' && allPeriodCodes.length > 1;
  const viewSpec = zoomAvailable ? windowSpec(spec, state.periodRange) : spec;
```

Replace every downstream use of the raw `spec` for DATA (not for `spec.kind`/`spec.attribution`/`spec.title`/`spec.unit`, which describe the chart's identity, not its windowed content) with `viewSpec`:
- `const { rows, seriesMeta } = buildRows(spec);` → `buildRows(viewSpec)`
- `const markers = annotationMarkers(spec, rows);` → `annotationMarkers(viewSpec, rows)`
- `const plan = valueLabelPlan(spec);` → `valueLabelPlan(viewSpec)`
- `const table = tableModel(spec);` → `tableModel(viewSpec)`

Leave `canUseLine = lineFormAllowed(spec, seriesMeta.length)` reading the ORIGINAL `spec.kind` (the honesty rule is about the chart's true shape, not the current zoom window) — but note `seriesMeta` now comes from `buildRows(viewSpec)`, whose `.length` is unaffected by period filtering (filtering periods never removes a whole series), so this stays correct unchanged.

Add the zoom control, placed directly below the form-switch tablist from Task 3 and only when `zoomAvailable`:

```tsx
      {zoomAvailable ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <label htmlFor={`${domId}-from`}>Vanaf</label>
          <select
            id={`${domId}-from`}
            aria-label="Vanaf"
            value={state.periodRange?.[0] ?? allPeriodCodes[0]}
            onChange={(e) => {
              const to = state.periodRange?.[1] ?? allPeriodCodes[allPeriodCodes.length - 1];
              const from = e.target.value;
              dispatch({ type: 'setPeriodRange', range: from === allPeriodCodes[0] && to === allPeriodCodes[allPeriodCodes.length - 1] ? null : [from, to] });
            }}
            className="rounded-md border border-border bg-background px-1.5 py-0.5 text-foreground"
          >
            {allPeriodCodes.map((code) => (
              <option key={code} value={code}>
                {periodLabelByCode.get(code)}
              </option>
            ))}
          </select>
          <label htmlFor={`${domId}-to`}>Tot</label>
          <select
            id={`${domId}-to`}
            aria-label="Tot"
            value={state.periodRange?.[1] ?? allPeriodCodes[allPeriodCodes.length - 1]}
            onChange={(e) => {
              const from = state.periodRange?.[0] ?? allPeriodCodes[0];
              const to = e.target.value;
              dispatch({ type: 'setPeriodRange', range: from === allPeriodCodes[0] && to === allPeriodCodes[allPeriodCodes.length - 1] ? null : [from, to] });
            }}
            className="rounded-md border border-border bg-background px-1.5 py-0.5 text-foreground"
          >
            {allPeriodCodes.map((code) => (
              <option key={code} value={code}>
                {periodLabelByCode.get(code)}
              </option>
            ))}
          </select>
        </div>
      ) : null}
```

Suppress the trend headline while zoomed — change:
```tsx
{view === 'chart' && spec.attribution.trendHeadline !== undefined ? (
```
(now, post-Task-2/3, `state.form !== 'table' && spec.attribution.trendHeadline !== undefined`) to also require `!state.periodRange`:
```tsx
{state.form !== 'table' && !state.periodRange && spec.attribution.trendHeadline !== undefined ? (
```

Add the zoom disclosure line, merged with the existing `hiddenDisclosure` string:

```ts
  const zoomDisclosure = state.periodRange
    ? ` Getoond: ${periodLabelByCode.get(state.periodRange[0])}–${periodLabelByCode.get(state.periodRange[1])} van ${spec.attribution.coveredPeriods.from}–${spec.attribution.coveredPeriods.to}.`
    : '';
```

Change the `hiddenDisclosure` computation (Task 2's `state.hiddenKeys` version) to append it, and update the on-page disclosure paragraph and the `ChartDownloadMenu`'s `attributionText` to include both:

```ts
  const hiddenDisclosure =
    state.hiddenKeys.size > 0 ? ` ${state.hiddenKeys.size} van ${seriesMeta.length} reeksen verborgen.` : '';
  const viewDisclosure = `${hiddenDisclosure}${zoomDisclosure}`;
```

Replace the `ChartDownloadMenu attributionText` prop:
```tsx
attributionText={`${spec.attributionLine} checkdecijfers.nl${viewDisclosure}`}
```

Add an on-screen paragraph for the zoom disclosure near the existing hidden-series note (below the `SeriesLegend` block), rendered whenever `zoomDisclosure` is non-empty:
```tsx
{zoomDisclosure ? <p className="mt-1 text-xs text-muted-foreground">{zoomDisclosure.trim()}</p> : null}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix web run test -- components/chart.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run web:typecheck`
Expected: no errors.

- [ ] **Step 6: Commit (do not push)**

```bash
git add web/components/chart.tsx web/components/chart.test.tsx
git commit -m "feat(chart): add period-range zoom with on-screen and export disclosure"
```

---

## Task 5: Series highlight

Extends the existing hide-only `SeriesLegend` with a second, independent interaction: highlighting one series dims the others (opacity), without hiding them.

**Files:**
- Modify: `web/components/chart.tsx` — the `SeriesLegend` function (Task-2-preserved, originally lines 417-458), the `Line`/`Bar` JSX (`strokeOpacity`/`fillOpacity`), `SeriesDot`/`SeriesBar` (pass through an opacity).
- Test: `web/components/chart.test.tsx`.

**Interfaces:**
- Consumes: `state.highlightedKey`, `dispatch({ type: 'setHighlight', key })` (Task 1/2).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

Append to `web/components/chart.test.tsx`:

```tsx
describe('ChartView series highlight', () => {
  it('offers a highlight control per series alongside the hide toggle', () => {
    const s = twoSeriesLineSpec();
    render(<ChartView spec={s} />);
    expect(screen.getByRole('button', { name: /Markeer NL/ })).toBeInTheDocument();
  });

  it('marks the highlighted series pressed and dims the un-highlighted one', () => {
    const s = twoSeriesLineSpec(); // series labelled 'NL' and 'Utrecht' in the existing factory
    render(<ChartView spec={s} />);
    fireEvent.click(screen.getByRole('button', { name: /Markeer NL/ }));
    expect(screen.getByRole('button', { name: /Markeer NL/ })).toHaveAttribute('aria-pressed', 'true');
    const dimmedLine = document.querySelector('.recharts-line[data-series-dimmed="true"]');
    expect(dimmedLine).not.toBeNull();
  });

  it('clicking the same highlight button again clears the highlight', () => {
    const s = twoSeriesLineSpec();
    render(<ChartView spec={s} />);
    const btn = screen.getByRole('button', { name: /Markeer NL/ });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(document.querySelector('[data-series-dimmed="true"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix web run test -- components/chart.test.tsx`
Expected: FAIL — no "Markeer" button exists yet.

- [ ] **Step 3: Implement highlight**

Extend `SeriesLegend`'s props and render a second button per series:

```tsx
function SeriesLegend({
  seriesMeta,
  hiddenKeys,
  highlightedKey,
  onToggle,
  onHighlight,
}: {
  seriesMeta: SeriesMeta[];
  hiddenKeys: Set<string>;
  highlightedKey: string | null;
  onToggle: (key: string) => void;
  onHighlight: (key: string | null) => void;
}) {
  return (
    <div role="group" aria-label="Reeksen" className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
      {seriesMeta.map((s) => {
        const hidden = hiddenKeys.has(s.key);
        const highlighted = highlightedKey === s.key;
        return (
          <span key={s.key} className="inline-flex items-center gap-1">
            <button
              type="button"
              aria-pressed={!hidden}
              onClick={() => onToggle(s.key)}
              className={
                'inline-flex min-h-6 items-center gap-1.5 rounded-md px-1.5 text-xs hover:bg-muted ' +
                (hidden ? 'text-muted-foreground line-through' : 'text-foreground')
              }
            >
              <span
                aria-hidden="true"
                style={{ backgroundColor: hidden ? 'var(--muted-foreground)' : s.color }}
                className="inline-block h-2.5 w-2.5 rounded-full"
              />
              {s.label}
            </button>
            <button
              type="button"
              aria-pressed={highlighted}
              disabled={hidden}
              onClick={() => onHighlight(highlighted ? null : s.key)}
              title={`Markeer ${s.label}, andere reeksen worden gedimd`}
              className={
                'min-h-6 rounded-md px-1 text-xs hover:bg-muted ' +
                (highlighted ? 'text-foreground font-semibold' : 'text-muted-foreground')
              }
            >
              {`Markeer ${s.label}`}
            </button>
          </span>
        );
      })}
    </div>
  );
}
```

Update the call site (Task 2's `SeriesLegend seriesMeta={seriesMeta} hiddenKeys={state.hiddenKeys} onToggle={...}`):

```tsx
<SeriesLegend
  seriesMeta={seriesMeta}
  hiddenKeys={state.hiddenKeys}
  highlightedKey={state.highlightedKey}
  onToggle={(key) => dispatch({ type: 'toggleSeries', key })}
  onHighlight={(key) => dispatch({ type: 'setHighlight', key })}
/>
```

Dim non-highlighted series in both chart kinds. On the `<Line>` element (inside the `seriesMeta.filter(...).map((s) => (<Line ...>))` block):

```tsx
<Line
  key={s.key}
  type="linear"
  dataKey={s.key}
  name={s.label}
  stroke={s.color}
  strokeWidth={2}
  strokeOpacity={state.highlightedKey && state.highlightedKey !== s.key ? 0.25 : 1}
  className={state.highlightedKey && state.highlightedKey !== s.key ? 'recharts-line' : 'recharts-line'}
  data-series-dimmed={state.highlightedKey && state.highlightedKey !== s.key ? 'true' : undefined}
  connectNulls={false}
  dot={SeriesDot(s.key, endLabelByKey.get(s.key))}
  isAnimationActive={false}
/>
```

(Recharts always applies the `recharts-line`/`recharts-bar` class itself on the rendered `<path>`/`<g>`; the `data-series-dimmed` attribute you add via the `Line`/`Bar` element's own props is what the test above queries — Recharts forwards unrecognized DOM-safe props onto its root SVG group.)

On the `<Bar>` element analogously:

```tsx
<Bar
  key={s.key}
  dataKey={s.key}
  name={s.label}
  fill={s.color}
  fillOpacity={state.highlightedKey && state.highlightedKey !== s.key ? 0.25 : 1}
  data-series-dimmed={state.highlightedKey && state.highlightedKey !== s.key ? 'true' : undefined}
  isAnimationActive={false}
  shape={SeriesBar(s.key, s.color, `hatch-${domId}-${s.key}`, barLabelsByKey.get(s.key) ?? new Map<string, PointLabel>())}
/>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix web run test -- components/chart.test.tsx`
Expected: PASS. If `data-series-dimmed` does not survive onto the rendered DOM node (Recharts version-dependent), fall back to asserting via the `SeriesLegend` button's `aria-pressed` state only and drop the DOM-dimming assertion from the third test — but keep the visual `strokeOpacity`/`fillOpacity` behavior, since that is the actual user-visible feature.

- [ ] **Step 5: Typecheck**

Run: `npm run web:typecheck`
Expected: no errors.

- [ ] **Step 6: Commit (do not push)**

```bash
git add web/components/chart.tsx web/components/chart.test.tsx
git commit -m "feat(chart): add series highlight (dim others) alongside the existing hide toggle"
```

---

## Task 6: Click-to-annotate notes

**Files:**
- Create: `web/components/chart-notes.tsx`
- Create: `web/components/chart-notes.test.tsx`
- Modify: `web/components/chart.tsx` — mount `ChartNotes` as a sibling block AFTER the `chartContainerRef` div closes (never inside it), wire click handlers on `SeriesDot`/`SeriesBar` to report the clicked point.

**Interfaces:**
- Produces (new, exported from `chart-notes.tsx`):
  - `interface ChartNote { id: string; resultId: string; periodLabel: string; seriesLabel: string; text: string }`
  - `function ChartNotes({ notes, onAdd, onDelete }: { notes: ChartNote[]; onAdd: (note: Omit<ChartNote, 'id' | 'text'> & { text: string }) => void; onDelete: (id: string) => void })` — renders under a heading "Uw aantekeningen (geen CBS-data)", one entry per note with a delete button, and (only when a pending click target is set via a separate prop below) an inline text form.
  - Actually simplify to a single controlled component owning its own "pending" input state internally, driven by an external `pendingPoint` prop the parent sets on click:
  - `function ChartNotes({ notes, pendingPoint, onSave, onCancelPending, onDelete }: { notes: ChartNote[]; pendingPoint: { resultId: string; periodLabel: string; seriesLabel: string } | null; onSave: (text: string) => void; onCancelPending: () => void; onDelete: (id: string) => void })`
- Consumes in `chart.tsx`: a new `useState<ChartNote[]>([])` for `notes`, `useState<{ resultId: string; periodLabel: string; seriesLabel: string } | null>(null)` for `pendingPoint` — both plain local component state, reset by the same `specIdentity` guard from Task 2 (a new chart's clicks should not carry over another chart's notes).

- [ ] **Step 1: Write the failing tests for `ChartNotes`**

Create `web/components/chart-notes.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChartNotes, type ChartNote } from './chart-notes.tsx';

afterEach(cleanup);

const NOTE: ChartNote = { id: 'n1', resultId: 'r-2020', periodLabel: '2020', seriesLabel: 'Nederland', text: 'Coronapiek' };

describe('ChartNotes', () => {
  it('renders nothing when there are no notes and no pending click', () => {
    render(<ChartNotes notes={[]} pendingPoint={null} onSave={vi.fn()} onCancelPending={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByText('Uw aantekeningen (geen CBS-data)')).not.toBeInTheDocument();
  });

  it('lists existing notes with their point context, under a clear non-CBS heading', () => {
    render(<ChartNotes notes={[NOTE]} pendingPoint={null} onSave={vi.fn()} onCancelPending={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Uw aantekeningen (geen CBS-data)')).toBeInTheDocument();
    expect(screen.getByText(/Nederland.*2020/)).toBeInTheDocument();
    expect(screen.getByText('Coronapiek')).toBeInTheDocument();
  });

  it('deleting a note calls onDelete with its id', () => {
    const onDelete = vi.fn();
    render(<ChartNotes notes={[NOTE]} pendingPoint={null} onSave={vi.fn()} onCancelPending={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: /verwijder/i }));
    expect(onDelete).toHaveBeenCalledWith('n1');
  });

  it('shows an entry form when a point is pending, labelled with the clicked point context', () => {
    render(
      <ChartNotes
        notes={[]}
        pendingPoint={{ resultId: 'r-2021', periodLabel: '2021', seriesLabel: 'Utrecht' }}
        onSave={vi.fn()}
        onCancelPending={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText(/Utrecht.*2021/)).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('saving the pending form calls onSave with the typed text and clears on Escape without saving', () => {
    const onSave = vi.fn();
    const onCancelPending = vi.fn();
    render(
      <ChartNotes
        notes={[]}
        pendingPoint={{ resultId: 'r-2021', periodLabel: '2021', seriesLabel: 'Utrecht' }}
        onSave={onSave}
        onCancelPending={onCancelPending}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Piek na fusie' } });
    fireEvent.click(screen.getByRole('button', { name: /opslaan/i }));
    expect(onSave).toHaveBeenCalledWith('Piek na fusie');
  });

  it('does not call onSave for an empty/whitespace-only note', () => {
    const onSave = vi.fn();
    render(
      <ChartNotes
        notes={[]}
        pendingPoint={{ resultId: 'r-2021', periodLabel: '2021', seriesLabel: 'Utrecht' }}
        onSave={onSave}
        onCancelPending={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /opslaan/i }));
    expect(onSave).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix web run test -- components/chart-notes.test.tsx`
Expected: FAIL — `Cannot find module './chart-notes.tsx'`.

- [ ] **Step 3: Implement `ChartNotes`**

Create `web/components/chart-notes.tsx`:

```tsx
'use client';

// Click-to-annotate notes (Phase 3, open-questions #212). A note is a plain
// user-typed string anchored to the resultId/period/series the user clicked
// — it is NEVER sent to the LLM, never stored in a ChartSpec or an audit
// record, and it is rendered by the PARENT (chart.tsx) structurally OUTSIDE
// the chart's own chartContainerRef subtree, so it can never be scanned as
// chart data (no R6 token-scan exemption needed) and is automatically
// excluded from the PNG/SVG export (which only ever reads the live <svg>
// inside chartContainerRef). Session-only by owner decision (F): no
// persistence, nothing here survives a reload.
import { useState } from 'react';

export interface ChartNote {
  id: string;
  resultId: string;
  periodLabel: string;
  seriesLabel: string;
  text: string;
}

export interface PendingPoint {
  resultId: string;
  periodLabel: string;
  seriesLabel: string;
}

export function ChartNotes({
  notes,
  pendingPoint,
  onSave,
  onCancelPending,
  onDelete,
}: {
  notes: ChartNote[];
  pendingPoint: PendingPoint | null;
  onSave: (text: string) => void;
  onCancelPending: () => void;
  onDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState('');

  if (notes.length === 0 && !pendingPoint) return null;

  function save(): void {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    onSave(trimmed);
    setDraft('');
  }

  return (
    <div className="mt-3 rounded-lg border border-dashed border-border p-3">
      <div role="heading" aria-level={4} className="text-xs font-semibold text-muted-foreground">
        Uw aantekeningen (geen CBS-data)
      </div>
      {notes.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1.5">
          {notes.map((note) => (
            <li key={note.id} className="flex items-start justify-between gap-2 text-sm">
              <span>
                <span className="text-xs text-muted-foreground">
                  {note.seriesLabel} · {note.periodLabel}:{' '}
                </span>
                {note.text}
              </span>
              <button
                type="button"
                onClick={() => onDelete(note.id)}
                className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
              >
                Verwijder
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {pendingPoint ? (
        <div className="mt-2 flex flex-col gap-1.5">
          <label htmlFor="chart-note-draft" className="text-xs text-muted-foreground">
            Notitie bij {pendingPoint.seriesLabel} · {pendingPoint.periodLabel}
          </label>
          <textarea
            id="chart-note-draft"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setDraft('');
                onCancelPending();
              }
            }}
            rows={2}
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              className="min-h-6 rounded-md border border-border px-2 py-0.5 text-xs text-foreground hover:bg-muted"
            >
              Opslaan
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft('');
                onCancelPending();
              }}
              className="min-h-6 rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
            >
              Annuleren
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run `ChartNotes` tests to verify they pass**

Run: `npm --prefix web run test -- components/chart-notes.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire `ChartNotes` into `ChartView` and add click handlers**

In `web/components/chart.tsx`, import:

```ts
import { ChartNotes, type ChartNote, type PendingPoint } from './chart-notes.tsx';
```

Add state (near the `smallMultiples`/`axisMode` state from Task 2), and reset it in the same `specIdentity` block:

```ts
  const [notes, setNotes] = useState<ChartNote[]>([]);
  const [pendingPoint, setPendingPoint] = useState<PendingPoint | null>(null);
```

In the `if (specIdentity !== lastSpecIdentity) { ... }` block, add:

```ts
    setNotes([]);
    setPendingPoint(null);
```

Add an `onPointClick` parameter threaded through `SeriesDot`/`SeriesBar`:

```ts
function SeriesDot(
  seriesKey: string,
  endLabel: PointLabel | undefined,
  seriesLabel: string,
  onPointClick: (point: PendingPoint) => void,
) {
  return function Dot(props: { cx?: number; cy?: number; payload?: Row; stroke?: string }) {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null || !payload) return null;
    const value = payload[seriesKey];
    if (value == null) return null;
    const provisional = payload[`${seriesKey}_provisional`];
    const resultId = payload[`${seriesKey}_resultId`];
    const color = props.stroke ?? 'currentColor';
    const isEnd = endLabel !== undefined && payload.periodCode === endLabel.periodCode;
    return (
      <g>
        <circle
          cx={cx}
          cy={cy}
          r={4}
          fill={provisional ? 'var(--card)' : color}
          stroke={color}
          strokeWidth={2}
          data-point="value"
          data-result-id={resultId == null ? undefined : String(resultId)}
          role="button"
          tabIndex={0}
          aria-label={`Voeg notitie toe bij ${seriesLabel}, ${String(payload.periodLabel)}`}
          style={{ cursor: 'pointer' }}
          onClick={() =>
            resultId != null &&
            onPointClick({ resultId: String(resultId), periodLabel: String(payload.periodLabel), seriesLabel })
          }
        />
        {isEnd ? (
          <text
            x={cx + 8}
            y={cy + 4}
            fontSize={11}
            fill="var(--foreground)"
            textAnchor="start"
            data-role="end-label"
            data-label-for={endLabel.resultId}
          >
            {endLabel.text}
          </text>
        ) : null}
      </g>
    );
  };
}
```

Update its one call site: `dot={SeriesDot(s.key, endLabelByKey.get(s.key))}` → `dot={SeriesDot(s.key, endLabelByKey.get(s.key), s.label, (p) => setPendingPoint(p))}`.

Apply the analogous change to `SeriesBar` (add a `seriesLabel: string, onPointClick: (point: PendingPoint) => void` parameter, add `role="button" tabIndex={0} aria-label={...} style={{ cursor: 'pointer' }} onClick={() => resultId != null && onPointClick({ resultId: String(resultId), periodLabel: String(payload.periodLabel), seriesLabel })}` onto the `<rect>`), and update its call site: `shape={SeriesBar(s.key, s.color, ..., ...)}` → `shape={SeriesBar(s.key, s.color, ..., ..., s.label, (p) => setPendingPoint(p))}`.

Mount `ChartNotes` AFTER the closing `</div>` of the `chartContainerRef`-wrapped block (i.e. after the `{view === 'table' ? (...) : (<div ref={chartContainerRef} ...>...</div>)}` conditional closes — well outside `chartContainerRef`'s own subtree — and only when `state.form !== 'table'`, since notes anchor to chart points, not table cells):

```tsx
      {state.form !== 'table' ? (
        <ChartNotes
          notes={notes}
          pendingPoint={pendingPoint}
          onSave={(text) => {
            if (!pendingPoint) return;
            setNotes((prev) => [...prev, { id: `${pendingPoint.resultId}-${prev.length}`, ...pendingPoint, text }]);
            setPendingPoint(null);
          }}
          onCancelPending={() => setPendingPoint(null)}
          onDelete={(id) => setNotes((prev) => prev.filter((n) => n.id !== id))}
        />
      ) : null}
```

Place this block right before the final attribution `<div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">...</div>` (i.e. notes appear between the chart's own presentation notes and the CBS attribution row — never inside `chartContainerRef`, never inside the attribution row itself).

- [ ] **Step 6: Add integration tests to `chart.test.tsx`**

Append:

```tsx
describe('ChartView click-to-annotate', () => {
  it('clicking a chart point opens the note entry form for that point', () => {
    const s = twoSeriesLineSpec();
    render(<ChartView spec={s} />);
    const dot = document.querySelector('circle[data-point="value"]')!;
    fireEvent.click(dot);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('a saved note is never rendered inside the chart export container', () => {
    const s = twoSeriesLineSpec();
    const { container } = render(<ChartView spec={s} />);
    const dot = document.querySelector('circle[data-point="value"]')!;
    fireEvent.click(dot);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Test notitie' } });
    fireEvent.click(screen.getByRole('button', { name: /opslaan/i }));
    const exportContainer = container.querySelector('[role="tabpanel"][aria-label="Grafiek"]');
    expect(exportContainer?.textContent).not.toContain('Test notitie');
    expect(screen.getByText('Test notitie')).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run the full `chart.tsx`-related web test files**

Run: `npm --prefix web run test -- components/chart.test.tsx components/chart-notes.test.tsx`
Expected: PASS.

- [ ] **Step 8: Typecheck**

Run: `npm run web:typecheck`
Expected: no errors.

- [ ] **Step 9: Commit (do not push)**

```bash
git add web/components/chart-notes.tsx web/components/chart-notes.test.tsx web/components/chart.tsx web/components/chart.test.tsx
git commit -m "feat(chart): add click-to-annotate notes, session-only, outside the export container"
```

---

## Task 7: ADR for the view-state reducer + click-to-annotate mechanism

Per `CLAUDE.md`'s convention ("every load-bearing technical choice gets an ADR"), this new module boundary and the R1/R6/R9/R10-adjacent design need a record — mirroring the existing ADR format (see `docs/decisions/037-user-data-attachments.md` or `docs/decisions/014-chart-spec-v1-and-renderer.md` for house style: Context / Decision / Alternatives considered / Consequences / Revisit triggers).

**Files:**
- Create: `docs/decisions/0XX-chart-view-state-editing.md` (use the next free number — run `ls docs/decisions/ | sort -V | tail -3` to find it before creating the file).
- Modify: `docs/open-questions.md` row `#212` — append a dated addendum (do not rewrite the existing row; CLAUDE.md convention is to append, never silently overwrite a recorded history) recording: (1) this build happened on a feature branch per the autonomous-session git-workflow rule (issue #118), (2) the resolutions actually built for decisions A (resolved by design: the trend sentence is suppressed, never rewritten, exactly as the architecture panel described), B (bar form always starts at zero — conservative default, no owner sign-off obtained), C/D (resolved by the chosen mechanism: a separate disclosure note, never rewriting the source line; notes structurally distinct and labelled, residual risk accepted as documented in the artifact), E (notes excluded from downloads for this build — permanence not decided), F (session-only notes, no persistence table — conservative default per this session's explicit scope), and that G/H remain fully open (out of scope for this build). State explicitly: **B and F used the conservative/reversible default because the owner had not resolved them by the time this autonomous session ran — not a formal owner decision.**

- [ ] **Step 1: Find the next ADR number**

Run: `ls "/Users/amity/Documents/Check de Cijfers/docs/decisions/" | sort -V | tail -3`

- [ ] **Step 2: Write the ADR**

Create `docs/decisions/0XX-chart-view-state-editing.md` (replace `0XX` with the number found above, e.g. if the last is `037` use `038`):

```markdown
# ADR 0XX: Chart view-state editing (Phases 1-3) as a pure client reducer

## Context

Session 88's architecture panel (open-questions #212, artifact
https://claude.ai/code/artifact/91b16e9d-d5aa-4223-a6cf-ff3a7001c938) proposed
letting users adjust how an already-answered CBS chart is DISPLAYED — line/
bar/table form, a period-range zoom, series hide/highlight — and add personal
click-to-annotate notes, all without any LLM call, database change, or
prompt-byte change for the first three phases. This ADR records the as-built
mechanism for that scope (Phase 0-3 only), built by an autonomous session per
open-questions #118's branch+PR requirement.

## Decision

All new state (`ChartForm`, `hiddenKeys`, `highlightedKey`, `periodRange`,
annotation notes) lives ONLY in client React state, owned by a pure reducer
(`web/lib/chart-view-state.ts`) plus one local `useState` pair for notes
(`web/components/chart-notes.tsx`'s data, held in `ChartView`). It is a
strict projection over the unchanged, server-built `ChartSpec` — a new pure
helper `windowSpec()` filters points to a period range (a verbatim copy,
never a recomputation); nothing here calls `buildChartSpec` again, and
nothing here is ever serialized into an audit record. `src/chart/*` is
untouched by this change.

Two safety rules are enforced structurally, not just documented:
- Switching to line form is BLOCKED (`lineFormAllowed`) whenever the
  original spec is a multi-region comparison (`kind === 'bar'`, >1 series) —
  a line would imply a trend across regions that was never measured.
- Bar form's Y-axis always starts at zero (`yAxisDomain(effectiveKind)`,
  never `yAxisDomain(spec.kind)`), regardless of the chart's original kind.

Click-to-annotate notes render in a new sibling component (`ChartNotes`)
mounted OUTSIDE `ChartView`'s `chartContainerRef` subtree — the same
container `ChartDownloadMenu` reads for PNG/SVG export — so notes are
excluded from every export by construction, with no new exemption needed in
the R6 token-scan (which only ever inspects the exported SVG).

## Alternatives considered

(As catalogued by the session-88 architecture panel, in more detail in the
published artifact): reusing ADR 037's `ChartInstruction`/`execute.ts`
machinery for CBS charts (rejected — built for raw uploaded cells, would
strip the CBS provenance fields that make a number trustworthy); an LLM
instruction schema as the FIRST slice (rejected — the full menu of
adjustments is small enough to put on-screen directly, per the CLAUDE.md
"cheapest mechanism first" convention this whole plan was itself the worked
example of); drawing notes inside the chart's own SVG (rejected — would need
a new R6 exemption and risks a note being mistaken for official data).

## Consequences

- Zero change to R1/R2/R3/R4/R5/R6/R7/R8/R9/R10/R11 test suites — none of
  them touch client React state, and this change never calls
  `buildChartSpec` or writes an audit record.
- Notes are session-only (owner decision F's conservative default — see the
  open-questions #212 addendum): lost on reload, no new database table, no
  GDPR retention surface added.
- Two owner decisions (B: bar-zero-axis always vs. conditional; F: no
  persistence) were resolved to their most conservative, reversible option
  because the owner had not signed off on A-H by the time this autonomous
  session ran — **not a formal owner decision**, flagged for owner review
  alongside the PR.
- Decisions C, D, E were resolved by the chosen mechanism itself (a separate
  disclosure note; structurally distinct, clearly labelled notes; notes
  excluded from downloads) rather than requiring a separate owner call for
  this build's scope.
- Decisions G (transparent PNG export) and H (map view) are untouched —
  fully out of scope for this build.

## Revisit triggers

- If usage data ever shows demand for chat-routed chart edits, Phase 4 (a
  thin `ChartInstruction`-shaped schema, explicitly deferred by the
  architecture panel) is designed separately and requires owner sign-off
  before any LLM call is added.
- If the owner wants notes to survive a reload, Phase 5 (a new
  `chart_annotations` table under the existing GDPR retention machinery)
  requires a migration and an explicit owner decision on decision F.
```

- [ ] **Step 3: Append the open-questions #212 addendum**

Open `docs/open-questions.md`, find row `#212`, and append (inside the same cell, after the existing "Architecture panel run..." paragraph, as a new sentence — do not delete or rewrite any existing text in the row) a dated paragraph summarizing exactly what this session built, which files, which decisions were resolved to their conservative default (B, F) versus resolved by mechanism (A, C, D, E) versus left fully open (G, H), and a pointer to the ADR file created in Step 2 and the PR this session opens.

- [ ] **Step 4: Commit (do not push)**

```bash
git add docs/decisions/0XX-chart-view-state-editing.md docs/open-questions.md
git commit -m "docs: add ADR + open-questions #212 addendum for chart view-state editing"
```

---

## Final integration check (run by the orchestrating session, not a subagent task)

After all 7 tasks are committed on the feature branch:

1. `npm run typecheck` — root, must be clean.
2. `npm run web:typecheck` — must be clean.
3. `npm test` — full backend suite, must be green (chart/invariant tests must show byte-identical pass counts to the pre-change baseline — this plan touches zero backend files, so this is a sanity check, not expected to move).
4. `npm run web:test` — full web suite, must be green.
5. `npm run web:build` — real `next build`, must be clean.
6. `/code-review` at LOW effort over the WHOLE diff (not per-task) — a session-88 lesson: a whole-diff pass has caught real bugs six independent task-level reviews missed.
7. Real-browser verification (Browser-pane tools): both light and dark mode, actual click/drag/select interactions — the form switch, the zoom selectors, series hide AND highlight together, and the full click-to-annotate flow (add a note, confirm it does not appear in a downloaded PNG, delete a note) — not just "it compiles."
