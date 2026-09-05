# Chart Series Toggle and Small Multiples Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a viewer hide/show individual series via a real, accessible legend, and (for line charts only) switch to a small-multiples layout — one mini chart per series — with a shared/own axis choice, exactly per [docs/session-briefs/2026-09-05-chart-ideas-4-6-8-design.md](../../session-briefs/2026-09-05-chart-ideas-4-6-8-design.md) §1-2.

**Architecture:** Both features are pure `web/` presentation state inside `ChartView` (`web/components/chart.tsx`) — no `ChartSpec`/schema change, no flag, no backend touch. Task 1 replaces Recharts' decorative `<Legend>` with a custom interactive one and filters which `<Line>`/`<Bar>` elements render. Task 2 adds a new sibling component, `ChartSmallMultiples`, that reuses `chart.tsx`'s already-exported pure helpers (`buildRows`, `seriesStyle`, `yAxisDomain`) to render one mini chart per series, shown instead of the combined chart when toggled on.

**Tech Stack:** React 19 (`'use client'`), Recharts, Vitest + `@testing-library/react`, TypeScript with explicit `.ts`/`.tsx` import extensions (this repo's convention).

## Global Constraints

- English for all code/comments; Dutch for any UI copy (`CLAUDE.md` Conventions).
- No changes to `ChartSpec`, `src/chart/build.ts`, or `src/chart/schema.ts` in this plan — both features are `web/`-only (per the design doc, ADR 014's optional-field rule doesn't even apply here since nothing is added to the spec).
- Hidden-series and small-multiples state is client-side only, reset on every fresh `spec` (component mount) — never written to the stored spec or audit record ([open-questions #46](../../open-questions.md)(b)).
- Whenever ≥1 series is hidden, a visible "N van M reeksen verborgen" line must be shown, and it must also be baked into `ChartDownloadMenu`'s `attributionText` (open-questions #46(a)/(c) — already-decided constraints, not up for debate in this plan).
- Full verification block before any push (owner-present session, direct push to `main` per `CLAUDE.md`'s git-workflow section): `npx tsc --noEmit` (both root and `web/`), the backend test suite, the benchmark gate (14/14 answerable + 6/6 refusal + 0 fabricated), the full `web/` test suite, a real `next build`, and a LOW-effort `/code-review` pass over the diff before pushing.
- This repo imports local modules with explicit `.ts`/`.tsx` extensions — match that in every new import.

---

## File Structure

- **Modify:** `web/components/chart.tsx` — remove the Recharts `<Legend>` usage, add hidden-series state + custom legend + disclosure line + small-multiples toggle/state, wire `ChartSmallMultiples` in.
- **Modify:** `web/components/chart.test.tsx` — new `describe` blocks for both features.
- **Create:** `web/components/chart-small-multiples.tsx` — the new `ChartSmallMultiples` component (line charts only; see Task 2 for why bar/comparison is out of scope).
- **Create:** `web/components/chart-small-multiples.test.tsx` — its own test file.

---

## Task 1: Custom legend with hide/show per series

**Files:**
- Modify: `web/components/chart.tsx:32` (import), `:678` and `:735` (remove `<Legend />`), `:505-566` (state + handler), `:756` area (new JSX), `:793-799` (`ChartDownloadMenu` attribution text)
- Test: `web/components/chart.test.tsx`

**Interfaces:**
- Produces: no new exports — `SeriesLegend` is an internal function component, tested only through `ChartView` (same pattern as the existing internal `SeriesDot`/`SeriesBar`).
- Consumes: `SeriesMeta` (already defined, `chart.tsx:47-54`), `buildRows`'s existing return shape (unchanged).

- [ ] **Step 1: Write the failing test — legend renders one real button per series**

Add to `web/components/chart.test.tsx`, after the existing `describe('ChartView — #197 step 2, the Tabel view', ...)` block (end of file):

```tsx
describe('ChartView — series legend and hide/show (idea 6)', () => {
  beforeEach(() => vi.unstubAllGlobals());

  function twoSeriesSpec(overrides: Partial<ChartSpec> = {}): ChartSpec {
    return spec({
      series: [
        { label: 'Nederland', regionCode: 'NL01', points: [point({ resultId: 'nl', value: 1, formattedValue: '1,0' })] },
        { label: 'Utrecht', regionCode: 'GM0344', points: [point({ resultId: 'ut', value: 2, formattedValue: '2,0' })] },
      ],
      ...overrides,
    });
  }

  it('renders one real button per series, labelled by name, none hidden by default', () => {
    render(<ChartView spec={twoSeriesSpec()} />);
    const nl = screen.getByRole('button', { name: 'Nederland' });
    const ut = screen.getByRole('button', { name: 'Utrecht' });
    expect(nl).toHaveAttribute('aria-pressed', 'false');
    expect(ut).toHaveAttribute('aria-pressed', 'false');
  });

  it('does not render a legend at all for a single-series chart', () => {
    render(<ChartView spec={threePointSpec()} />);
    expect(screen.queryByRole('button', { name: 'Nederland' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run chart.test.tsx -t "series legend"`
Expected: FAIL — no button with name "Nederland"/"Utrecht" exists yet (today's `<Legend/>` renders Recharts' own uncontrolled markup, not a `role="button"`).

- [ ] **Step 3: Implement the custom legend and wire it in**

In `web/components/chart.tsx`, remove `Legend` from the `recharts` import at line 32 (it becomes unused once both usages below are replaced):

```tsx
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
```

Add a new component directly after `ChartTooltip` (after line 365, before the `SeriesDot` comment at line 367):

```tsx
/** #197 idea 6: a real interactive legend, replacing Recharts' decorative
 * default. One button per series toggles it in/out of the chart; hidden
 * series stay listed (dimmed) so they can be brought back. Client-side
 * presentation only — never touches the spec or the audit record
 * (open-questions #46(b)). */
function SeriesLegend({
  seriesMeta,
  hiddenKeys,
  onToggle,
}: {
  seriesMeta: SeriesMeta[];
  hiddenKeys: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div role="group" aria-label="Reeksen" className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
      {seriesMeta.map((s) => {
        const hidden = hiddenKeys.has(s.key);
        return (
          <button
            key={s.key}
            type="button"
            aria-pressed={hidden}
            onClick={() => onToggle(s.key)}
            className={
              'inline-flex min-h-6 items-center gap-1.5 rounded px-1 text-xs ' +
              (hidden ? 'text-ink-muted line-through' : 'text-ink')
            }
          >
            <span
              aria-hidden="true"
              style={{ backgroundColor: hidden ? 'var(--ink-muted)' : s.color }}
              className="inline-block h-2.5 w-2.5 rounded-full"
            />
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
```

In `ChartView` (starts line 505), add state right after the existing `view` state (after line 515's `tableTabRef` declaration):

```tsx
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());

  function toggleSeries(key: string): void {
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
```

(This mirrors the existing `view` state's own reset behaviour exactly — both are `useState` initializers that run once per mount; a new chart is a new `ChartView` instance, so this needs no explicit reset effect, consistent with how `view` already works.)

Remove the two `<Legend />` lines: `chart.tsx:678` (`{seriesMeta.length > 1 ? <Legend /> : null}` in the line-chart branch) and `chart.tsx:735` (the identical line in the bar-chart branch) — delete both, no replacement at that location.

Change the `<Line>` mapping (line 694) from `{seriesMeta.map((s) => (` to filter hidden series first:

```tsx
              {seriesMeta
                .filter((s) => !hiddenKeys.has(s.key))
                .map((s) => (
                  <Line
                    key={s.key}
                    type="linear"
                    dataKey={s.key}
                    name={s.label}
                    stroke={s.color}
                    strokeWidth={2}
                    strokeDasharray={s.dasharray}
                    connectNulls={false}
                    dot={SeriesDot(s.key, endLabelByKey.get(s.key))}
                    isAnimationActive={false}
                  />
                ))}
```

Do the identical filter on the `<Bar>` mapping (line 736):

```tsx
              {seriesMeta
                .filter((s) => !hiddenKeys.has(s.key))
                .map((s) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    name={s.label}
                    fill={s.color}
                    isAnimationActive={false}
                    shape={SeriesBar(
                      s.key,
                      s.color,
                      `hatch-${domId}-${s.key}`,
                      barLabelsByKey.get(s.key) ?? new Map<string, PointLabel>(),
                    )}
                  />
                ))}
```

**Known, accepted limitation (state this in a code comment, don't silently leave it undocumented):** the y-axis min/max ticks (`plan.axisTicks`, from `valueLabelPlan(spec)`) are computed once from the FULL spec and do not recompute when a series is hidden — if the hidden series happened to hold the global min or max, that axis tick can outlive its own line. Add this comment directly above the `<YAxis ... ticks={plan.axisTicks...}` line (line 670) in the line-chart branch:

```tsx
              {/* #197 idea 6: axis ticks come from the full spec (valueLabelPlan
                * doesn't know about hiddenKeys) and are NOT recomputed when a
                * series is hidden — an accepted v1 limitation, not a bug: the
                * Tabel view and the un-hidden chart remain the source of exact
                * values. */}
              <YAxis
```

Add the legend + disclosure line to the JSX. Insert this new block immediately after the closing `)}` of the `view === 'table' ? (...) : (...)` ternary (line 755), before the existing `{spec.provisionalNote ? ...}` block (line 756+):

```tsx
      {view === 'chart' && seriesMeta.length > 1 ? (
        <>
          <SeriesLegend seriesMeta={seriesMeta} hiddenKeys={hiddenKeys} onToggle={toggleSeries} />
          {hiddenKeys.size > 0 ? (
            <p className="mt-1 text-xs text-ink-muted">
              {hiddenKeys.size} van {seriesMeta.length} reeksen verborgen
            </p>
          ) : null}
        </>
      ) : null}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run chart.test.tsx -t "series legend"`
Expected: PASS (both new tests).

- [ ] **Step 5: Commit**

```bash
git add web/components/chart.tsx web/components/chart.test.tsx
git commit -m "feat(chart): custom interactive legend, series still all shown

Recharts' decorative <Legend/> replaced with real buttons (accessible
name, aria-pressed) as prep for click-to-hide. No behavior change yet:
clicking does nothing until the next commit wires hiddenKeys through.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Write the failing test — clicking hides the series and shows the disclosure**

Add to the same `describe` block from Step 1:

```tsx
  it('clicking a legend button hides that series\' point and shows the disclosure count', () => {
    const { container } = render(<ChartView spec={twoSeriesSpec()} />);
    // Bound to resultId, not a Recharts internal class name — same convention
    // every other test in this file uses (data-point/data-result-id from SeriesDot).
    expect(container.querySelector('svg [data-point="value"][data-result-id="ut"]')).not.toBeNull();
    expect(container.querySelector('svg [data-point="value"][data-result-id="nl"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Utrecht' }));
    expect(container.querySelector('svg [data-point="value"][data-result-id="ut"]')).toBeNull();
    expect(container.querySelector('svg [data-point="value"][data-result-id="nl"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Utrecht' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('1 van 2 reeksen verborgen')).toBeInTheDocument();
  });

  it('clicking a hidden series again restores it and clears the disclosure', () => {
    render(<ChartView spec={twoSeriesSpec()} />);
    const utrecht = screen.getByRole('button', { name: 'Utrecht' });
    fireEvent.click(utrecht);
    fireEvent.click(utrecht);
    expect(utrecht).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText(/reeksen verborgen/)).toBeNull();
  });
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `cd web && npx vitest run chart.test.tsx -t "clicking a legend button"`
Expected: FAIL on the second assertion (`data-result-id="ut"` still present after the click) — Step 3 already implemented the filter, but Step 1/2's tests never exercised a click, so this is the first test to actually prove it works end-to-end. If Step 3's filter has a bug, this is where it surfaces.

- [ ] **Step 8: Run the test to verify it passes, then commit**

Run: `cd web && npx vitest run chart.test.tsx -t "series legend"`
Expected: PASS (all four tests in the block).

```bash
git add web/components/chart.test.tsx
git commit -m "test(chart): pin hide/show-series click behavior and disclosure line

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 9: Write the failing test — the export attribution text includes the disclosure**

Add to the same `describe` block:

```tsx
  it('bakes the hidden-series disclosure into the export attribution text, matching #46(c)\'s decided default', async () => {
    // Same URL-API stubbing pattern chart-download.test.tsx already uses,
    // but capturing the actual Blob passed to createObjectURL so we can read
    // back the baked SVG markup (attributedSvgMarkup writes attributionText
    // into it) instead of just checking a download was attempted.
    let capturedBlob: Blob | undefined;
    (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn((blob: Blob) => {
      capturedBlob = blob;
      return 'blob:mock';
    });
    (URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn();

    render(<ChartView spec={twoSeriesSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Utrecht' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download als SVG' }));

    expect(capturedBlob).toBeDefined();
    const markup = await capturedBlob!.text();
    expect(markup).toContain('1 van 2 reeksen verborgen');

    delete (URL as unknown as Record<string, unknown>).createObjectURL;
    delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
  });
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `cd web && npx vitest run chart.test.tsx -t "bakes the hidden-series disclosure"`
Expected: FAIL — `attributionText` today is always `${spec.attributionLine} checkdecijfers.nl` regardless of hidden state.

- [ ] **Step 11: Implement — thread the disclosure into the download attribution text**

In `ChartView`, near the other derived consts (after `accessibleName` at line 559), add:

```tsx
  const hiddenDisclosure =
    hiddenKeys.size > 0 ? ` ${hiddenKeys.size} van ${seriesMeta.length} reeksen verborgen.` : '';
```

Change the `ChartDownloadMenu` call (lines 793-799):

```tsx
        {view === 'chart' ? (
          <ChartDownloadMenu
            containerRef={chartContainerRef}
            attributionText={`${spec.attributionLine} checkdecijfers.nl${hiddenDisclosure}`}
            filenameBase={`checkdecijfers-${spec.attribution.tableId}`}
          />
        ) : null}
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `cd web && npx vitest run chart.test.tsx -t "series legend"`
Expected: PASS (all tests in the block, five total).

- [ ] **Step 13: Run the full web suite, then commit**

Run: `cd web && npx vitest run`
Expected: all existing tests still pass (no regressions in the Grafiek/Tabel, tooltip, or #197-step-1 tests, which don't touch hidden state).

```bash
git add web/components/chart.tsx web/components/chart.test.tsx
git commit -m "feat(chart): bake hidden-series disclosure into export attribution

Completes idea 6 (open-questions #197/#46): hiding a series via the new
legend now also appears in the downloaded image's footer text, matching
#46(c)'s already-decided default (export bakes in what's on screen).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Small multiples (line charts only, manual toggle)

**Why line charts only:** a comparison/bar chart already plots one bar per region for a single period (`tableModel`'s bar branch already treats it as "one row per region"). Splitting that into one mini chart per series would give each panel exactly one bar — no comparative value. This is a deliberate scope decision, not an oversight: the "Kleine grafieken" toggle only appears when `spec.kind === 'line'`.

**Files:**
- Create: `web/components/chart-small-multiples.tsx`
- Create: `web/components/chart-small-multiples.test.tsx`
- Modify: `web/components/chart.tsx` (toggle state + buttons + conditional render)

**Interfaces:**
- Produces: `ChartSmallMultiples({ spec, hiddenKeys, axisMode }: { spec: ChartSpec; hiddenKeys: Set<string>; axisMode: 'shared' | 'own' }): JSX.Element` — exported from `chart-small-multiples.tsx`.
- Consumes from Task 1 / existing `chart.tsx` exports: `buildRows(spec): { rows: Row[]; seriesMeta: SeriesMeta[] }`, `seriesStyle(index): { color: string; dasharray: string | undefined }`, `yAxisDomain(kind): [0 | 'auto', 'auto']`, the `Row`/`SeriesMeta` types, and the `hiddenKeys: Set<string>` state added in Task 1.

- [ ] **Step 1: Write the failing test — one mini chart per visible series**

Create `web/components/chart-small-multiples.test.tsx`:

```tsx
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartSpec } from '../backend/chart/types.ts';
import { ChartSmallMultiples } from './chart-small-multiples.tsx';

afterEach(cleanup);

function point(overrides: Partial<ChartSpec['series'][0]['points'][0]> = {}) {
  return {
    resultId: 'r1',
    periodCode: '2024JJ00',
    periodLabel: '2024',
    value: 42,
    formattedValue: '42,0',
    decimals: 1,
    status: 'Definitief',
    provisional: false,
    valueAttribute: 'None',
    ...overrides,
  };
}

function spec(overrides: Partial<ChartSpec> = {}): ChartSpec {
  return {
    schemaVersion: 1,
    kind: 'line',
    title: 'Testreeks',
    dims: { Kenmerk: '000000' },
    dimLabels: { Kenmerk: 'Alle kenmerken' },
    unit: '%',
    series: [{ label: 'Nederland', regionCode: 'NL01', points: [point()] }],
    provisionalNote: null,
    nullNotes: [],
    definitionLine: null,
    attributionLine: 'Bron: CBS StatLine, tabel 12345NED.',
    attribution: {
      tableId: '12345NED',
      tableTitle: 'Test',
      tableVersion: 1,
      syncedAt: '2026-07-01',
      coveredPeriods: { from: '2020', to: '2024' },
      license: 'CC BY 4.0',
    },
    ...overrides,
  };
}

function threeSeriesSpec(): ChartSpec {
  return spec({
    series: [
      { label: 'Nederland', regionCode: 'NL01', points: [point({ resultId: 'nl', value: 1, formattedValue: '1,0' })] },
      { label: 'Utrecht', regionCode: 'GM0344', points: [point({ resultId: 'ut', value: 2, formattedValue: '2,0' })] },
      { label: 'Amsterdam', regionCode: 'GM0363', points: [point({ resultId: 'ams', value: 3, formattedValue: '3,0' })] },
    ],
  });
}

describe('ChartSmallMultiples', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('renders one titled panel per series, in spec order', () => {
    const { container } = render(
      <ChartSmallMultiples spec={threeSeriesSpec()} hiddenKeys={new Set()} axisMode="shared" />,
    );
    const panels = container.querySelectorAll('[data-panel-for]');
    expect(panels.length).toBe(3);
    expect(panels[0].getAttribute('data-panel-for')).toBe('s0');
    expect(container.textContent).toContain('Nederland');
    expect(container.textContent).toContain('Utrecht');
    expect(container.textContent).toContain('Amsterdam');
  });

  it('omits a panel for a hidden series', () => {
    const { container } = render(
      <ChartSmallMultiples spec={threeSeriesSpec()} hiddenKeys={new Set(['s1'])} axisMode="shared" />,
    );
    expect(container.querySelectorAll('[data-panel-for]').length).toBe(2);
    expect(container.textContent).not.toContain('Utrecht');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run chart-small-multiples.test.tsx`
Expected: FAIL — `chart-small-multiples.tsx` does not exist yet (module not found).

- [ ] **Step 3: Implement `ChartSmallMultiples`**

Create `web/components/chart-small-multiples.tsx`:

```tsx
// #197 idea 8: small multiples — one mini line chart per series instead of
// one shared chart, the honest alternative to a crowded/misleading shared
// axis. Line charts only (see the plan's Task 2 header for why bar charts
// are out of scope). Reuses chart.tsx's own pure spec-only helpers so the
// plotted values are identical to the combined view, never re-derived.
'use client';

import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import type { ChartSpec } from '../backend/chart/types.ts';
import { buildRows, yAxisDomain } from './chart.tsx';

function sharedLineDomain(spec: ChartSpec, visibleIndexes: number[]): [number, number] | undefined {
  let min = Infinity;
  let max = -Infinity;
  for (const i of visibleIndexes) {
    for (const point of spec.series[i].points) {
      if (point.value === null) continue;
      if ((point.value as number) < min) min = point.value as number;
      if ((point.value as number) > max) max = point.value as number;
    }
  }
  if (min === Infinity) return undefined;
  return [min, max];
}

export function ChartSmallMultiples({
  spec,
  hiddenKeys,
  axisMode,
}: {
  spec: ChartSpec;
  hiddenKeys: Set<string>;
  axisMode: 'shared' | 'own';
}) {
  const { rows, seriesMeta } = buildRows(spec);
  const visible = seriesMeta.map((s, i) => ({ s, i })).filter(({ s }) => !hiddenKeys.has(s.key));
  const domain = axisMode === 'shared' ? sharedLineDomain(spec, visible.map(({ i }) => i)) : undefined;

  return (
    <div role="group" aria-label="Kleine grafieken per reeks" className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {visible.map(({ s }) => (
        <div key={s.key} className="rounded border border-line p-1">
          <div className="truncate text-xs text-ink-soft" title={s.label}>
            {s.label}
          </div>
          <div className="h-24 w-full" data-panel-for={s.key}>
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 200, height: 96 }}>
              <LineChart data={rows} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="periodLabel" tick={false} />
                <YAxis tick={false} width={0} domain={domain ?? yAxisDomain(spec.kind)} />
                <Line
                  type="linear"
                  dataKey={s.key}
                  stroke={s.color}
                  strokeWidth={2}
                  strokeDasharray={s.dasharray}
                  connectNulls={false}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run chart-small-multiples.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add web/components/chart-small-multiples.tsx web/components/chart-small-multiples.test.tsx
git commit -m "feat(chart): add ChartSmallMultiples component (not yet wired in)

One mini line chart per series, reusing chart.tsx's own buildRows/
yAxisDomain so plotted values match the combined view exactly (colour/
dasharray come from buildRows' own SeriesMeta, no separate lookup).
Standalone and unused by ChartView until the next commit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Write the failing test — the toggle appears only for multi-series line charts and swaps the view**

Add to `web/components/chart.test.tsx`, in a new `describe` block after Task 1's block:

```tsx
describe('ChartView — small multiples toggle (idea 8)', () => {
  beforeEach(() => vi.unstubAllGlobals());

  function twoSeriesSpec(overrides: Partial<ChartSpec> = {}): ChartSpec {
    return spec({
      series: [
        { label: 'Nederland', regionCode: 'NL01', points: [point({ resultId: 'nl', value: 1, formattedValue: '1,0' })] },
        { label: 'Utrecht', regionCode: 'GM0344', points: [point({ resultId: 'ut', value: 2, formattedValue: '2,0' })] },
      ],
      ...overrides,
    });
  }

  it('offers no small-multiples toggle for a single-series chart', () => {
    render(<ChartView spec={threePointSpec()} />);
    expect(screen.queryByRole('button', { name: 'Kleine grafieken' })).toBeNull();
  });

  it('offers no small-multiples toggle for a bar/comparison chart', () => {
    const s = twoSeriesSpec({ kind: 'bar' });
    render(<ChartView spec={s} />);
    expect(screen.queryByRole('button', { name: 'Kleine grafieken' })).toBeNull();
  });

  it('switches to one panel per series when toggled on, and shows the axis-mode switch only then', () => {
    const { container } = render(<ChartView spec={twoSeriesSpec()} />);
    expect(screen.queryByRole('group', { name: 'Gelijke assen of eigen assen' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Kleine grafieken' }));
    // Two panels, each its own small chart — proves the switch happened.
    // (Not asserting "no SVG at all": ChartSmallMultiples' own mini charts
    // are ALSO Recharts SVGs with the same .recharts-surface class as the
    // combined view, so that would be a false signal either way. The
    // ChartView JSX renders ChartSmallMultiples OR the combined
    // ResponsiveContainer, never both — the panel count already proves which
    // branch is active.)
    expect(container.querySelectorAll('[data-panel-for]').length).toBe(2);
    expect(screen.getByRole('group', { name: 'Gelijke assen of eigen assen' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `cd web && npx vitest run chart.test.tsx -t "small multiples toggle"`
Expected: FAIL — no "Kleine grafieken" button exists yet.

- [ ] **Step 8: Implement — wire the toggle and `ChartSmallMultiples` into `ChartView`**

In `web/components/chart.tsx`, add the import (alongside the other local component imports near line 42):

```tsx
import { ChartSmallMultiples } from './chart-small-multiples.tsx';
```

Add state next to `hiddenKeys` (from Task 1):

```tsx
  const [smallMultiples, setSmallMultiples] = useState(false);
  const [axisMode, setAxisMode] = useState<'shared' | 'own'>('shared');
```

Add a derived flag near the other derived consts (after `accessibleName`):

```tsx
  const smallMultiplesAvailable = spec.kind === 'line' && seriesMeta.length > 1;
```

Replace the chart branch of the `view === 'table' ? (...) : (...)` ternary so it renders `ChartSmallMultiples` when active. The table branch (lines 617-648) is unchanged; only the `else` branch (lines 649-755) changes. The tabpanel wrapper div and its attributes stay identical — only what's inside changes when `smallMultiples` is true:

```tsx
      ) : (
      /* touch-pan-y: the tooltip's press-and-drag must not fight vertical
       * page scrolling on a phone. */
      <div
        id={panelId}
        role="tabpanel"
        aria-label="Grafiek"
        ref={chartContainerRef}
        className="mt-2 h-64 w-full touch-pan-y"
        data-tooltip-trigger={tooltipTrigger}
      >
        {smallMultiples && smallMultiplesAvailable ? (
          <ChartSmallMultiples spec={spec} hiddenKeys={hiddenKeys} axisMode={axisMode} />
        ) : (
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height: 256 }}>
          {spec.kind === 'line' ? (
```

...and close that new conditional right before the existing `</ResponsiveContainer>` closing tag (immediately after the `)}` that currently closes the `spec.kind === 'line' ? (...) : (...)` chart-vs-bar ternary, just before `</ResponsiveContainer>`):

```tsx
        </ResponsiveContainer>
        )}
      </div>
      )}
```

Add the toggle buttons in the shared legend/disclosure block from Task 1 (extend it, don't duplicate it) — replace the block Task 1 added after the view ternary with:

```tsx
      {view === 'chart' && seriesMeta.length > 1 ? (
        <>
          <SeriesLegend seriesMeta={seriesMeta} hiddenKeys={hiddenKeys} onToggle={toggleSeries} />
          {hiddenKeys.size > 0 ? (
            <p className="mt-1 text-xs text-ink-muted">
              {hiddenKeys.size} van {seriesMeta.length} reeksen verborgen
            </p>
          ) : null}
        </>
      ) : null}
      {view === 'chart' && smallMultiplesAvailable ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            aria-pressed={smallMultiples}
            onClick={() => setSmallMultiples((v) => !v)}
            className={tabClass(smallMultiples)}
          >
            Kleine grafieken
          </button>
          {smallMultiples ? (
            <div role="group" aria-label="Gelijke assen of eigen assen" className="flex gap-2">
              <button
                type="button"
                aria-pressed={axisMode === 'shared'}
                onClick={() => setAxisMode('shared')}
                className={tabClass(axisMode === 'shared')}
              >
                Gelijke assen
              </button>
              <button
                type="button"
                aria-pressed={axisMode === 'own'}
                onClick={() => setAxisMode('own')}
                className={tabClass(axisMode === 'own')}
              >
                Eigen assen
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
```

(`tabClass` is the existing helper defined at `chart.tsx:576-578` — reused as-is, not redefined.)

- [ ] **Step 9: Run the test to verify it passes**

Run: `cd web && npx vitest run chart.test.tsx -t "small multiples toggle"`
Expected: PASS (all three tests).

- [ ] **Step 10: Run the full web suite**

Run: `cd web && npx vitest run`
Expected: all tests pass, including every Task 1 test and every pre-existing test — small multiples defaults to off, so nothing already-shipped changes behavior.

- [ ] **Step 11: Commit**

```bash
git add web/components/chart.tsx web/components/chart.test.tsx
git commit -m "feat(chart): wire small multiples toggle into ChartView

Manual toggle (idea 8), line charts with 2+ series only. Off by default,
byte-identical to today when unused. Interacts with idea 6: a hidden
series has no panel here either.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 12: Full verification block, then push**

Run, in order, stopping to fix anything red before continuing:

```bash
npx tsc --noEmit
cd web && npx tsc --noEmit && cd ..
npm test
npm run benchmark:run && npm run benchmark:score
cd web && npx vitest run && cd ..
cd web && npx next build && cd ..
```

Then run a LOW-effort `/code-review` pass over the full diff (`git diff main -- web/components/chart.tsx web/components/chart-small-multiples.tsx web/components/chart-small-multiples.test.tsx web/components/chart.test.tsx`) and fix or consciously address every confirmed finding before pushing — required by `CLAUDE.md`'s verification block for every code push, not optional.

Then update `docs/open-questions.md` row `#197` (mark ideas 6 and 8 built, mirroring how ideas 1-3 were recorded) and row `#46` (idea 6 is no longer "unscheduled") in the same push, per `CLAUDE.md`'s definition-of-done point 3.
