# Story mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A colourful "Story mode" button on every CBS chart that opens a story panel under the chart — short steps built by code from the chart's own numbers, each highlighting a point or series while the reader scrolls or presses Next.

**Architecture:** A pure step builder (`web/lib/chart-story.ts`) turns the displayed `ChartSpec` into `StoryStep[]` (no React, no new numbers — every digit in a caption is a spec string). A controlled panel component (`web/components/chart-story.tsx`) renders the steps, drives an index by scroll (IntersectionObserver) or buttons, and reports it up. `ChartView` (`web/components/chart.tsx`) owns the open/index state exactly like the Style panel, dispatches the existing reducer's highlight action per step, draws a ring around the step's point, and snapshots/restores the reader's own view around the story. Spec: `docs/superpowers/specs/2026-09-09-story-mode-and-embed-design.md` Part A.

**Tech Stack:** Next.js 15 / React 19, Recharts, shadcn `Button` (Base UI), lucide-react (`WandSparkles`), vitest + Testing Library (jsdom), the typed message catalogue `web/lib/i18n/messages.ts`.

## Global Constraints

- **Honesty (docs/05 R1/R3/R6/R10/R11):** every digit token rendered inside the chart card must be a substring of one of the spec's own strings (`formattedValue`, `periodLabel`, `unit`, series labels, `attributionLine`, `title`, `trendHeadline`, the notes). Captions therefore contain only those strings verbatim. No "step 3 of 6" text. The story ring never removes or covers the hollow provisional marker (it is drawn OUTSIDE it, `r + 5`) and never carries `data-point`.
- **No LLM call, no schema change, no spend.** The counter events ride the existing `chart_style_usage` table (migration 028, file-only until the owner applies it — the sink is a no-op until then).
- **Language:** every new interface string gets an `nl` AND an `en` entry in `web/lib/i18n/messages.ts`; the Dutch entry is the default. No digits in any new message value (the catalogue test forbids en digits the nl lacks; we add none at all).
- **House ARIA pattern:** hand-rolled `role="region"`, `aria-expanded`/`aria-controls` on the trigger, Escape closes and refocuses the trigger — exactly like `ChartConfigTrigger`/`ChartConfigPanel`.
- **Placement rule (ADR 038/039):** the panel mounts OUTSIDE the `chartContainerRef` export container so nothing of it can enter a PNG/SVG download.
- **One open panel:** Style and Story share the slot under the chart; opening one closes the other.
- **Owner decision E:** a spec swap on the same mounted `ChartView` closes the story and resets its index (the existing spec-swap block).
- **Commands:** run web tests from `web/` with `npx vitest run <file>`; typecheck with `npx tsc --noEmit -p web` from the repo root (and `npx tsc --noEmit` at the root for `src/`). Commit after every task with the `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer.
- **The story is offered only when `buildStorySteps` returns at least 3 steps** (overview + one real step + explore), never in table form, never while small multiples is on.
- **Zoom is NOT used in v1** (deviation from spec A2/A3's "zoom to the step's period window", recorded in Task 4's docs): point steps mark the point on the full chart; the reader's own zoom/hidden/highlight state is snapshotted on open and restored on close.

---

## File map

- Create `web/lib/chart-story.ts` — pure: `StoryStep`, `buildStorySteps(spec, lang)`.
- Create `web/lib/chart-story.test.ts` — the builder's rules incl. the digit rule.
- Modify `web/lib/i18n/messages.ts` — the `chart.story.*` keys (nl block after `'chart.panel.regionLabel'` line 394; en block after line 791).
- Modify `web/lib/chart-view-state.ts` — one new action `setView` (restore three fields atomically).
- Modify `web/lib/chart-view-state.test.ts` — pin `setView`.
- Create `web/components/chart-story.tsx` — `ChartStoryTrigger`, `ChartStoryPanel` (controlled).
- Create `web/components/chart-story.test.tsx` — panel behaviour + digit scan.
- Modify `web/components/chart.tsx` — `openPanel` state, trigger in the tab row, panel mount, per-step highlight, the ring in `SeriesDot`, snapshot/restore, spec-swap reset, counter events.
- Modify `web/components/chart.test.tsx` — integration pins.
- Modify `src/chart/user-styles.ts` — two counter events.
- Modify `tests/chart/user-styles.test.ts` — the new events are accepted.
- Modify docs: `docs/decisions/039-chart-presentation-panel.md` (addendum), `docs/open-questions.md` (new row: the R6 "highest/lowest" assumption), `docs/12-huisstijl.md` (the ring), `docs/03-mvp-scope.md`, `docs/04-architecture.md` (capability row), the spec (zoom deviation).

---

### Task 1: The pure step builder + its message keys

**Files:**
- Create: `web/lib/chart-story.ts`
- Create: `web/lib/chart-story.test.ts`
- Modify: `web/lib/i18n/messages.ts:394` (nl) and `:791` (en)

**Interfaces:**
- Consumes: `ChartSpec` (`web/backend/chart/types.ts`), `t`/`Lang`/`MessageKey` (`web/lib/i18n/messages.ts`).
- Produces: `export type StoryStepKind`, `export interface StoryStep { id: string; kind: StoryStepKind; title: string; caption: string; highlight: string | null; point: { seriesKey: string; periodCode: string } | null }`, `export function buildStorySteps(spec: ChartSpec, lang: Lang): StoryStep[]`, `export const STORY_MAX_SERIES_STEPS = 5`. Series keys are positional: `'s' + index` (the same keys `buildRows` in chart.tsx assigns — `s0`, `s1`, …).

- [ ] **Step 1: Add the message keys (both languages)**

In `web/lib/i18n/messages.ts`, directly after the line `'chart.panel.regionLabel': 'Opmaak van de grafiek',` (nl block) insert:

```ts
  // Story mode (session 92 design, spec 2026-09-09-story-mode-and-embed-design.md
  // Part A). Digit-free by construction: every number a caption shows is a
  // spec string filled into a placeholder, never part of the template.
  'chart.story.trigger': 'Verhaal',
  'chart.story.regionLabel': 'Verhaal bij de grafiek',
  'chart.story.hint': 'Scroll of gebruik de pijlen',
  'chart.story.prev': 'Vorige',
  'chart.story.next': 'Volgende',
  'chart.story.close': 'Sluiten',
  'chart.story.stepsLabel': 'Stappen',
  'chart.story.overviewTitle': 'Overzicht',
  'chart.story.overviewCaption': 'Van {from} tot {to}.',
  'chart.story.overviewSeriesCaption': 'Meerdere reeksen; het verhaal loopt ze één voor één langs.',
  'chart.story.moreSeries': 'Niet elke reeks krijgt een eigen stap.',
  'chart.story.compareCaption': 'Eén staaf per regio; hierna de hoogste en de laagste.',
  'chart.story.startTitle': 'Begin',
  'chart.story.highTitle': 'Hoogste punt',
  'chart.story.lowTitle': 'Laagste punt',
  'chart.story.latestTitle': 'Meest recent',
  'chart.story.pointCaption': '{period}: {value} {unit}',
  'chart.story.seriesCaption': '{fromPeriod}: {fromValue} → {toPeriod}: {toValue} {unit}',
  'chart.story.barCaption': '{label}: {value} {unit}',
  'chart.story.provisional': ' (voorlopig cijfer)',
  'chart.story.exploreTitle': 'Verken zelf',
  'chart.story.exploreCaption': 'Wissel van weergave met de tabs, kies een periode met Vanaf en Tot, of pas de opmaak aan.',
```

Directly after the line `'chart.panel.regionLabel': 'Chart style',` (en block) insert:

```ts
  'chart.story.trigger': 'Story mode',
  'chart.story.regionLabel': 'Story for this chart',
  'chart.story.hint': 'Scroll or use the arrows',
  'chart.story.prev': 'Previous',
  'chart.story.next': 'Next',
  'chart.story.close': 'Close',
  'chart.story.stepsLabel': 'Steps',
  'chart.story.overviewTitle': 'Overview',
  'chart.story.overviewCaption': 'From {from} to {to}.',
  'chart.story.overviewSeriesCaption': 'Several series; the story walks through them one by one.',
  'chart.story.moreSeries': 'Not every series gets its own step.',
  'chart.story.compareCaption': 'One bar per region; the highest and the lowest follow.',
  'chart.story.startTitle': 'Start',
  'chart.story.highTitle': 'Highest point',
  'chart.story.lowTitle': 'Lowest point',
  'chart.story.latestTitle': 'Latest',
  'chart.story.pointCaption': '{period}: {value} {unit}',
  'chart.story.seriesCaption': '{fromPeriod}: {fromValue} → {toPeriod}: {toValue} {unit}',
  'chart.story.barCaption': '{label}: {value} {unit}',
  'chart.story.provisional': ' (provisional figure)',
  'chart.story.exploreTitle': 'Explore yourself',
  'chart.story.exploreCaption': 'Switch the view with the tabs, pick a period with From and To, or change the style.',
```

Run: `cd web && npx vitest run lib/i18n/messages.test.ts`
Expected: PASS (key parity + no-digit rules hold).

- [ ] **Step 2: Write the failing builder tests**

Create `web/lib/chart-story.test.ts`:

```ts
// Story mode (session 92): the step builder is pure and honesty-bound —
// every digit in a caption is a substring of one of the spec's own strings
// (R1/R3/R6), highest/lowest are SELECTIONS over spec values (never a new
// number), and a chart with nothing to tell yields no steps (no trigger).
import { describe, expect, it } from 'vitest';
import type { ChartSpec } from '../backend/chart/types.ts';
import { buildStorySteps, STORY_MAX_SERIES_STEPS } from './chart-story.ts';

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

function fourPointSpec(overrides: Partial<ChartSpec> = {}): ChartSpec {
  return spec({
    series: [
      {
        label: 'Nederland',
        regionCode: 'NL01',
        points: [
          point({ resultId: 'a', periodCode: '2021JJ00', periodLabel: '2021', value: 2, formattedValue: '2,0' }),
          point({ resultId: 'b', periodCode: '2022JJ00', periodLabel: '2022', value: 3.5, formattedValue: '3,5' }),
          point({ resultId: 'c', periodCode: '2023JJ00', periodLabel: '2023', value: 1.5, formattedValue: '1,5' }),
          point({ resultId: 'd', periodCode: '2024JJ00', periodLabel: '2024', value: 2.5, formattedValue: '2,5', provisional: true, status: 'Voorlopig' }),
        ],
      },
    ],
    ...overrides,
  });
}

function specStrings(s: ChartSpec): string[] {
  return [
    s.title,
    s.unit,
    s.attribution.trendHeadline ?? '',
    ...s.series.map((se) => se.label),
    ...s.series.flatMap((se) => se.points.flatMap((p) => [p.formattedValue ?? '', p.periodLabel])),
  ].filter(Boolean);
}

function expectDigitsBound(s: ChartSpec, lang: 'nl' | 'en'): void {
  const strings = specStrings(s);
  for (const step of buildStorySteps(s, lang)) {
    const tokens = `${step.title} ${step.caption}`.match(/\d[\d.,]*/g) ?? [];
    for (const tok of tokens) {
      expect(strings.some((str) => str.includes(tok)), `token "${tok}" in "${step.caption}" is not a spec string`).toBe(true);
    }
  }
}

describe('buildStorySteps — a single time series', () => {
  it('tells overview, start, highest, lowest, latest, explore in that order with the points\' own strings', () => {
    const steps = buildStorySteps(fourPointSpec(), 'nl');
    expect(steps.map((s) => s.kind)).toEqual(['overview', 'start', 'high', 'low', 'latest', 'explore']);
    expect(steps[0]).toMatchObject({ title: 'Overzicht', caption: 'Van 2021 tot 2024.', highlight: null, point: null });
    expect(steps[1]).toMatchObject({ title: 'Begin', caption: '2021: 2,0 %', point: { seriesKey: 's0', periodCode: '2021JJ00' } });
    expect(steps[2]).toMatchObject({ title: 'Hoogste punt', caption: '2022: 3,5 %', point: { seriesKey: 's0', periodCode: '2022JJ00' } });
    expect(steps[3]).toMatchObject({ title: 'Laagste punt', caption: '2023: 1,5 %', point: { seriesKey: 's0', periodCode: '2023JJ00' } });
    expect(steps[4]).toMatchObject({ title: 'Meest recent', caption: '2024: 2,5 % (voorlopig cijfer)', point: { seriesKey: 's0', periodCode: '2024JJ00' } });
    expect(steps[5]).toMatchObject({ kind: 'explore', highlight: null, point: null });
    expect(steps.every((s) => s.highlight === null)).toBe(true);
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
  });

  it('uses the trend headline as the overview caption when the spec carries one', () => {
    const s = fourPointSpec({ attribution: { ...fourPointSpec().attribution, trendHeadline: 'Testreeks steeg sinds 2021.' } });
    expect(buildStorySteps(s, 'nl')[0]?.caption).toBe('Testreeks steeg sinds 2021.');
    expect(buildStorySteps(s, 'en')[0]?.caption).toBe('Testreeks steeg sinds 2021.');
  });

  it('drops highest/lowest when they coincide with start or latest (no duplicate steps)', () => {
    const rising = spec({
      series: [
        {
          label: 'Nederland',
          regionCode: 'NL01',
          points: [
            point({ resultId: 'a', periodCode: '2022JJ00', periodLabel: '2022', value: 1, formattedValue: '1,0' }),
            point({ resultId: 'b', periodCode: '2023JJ00', periodLabel: '2023', value: 2, formattedValue: '2,0' }),
            point({ resultId: 'c', periodCode: '2024JJ00', periodLabel: '2024', value: 3, formattedValue: '3,0' }),
          ],
        },
      ],
    });
    expect(buildStorySteps(rising, 'nl').map((s) => s.kind)).toEqual(['overview', 'start', 'latest', 'explore']);
  });

  it('skips null points and breaks ties towards the earliest period', () => {
    const s = spec({
      series: [
        {
          label: 'Nederland',
          regionCode: 'NL01',
          points: [
            point({ resultId: 'a', periodCode: '2021JJ00', periodLabel: '2021', value: null, formattedValue: null, valueAttribute: 'Geheim' }),
            point({ resultId: 'b', periodCode: '2022JJ00', periodLabel: '2022', value: 5, formattedValue: '5,0' }),
            point({ resultId: 'c', periodCode: '2023JJ00', periodLabel: '2023', value: 5, formattedValue: '5,0' }),
            point({ resultId: 'd', periodCode: '2024JJ00', periodLabel: '2024', value: 1, formattedValue: '1,0' }),
          ],
        },
      ],
    });
    const steps = buildStorySteps(s, 'nl');
    expect(steps.map((k) => k.kind)).toEqual(['overview', 'start', 'latest', 'explore']);
    expect(steps[1]?.point?.periodCode).toBe('2022JJ00');
    expect(steps[0]?.caption).toBe('Van 2022 tot 2024.');
  });

  it('yields nothing for a series with fewer than two plotted values', () => {
    expect(buildStorySteps(spec(), 'nl')).toEqual([]);
  });

  it('translates titles and templates to English, keeping the spec strings verbatim', () => {
    const steps = buildStorySteps(fourPointSpec(), 'en');
    expect(steps[0]).toMatchObject({ title: 'Overview', caption: 'From 2021 to 2024.' });
    expect(steps[4]).toMatchObject({ title: 'Latest', caption: '2024: 2,5 % (provisional figure)' });
    expect(steps[5]?.title).toBe('Explore yourself');
  });

  it('never puts a digit in a caption that is not a spec string (nl and en)', () => {
    expectDigitsBound(fourPointSpec(), 'nl');
    expectDigitsBound(fourPointSpec(), 'en');
  });
});

describe('buildStorySteps — several series', () => {
  function multiSeries(count: number): ChartSpec {
    return spec({
      series: Array.from({ length: count }, (_, i) => ({
        label: `Regio ${String.fromCharCode(65 + i)}`,
        regionCode: `PV${i}`,
        points: [
          point({ resultId: `${i}-a`, periodCode: '2022JJ00', periodLabel: '2022', value: i + 1, formattedValue: `${i + 1},0` }),
          point({ resultId: `${i}-b`, periodCode: '2024JJ00', periodLabel: '2024', value: i + 2, formattedValue: `${i + 2},0` }),
        ],
      })),
    });
  }

  it('walks the series in spec order, highlighting each and marking its last point', () => {
    const steps = buildStorySteps(multiSeries(2), 'nl');
    expect(steps.map((s) => s.kind)).toEqual(['overview', 'series', 'series', 'explore']);
    expect(steps[0]?.caption).toBe('Meerdere reeksen; het verhaal loopt ze één voor één langs.');
    expect(steps[1]).toMatchObject({ title: 'Regio A', caption: '2022: 1,0 → 2024: 2,0 %', highlight: 's0', point: { seriesKey: 's0', periodCode: '2024JJ00' } });
    expect(steps[2]).toMatchObject({ title: 'Regio B', highlight: 's1' });
  });

  it('caps the per-series steps and says so in the overview, without a number', () => {
    const steps = buildStorySteps(multiSeries(STORY_MAX_SERIES_STEPS + 2), 'nl');
    expect(steps.filter((s) => s.kind === 'series')).toHaveLength(STORY_MAX_SERIES_STEPS);
    expect(steps[0]?.caption).toBe('Meerdere reeksen; het verhaal loopt ze één voor één langs. Niet elke reeks krijgt een eigen stap.');
    expect(steps[0]?.caption).not.toMatch(/\d/);
  });

  it('never puts a digit in a caption that is not a spec string', () => {
    expectDigitsBound(multiSeries(3), 'nl');
    expectDigitsBound(multiSeries(3), 'en');
  });
});

describe('buildStorySteps — a comparison of bars', () => {
  function bars(): ChartSpec {
    return spec({
      kind: 'bar',
      series: [
        { label: 'Groningen', regionCode: 'PV20', points: [point({ resultId: 'gr', periodCode: '2021', periodLabel: '2021', value: 10, formattedValue: '10' })] },
        { label: 'Friesland', regionCode: 'PV21', points: [point({ resultId: 'fr', periodCode: '2021', periodLabel: '2021', value: 20, formattedValue: '20', provisional: true, status: 'Voorlopig' })] },
        { label: 'Drenthe', regionCode: 'PV22', points: [point({ resultId: 'dr', periodCode: '2021', periodLabel: '2021', value: 15, formattedValue: '15' })] },
      ],
    });
  }

  it('tells overview, highest, lowest, explore with the bars\' own strings and highlights', () => {
    const steps = buildStorySteps(bars(), 'nl');
    expect(steps.map((s) => s.kind)).toEqual(['overview', 'high', 'low', 'explore']);
    expect(steps[0]?.caption).toBe('Eén staaf per regio; hierna de hoogste en de laagste.');
    expect(steps[1]).toMatchObject({ title: 'Hoogste punt', caption: 'Friesland: 20 % (voorlopig cijfer)', highlight: 's1', point: null });
    expect(steps[2]).toMatchObject({ title: 'Laagste punt', caption: 'Groningen: 10 %', highlight: 's0' });
  });

  it('yields nothing for a comparison with fewer than two plotted bars', () => {
    const one = spec({ kind: 'bar', series: [bars().series[0]!] });
    expect(buildStorySteps(one, 'nl')).toEqual([]);
    const nulls = spec({
      kind: 'bar',
      series: bars().series.map((s) => ({ ...s, points: s.points.map((p) => ({ ...p, value: null, formattedValue: null })) })),
    });
    expect(buildStorySteps(nulls, 'nl')).toEqual([]);
  });

  it('never puts a digit in a caption that is not a spec string', () => {
    expectDigitsBound(bars(), 'nl');
    expectDigitsBound(bars(), 'en');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd web && npx vitest run lib/chart-story.test.ts`
Expected: FAIL — `Cannot find module './chart-story.ts'`.

- [ ] **Step 4: Write the builder**

Create `web/lib/chart-story.ts`:

```ts
// Story mode (session 92 design, docs/superpowers/specs/
// 2026-09-09-story-mode-and-embed-design.md Part A): the pure step builder.
//
// Honesty contract (docs/05 R1/R3/R6/R10/R11): a step's caption is a message
// TEMPLATE with spec strings filled in — `periodLabel`, `formattedValue`,
// `unit`, a series `label`, or `attribution.trendHeadline` — and nothing
// else. "Highest"/"lowest" are SELECTIONS over the values the spec already
// carries (like highlighting a series), never a computed number: the caption
// repeats the selected point's own `formattedValue`. Null points are skipped
// (they are drawn as honest gaps by the chart itself); a provisional point
// says so in words. Ties break towards the earliest period (spec order).
//
// No React, no Recharts: chart.tsx feeds this the DISPLAYED spec (already
// translated by translateSpecForDisplay for the chart language), so period
// labels and units arrive in the right language while periodCodes — the
// keys the chart marks points by — are untouched.
import type { ChartPoint, ChartSpec } from '../backend/chart/types.ts';
import { t, type Lang } from './i18n/messages.ts';

export type StoryStepKind = 'overview' | 'start' | 'high' | 'low' | 'latest' | 'series' | 'explore';

export interface StoryStep {
  /** Stable per chart: `${kind}-${seriesKey}-${periodCode}` or the kind alone. */
  id: string;
  kind: StoryStepKind;
  title: string;
  caption: string;
  /** The series key (`s<index>`, buildRows' positional key) to highlight
   * through the reducer's `setHighlight`, or null for "nothing highlighted". */
  highlight: string | null;
  /** The point to ring on the chart, or null. */
  point: { seriesKey: string; periodCode: string } | null;
}

/** Owner-facing cap: more series than this get no step of their own (the
 * overview says so, in words). */
export const STORY_MAX_SERIES_STEPS = 5;

type Plotted = ChartPoint & { value: number; formattedValue: string };

function plotted(points: ChartPoint[]): Plotted[] {
  return points.filter((p): p is Plotted => p.value !== null && p.formattedValue !== null);
}

function seriesKey(index: number): string {
  return `s${index}`;
}

function provisionalSuffix(point: ChartPoint, lang: Lang): string {
  return point.provisional ? t(lang, 'chart.story.provisional') : '';
}

function pointCaption(point: Plotted, unit: string, lang: Lang): string {
  return t(lang, 'chart.story.pointCaption', { period: point.periodLabel, value: point.formattedValue, unit }) + provisionalSuffix(point, lang);
}

/** The first plotted point with the maximum (or minimum) value — strict
 * comparison, so an equal later value never displaces an earlier one. */
function extreme(points: Plotted[], pick: 'max' | 'min'): Plotted {
  let best = points[0]!;
  for (const p of points) {
    if (pick === 'max' ? p.value > best.value : p.value < best.value) best = p;
  }
  return best;
}

function exploreStep(lang: Lang): StoryStep {
  return {
    id: 'explore',
    kind: 'explore',
    title: t(lang, 'chart.story.exploreTitle'),
    caption: t(lang, 'chart.story.exploreCaption'),
    highlight: null,
    point: null,
  };
}

function timeSeriesSteps(spec: ChartSpec, lang: Lang): StoryStep[] {
  const key = seriesKey(0);
  const points = plotted(spec.series[0]!.points);
  if (points.length < 2) return [];
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const high = extreme(points, 'max');
  const low = extreme(points, 'min');
  const overviewCaption =
    spec.attribution.trendHeadline ?? t(lang, 'chart.story.overviewCaption', { from: first.periodLabel, to: last.periodLabel });
  const pointStep = (kind: StoryStepKind, titleKey: 'chart.story.startTitle' | 'chart.story.highTitle' | 'chart.story.lowTitle' | 'chart.story.latestTitle', p: Plotted): StoryStep => ({
    id: `${kind}-${key}-${p.periodCode}`,
    kind,
    title: t(lang, titleKey),
    caption: pointCaption(p, spec.unit, lang),
    highlight: null,
    point: { seriesKey: key, periodCode: p.periodCode },
  });
  const steps: StoryStep[] = [
    { id: 'overview', kind: 'overview', title: t(lang, 'chart.story.overviewTitle'), caption: overviewCaption, highlight: null, point: null },
    pointStep('start', 'chart.story.startTitle', first),
  ];
  // A highest/lowest that IS the start or the latest point would repeat a
  // step the story already tells — dropped, never told twice.
  if (high !== first && high !== last) steps.push(pointStep('high', 'chart.story.highTitle', high));
  if (low !== first && low !== last && low !== high) steps.push(pointStep('low', 'chart.story.lowTitle', low));
  steps.push(pointStep('latest', 'chart.story.latestTitle', last));
  steps.push(exploreStep(lang));
  return steps;
}

function multiSeriesSteps(spec: ChartSpec, lang: Lang): StoryStep[] {
  const narrated = spec.series
    .map((series, index) => ({ series, index, points: plotted(series.points) }))
    .filter((entry) => entry.points.length >= 1);
  if (narrated.length < 2) return [];
  const capped = narrated.slice(0, STORY_MAX_SERIES_STEPS);
  const overviewCaption =
    t(lang, 'chart.story.overviewSeriesCaption') + (narrated.length > capped.length ? ` ${t(lang, 'chart.story.moreSeries')}` : '');
  const steps: StoryStep[] = [
    { id: 'overview', kind: 'overview', title: t(lang, 'chart.story.overviewTitle'), caption: overviewCaption, highlight: null, point: null },
  ];
  for (const { series, index, points } of capped) {
    const key = seriesKey(index);
    const first = points[0]!;
    const last = points[points.length - 1]!;
    const caption =
      points.length === 1
        ? pointCaption(first, spec.unit, lang)
        : t(lang, 'chart.story.seriesCaption', {
            fromPeriod: first.periodLabel,
            fromValue: first.formattedValue,
            toPeriod: last.periodLabel,
            toValue: last.formattedValue,
            unit: spec.unit,
          }) + provisionalSuffix(last, lang);
    steps.push({
      id: `series-${key}`,
      kind: 'series',
      title: series.label,
      caption,
      highlight: key,
      point: { seriesKey: key, periodCode: last.periodCode },
    });
  }
  steps.push(exploreStep(lang));
  return steps;
}

function comparisonSteps(spec: ChartSpec, lang: Lang): StoryStep[] {
  const bars = spec.series
    .map((series, index) => ({ series, index, point: plotted(series.points)[0] }))
    .filter((entry): entry is { series: ChartSpec['series'][number]; index: number; point: Plotted } => entry.point !== undefined);
  if (bars.length < 2) return [];
  let high = bars[0]!;
  let low = bars[0]!;
  for (const bar of bars) {
    if (bar.point.value > high.point.value) high = bar;
    if (bar.point.value < low.point.value) low = bar;
  }
  const barStep = (kind: 'high' | 'low', titleKey: 'chart.story.highTitle' | 'chart.story.lowTitle', bar: typeof high): StoryStep => ({
    id: `${kind}-${seriesKey(bar.index)}`,
    kind,
    title: t(lang, titleKey),
    caption:
      t(lang, 'chart.story.barCaption', { label: bar.series.label, value: bar.point.formattedValue, unit: spec.unit }) +
      provisionalSuffix(bar.point, lang),
    highlight: seriesKey(bar.index),
    point: null,
  });
  return [
    { id: 'overview', kind: 'overview', title: t(lang, 'chart.story.overviewTitle'), caption: t(lang, 'chart.story.compareCaption'), highlight: null, point: null },
    barStep('high', 'chart.story.highTitle', high),
    barStep('low', 'chart.story.lowTitle', low),
    exploreStep(lang),
  ];
}

/** The story for a chart, or `[]` when there is nothing to tell (the
 * trigger is then not offered). Pure and deterministic. */
export function buildStorySteps(spec: ChartSpec, lang: Lang): StoryStep[] {
  if (spec.series.length === 0) return [];
  if (spec.kind === 'bar') return comparisonSteps(spec, lang);
  if (spec.series.length === 1) return timeSeriesSteps(spec, lang);
  return multiSeriesSteps(spec, lang);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx vitest run lib/chart-story.test.ts lib/i18n/messages.test.ts`
Expected: PASS, all tests in both files.

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit -p web` (from the repo root). Expected: no output.

```bash
git add web/lib/chart-story.ts web/lib/chart-story.test.ts web/lib/i18n/messages.ts
git commit -m "feat(chart): story mode step builder — pure, honesty-bound steps from the chart's own strings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The `setView` reducer action and the counter events

**Files:**
- Modify: `web/lib/chart-view-state.ts:24-31` (action union) and `:37-70` (reducer)
- Modify: `web/lib/chart-view-state.test.ts` (append)
- Modify: `src/chart/user-styles.ts:20-32`
- Modify: `tests/chart/user-styles.test.ts` (append one case in the counter describe block)

**Interfaces:**
- Produces: `{ type: 'setView'; view: { hiddenKeys: Set<string>; highlightedKey: string | null; periodRange: [string, string] | null } }` on `ChartViewAction`; `'story_open' | 'story_step'` on `ChartStyleEvent`.

- [ ] **Step 1: Write the failing reducer test**

Append to `web/lib/chart-view-state.test.ts`:

```ts
describe('setView (story mode: restore the reader\'s own view in one action)', () => {
  it('replaces hiddenKeys, highlightedKey and periodRange together and leaves form and presentation alone', () => {
    let state = initialViewState('line');
    state = chartViewReducer(state, { type: 'setForm', form: 'area' });
    state = chartViewReducer(state, { type: 'setPresentation', patch: { lineWidth: 'thick' } });
    state = chartViewReducer(state, { type: 'toggleSeries', key: 's1' });
    state = chartViewReducer(state, {
      type: 'setView',
      view: { hiddenKeys: new Set(['s2']), highlightedKey: 's0', periodRange: ['2020JJ00', '2022JJ00'] },
    });
    expect(state.form).toBe('area');
    expect(state.presentation).toEqual({ lineWidth: 'thick' });
    expect([...state.hiddenKeys]).toEqual(['s2']);
    expect(state.highlightedKey).toBe('s0');
    expect(state.periodRange).toEqual(['2020JJ00', '2022JJ00']);
  });

  it('copies the given Set, so a later mutation of the caller\'s Set never leaks into state', () => {
    const hidden = new Set(['s1']);
    const state = chartViewReducer(initialViewState('line'), { type: 'setView', view: { hiddenKeys: hidden, highlightedKey: null, periodRange: null } });
    hidden.add('s2');
    expect([...state.hiddenKeys]).toEqual(['s1']);
  });
});
```

(Use the file's existing imports: `chartViewReducer`, `initialViewState` from `./chart-view-state.ts`, `describe/expect/it` from vitest — add whichever is missing.)

Run: `cd web && npx vitest run lib/chart-view-state.test.ts`
Expected: FAIL — the reducer returns the state unchanged for the unknown action, so `highlightedKey` is `null`, not `'s0'`.

- [ ] **Step 2: Add the action**

In `web/lib/chart-view-state.ts`, extend the union (after the `resetPresentation` line):

```ts
  /** Story mode (session 92): restore the reader's own hidden/highlight/zoom
   * state in ONE action when the story closes — three separate dispatches
   * would render three intermediate views. `form` and `presentation` are
   * deliberately not part of this: the story never touches them. */
  | { type: 'setView'; view: Pick<ChartViewState, 'hiddenKeys' | 'highlightedKey' | 'periodRange'> }
```

and the reducer case (before `case 'reset':`):

```ts
    case 'setView':
      return {
        ...state,
        hiddenKeys: new Set(action.view.hiddenKeys),
        highlightedKey: action.view.highlightedKey,
        periodRange: action.view.periodRange,
      };
```

Run: `cd web && npx vitest run lib/chart-view-state.test.ts` — Expected: PASS.

- [ ] **Step 3: Add the two counter events**

In `src/chart/user-styles.ts`, inside `CHART_STYLE_EVENTS` after `'brand_fetch',` add:

```ts
  // Story mode (session 92, spec 2026-09-09-story-mode-and-embed-design.md):
  // once per story opened, once per step the reader lands on. Anonymous
  // counts only, like every other event here.
  'story_open',
  'story_step',
```

Append to the counter describe block in `tests/chart/user-styles.test.ts` (the block whose first case asserts `[{ event: 'panel_open', day: '2026-01-01', count: 2 }]` — copy that case's setup for `db`):

```ts
    it('accepts the story-mode events (they are plain rows in the same table)', async () => {
      await recordChartStyleEvent(db, 'story_open', new Date('2026-01-02T10:00:00Z'));
      await recordChartStyleEvent(db, 'story_step', new Date('2026-01-02T10:00:00Z'));
      await recordChartStyleEvent(db, 'story_step', new Date('2026-01-02T11:00:00Z'));
      expect(await usageRows(db)).toEqual([
        { event: 'story_open', day: '2026-01-02', count: 1 },
        { event: 'story_step', day: '2026-01-02', count: 2 },
      ]);
    });
```

(If `usageRows` orders by `event`, keep that order; adjust to the helper's actual ordering — read the two existing cases first.) Also open `migrations/028_user_chart_styles.sql`: if `chart_style_usage.event` has a `check (event in (...))` constraint, the migration is FILE-ONLY and unapplied, so extend the list in place (an unapplied file may still be edited — RUNBOOK); if the column is unconstrained, nothing to do.

Run: `npx vitest run tests/chart/user-styles.test.ts` (repo root). Expected: PASS.

Also run: `cd web && npx vitest run app/usage-actions.test.ts` — its `vi.mock` lists `CHART_STYLE_EVENTS` explicitly; if it pins the exact array, add the two events there too. Expected: PASS.

- [ ] **Step 4: Typecheck both projects and commit**

Run: `npx tsc --noEmit && npx tsc --noEmit -p web` (repo root). Expected: no output.

```bash
git add web/lib/chart-view-state.ts web/lib/chart-view-state.test.ts src/chart/user-styles.ts tests/chart/user-styles.test.ts web/app/usage-actions.test.ts migrations/028_user_chart_styles.sql
git commit -m "feat(chart): setView reducer action + story_open/story_step counter events (story mode groundwork)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The trigger and the panel component

**Files:**
- Create: `web/components/chart-story.tsx`
- Create: `web/components/chart-story.test.tsx`

**Interfaces:**
- Consumes: `StoryStep` (Task 1), `Button` (`./ui/button.tsx`), `WandSparkles` (lucide-react), `t`/`Lang`.
- Produces:
  ```ts
  export interface ChartStoryTriggerProps { open: boolean; onToggle(): void; controlsId: string; triggerId: string; lang?: Lang }
  export function ChartStoryTrigger(props: ChartStoryTriggerProps): ReactNode
  export interface ChartStoryPanelProps {
    steps: StoryStep[]; index: number; onIndexChange(index: number): void;
    open: boolean; onClose(): void; triggerId: string; idPrefix: string; lang?: Lang;
  }
  export function ChartStoryPanel(props: ChartStoryPanelProps): ReactNode
  ```
  The region's id is `${idPrefix}-story` — `ChartView` must pass exactly that as the trigger's `controlsId`.

- [ ] **Step 1: Write the failing tests**

Create `web/components/chart-story.test.tsx`:

```tsx
// Story mode (session 92): the panel is a dumb, controlled component over
// StoryStep[] — closed until opened; the active card is marked; Next/
// Previous/arrow keys/dots report an index (never past the ends); Escape
// closes and returns focus to the trigger; and no digit ever appears in the
// panel that is not one of the steps' own (spec-derived) strings.
import { useState, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoryStep } from '../lib/chart-story.ts';
import { ChartStoryPanel, ChartStoryTrigger, type ChartStoryPanelProps } from './chart-story.tsx';

afterEach(cleanup);

const steps: StoryStep[] = [
  { id: 'overview', kind: 'overview', title: 'Overzicht', caption: 'Van 2021 tot 2024.', highlight: null, point: null },
  { id: 'high-s0-2022JJ00', kind: 'high', title: 'Hoogste punt', caption: '2022: 3,5 %', highlight: null, point: { seriesKey: 's0', periodCode: '2022JJ00' } },
  { id: 'explore', kind: 'explore', title: 'Verken zelf', caption: 'Wissel van weergave met de tabs.', highlight: null, point: null },
];

function Harness(props: Partial<ChartStoryPanelProps> & { onIndexChange?: (i: number) => void }): ReactNode {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const idPrefix = 'c1';
  return (
    <>
      <ChartStoryTrigger open={open} onToggle={() => setOpen((o) => !o)} controlsId={`${idPrefix}-story`} triggerId={`${idPrefix}-story-trigger`} lang={props.lang} />
      <ChartStoryPanel
        steps={props.steps ?? steps}
        index={index}
        onIndexChange={(i) => {
          setIndex(i);
          props.onIndexChange?.(i);
        }}
        open={open}
        onClose={() => setOpen(false)}
        triggerId={`${idPrefix}-story-trigger`}
        idPrefix={idPrefix}
        lang={props.lang}
      />
    </>
  );
}

describe('ChartStoryTrigger + ChartStoryPanel', () => {
  it('is closed by default; the trigger names Story mode and opens a labelled region', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Verhaal' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Verhaal bij de grafiek' })).toBeNull();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const region = screen.getByRole('region', { name: 'Verhaal bij de grafiek' });
    expect(region.id).toBe('c1-story');
    expect(trigger).toHaveAttribute('aria-controls', 'c1-story');
  });

  it('renders every step as a card, marks the active one, and walks with Next/Previous without leaving the ends', () => {
    const onIndexChange = vi.fn();
    render(<Harness onIndexChange={onIndexChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verhaal' }));
    const region = screen.getByRole('region', { name: 'Verhaal bij de grafiek' });
    const cards = within(region).getAllByRole('article');
    expect(cards).toHaveLength(3);
    expect(cards[0]).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: 'Vorige' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
    expect(onIndexChange).toHaveBeenLastCalledWith(1);
    expect(within(region).getAllByRole('article')[1]).toHaveAttribute('aria-current', 'step');
    fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
    expect(screen.getByRole('button', { name: 'Volgende' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
    expect(onIndexChange).toHaveBeenCalledTimes(2);
  });

  it('the dotted step list jumps to a step by its title; arrow keys walk; Escape closes and refocuses the trigger', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Verhaal' });
    fireEvent.click(trigger);
    const region = screen.getByRole('region', { name: 'Verhaal bij de grafiek' });
    const dots = within(within(region).getByRole('list', { name: 'Stappen' })).getAllByRole('button');
    expect(dots.map((d) => d.getAttribute('aria-label'))).toEqual(['Overzicht', 'Hoogste punt', 'Verken zelf']);
    fireEvent.click(dots[2]!);
    expect(within(region).getAllByRole('article')[2]).toHaveAttribute('aria-current', 'step');
    fireEvent.keyDown(region, { key: 'ArrowLeft' });
    expect(within(region).getAllByRole('article')[1]).toHaveAttribute('aria-current', 'step');
    fireEvent.keyDown(region, { key: 'ArrowRight' });
    expect(within(region).getAllByRole('article')[2]).toHaveAttribute('aria-current', 'step');
    fireEvent.keyDown(region, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Verhaal bij de grafiek' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('speaks English when asked', () => {
    render(<Harness lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: 'Story mode' }));
    expect(screen.getByRole('region', { name: 'Story for this chart' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
    expect(screen.getByText('Scroll or use the arrows')).toBeInTheDocument();
  });

  it('shows no digit that is not one of the steps\' own strings (no "step 2 of 3" anywhere)', () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Verhaal' }));
    const allowed = steps.flatMap((s) => [s.title, s.caption]);
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const tokens: string[] = [];
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      tokens.push(...((node.textContent ?? '').match(/\d[\d.,]*/g) ?? []));
    }
    expect(tokens.length).toBeGreaterThan(0);
    for (const tok of tokens) {
      expect(allowed.some((str) => str.includes(tok)), `token "${tok}" has no source in the steps`).toBe(true);
    }
  });
});
```

Run: `cd web && npx vitest run components/chart-story.test.tsx`
Expected: FAIL — `Cannot find module './chart-story.tsx'`.

- [ ] **Step 2: Write the components**

Create `web/components/chart-story.tsx`:

```tsx
'use client';
// Story mode (session 92 design, docs/superpowers/specs/
// 2026-09-09-story-mode-and-embed-design.md Part A): the colourful trigger
// and the story panel. Both are DUMB and CONTROLLED — chart.tsx owns
// open/index (exactly like the Style panel), builds the steps
// (web/lib/chart-story.ts) and reacts to the index (highlight, point ring).
//
// The panel renders one card per step in a fixed-height scroll area; the
// card nearest the area's centre becomes the active step (IntersectionObserver,
// absent under jsdom — the buttons, dots and arrow keys drive the same
// `onIndexChange`). No "step N of M" text anywhere: the dotted list carries
// the position, so the card's whole-text digit scans stay exemption-free.
// House ARIA: role="region", aria-expanded/aria-controls on the trigger,
// Escape closes and refocuses the trigger.
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { WandSparkles } from 'lucide-react';
import type { StoryStep } from '../lib/chart-story.ts';
import { t, type Lang } from '../lib/i18n/messages.ts';
import { Button } from './ui/button.tsx';

export interface ChartStoryTriggerProps {
  open: boolean;
  onToggle(): void;
  controlsId: string;
  triggerId: string;
  lang?: Lang;
}

/** The owner's ask: "a colourful border, with a magic wand … to show
 * something exciting will happen". The gradient lives on a 2 px wrapper;
 * the button itself paints the card colour so the ring reads as a border.
 * This is the one gradient in the product (12-huisstijl). */
export function ChartStoryTrigger({ open, onToggle, controlsId, triggerId, lang = 'nl' }: ChartStoryTriggerProps): ReactNode {
  return (
    <span
      className="inline-flex rounded-lg p-[2px]"
      style={{ background: 'linear-gradient(135deg, #7c3aed, #ec4899, #f59e0b)' }}
      data-story-trigger-ring="true"
    >
      <Button
        id={triggerId}
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={controlsId}
        onClick={onToggle}
        className="rounded-[6px] bg-card text-foreground hover:bg-muted aria-expanded:bg-muted"
      >
        <WandSparkles aria-hidden="true" />
        {t(lang, 'chart.story.trigger')}
      </Button>
    </span>
  );
}

export interface ChartStoryPanelProps {
  steps: StoryStep[];
  index: number;
  onIndexChange(index: number): void;
  open: boolean;
  onClose(): void;
  triggerId: string;
  idPrefix: string;
  lang?: Lang;
}

export function ChartStoryPanel({ steps, index, onIndexChange, open, onClose, triggerId, idPrefix, lang = 'nl' }: ChartStoryPanelProps): ReactNode {
  const regionRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);
  // True while a button/dot/key is scrolling a card into view, so the
  // observer's intermediate intersections don't fight the chosen step.
  const programmatic = useRef<ReturnType<typeof setTimeout> | null>(null);
  const regionId = `${idPrefix}-story`;
  const headingId = `${idPrefix}-story-heading`;
  const last = steps.length - 1;

  function go(next: number): void {
    const clamped = Math.max(0, Math.min(last, next));
    if (clamped === index) return;
    onIndexChange(clamped);
    const card = cardRefs.current[clamped];
    if (card && typeof card.scrollIntoView === 'function') {
      if (programmatic.current) clearTimeout(programmatic.current);
      programmatic.current = setTimeout(() => {
        programmatic.current = null;
      }, 500);
      const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      card.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    }
  }

  function closeAndRefocus(): void {
    onClose();
    document.getElementById(triggerId)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAndRefocus();
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      go(index + 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      go(index - 1);
    }
  }

  // Focus the region on open so arrow keys work at once (the trigger keeps
  // focus otherwise); not a focus trap — Tab leaves normally.
  useEffect(() => {
    if (open) regionRef.current?.focus();
  }, [open]);

  // Scroll-driven steps: the card with the largest visible share of the
  // scroll area wins. jsdom has no IntersectionObserver — the buttons cover it.
  useEffect(() => {
    if (!open || typeof IntersectionObserver === 'undefined' || !scrollRef.current) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (programmatic.current) return;
        let best: { i: number; ratio: number } | null = null;
        for (const entry of entries) {
          const i = Number((entry.target as HTMLElement).dataset.storyStep);
          if (!Number.isInteger(i)) continue;
          if (!best || entry.intersectionRatio > best.ratio) best = { i, ratio: entry.intersectionRatio };
        }
        if (best && best.ratio >= 0.5 && best.i !== index) onIndexChange(best.i);
      },
      { root: scrollRef.current, threshold: [0.5, 0.75, 1] },
    );
    for (const card of cardRefs.current) if (card) observer.observe(card);
    return () => observer.disconnect();
  }, [open, index, onIndexChange, steps.length]);

  if (!open) return null;

  return (
    <section
      ref={regionRef}
      id={regionId}
      role="region"
      aria-labelledby={headingId}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="mt-3 rounded-lg border border-border bg-card p-3 text-card-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={headingId} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <WandSparkles aria-hidden="true" className="size-3.5" />
          {t(lang, 'chart.story.regionLabel')}
        </span>
        <span className="text-xs text-muted-foreground">{t(lang, 'chart.story.hint')}</span>
      </div>
      <div ref={scrollRef} className="mt-2 max-h-40 space-y-2 overflow-y-auto pr-1">
        {steps.map((step, i) => (
          <article
            key={step.id}
            ref={(el) => {
              cardRefs.current[i] = el;
            }}
            data-story-step={i}
            aria-current={i === index ? 'step' : undefined}
            onClick={() => go(i)}
            className={
              'rounded-md border px-3 py-2 transition-colors ' +
              (i === index ? 'border-foreground/40 bg-muted' : 'border-border bg-background text-muted-foreground')
            }
          >
            <p className="text-sm font-medium text-foreground">{step.title}</p>
            <p className="mt-0.5 text-sm">{step.caption}</p>
          </article>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={index <= 0} onClick={() => go(index - 1)}>
          {t(lang, 'chart.story.prev')}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={index >= last} onClick={() => go(index + 1)}>
          {t(lang, 'chart.story.next')}
        </Button>
        <ol aria-label={t(lang, 'chart.story.stepsLabel')} className="ml-auto flex items-center gap-1">
          {steps.map((step, i) => (
            <li key={step.id}>
              <button
                type="button"
                aria-label={step.title}
                aria-current={i === index ? 'step' : undefined}
                onClick={() => go(i)}
                className={'block size-2.5 rounded-full ' + (i === index ? 'bg-foreground' : 'bg-border hover:bg-muted-foreground')}
              />
            </li>
          ))}
        </ol>
        <Button type="button" variant="ghost" size="sm" onClick={closeAndRefocus}>
          {t(lang, 'chart.story.close')}
        </Button>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cd web && npx vitest run components/chart-story.test.tsx`
Expected: PASS (5 tests). If `toBeDisabled` fails on the Base UI `Button`, assert `expect(button).toHaveAttribute('disabled')` instead — check `web/components/ui/button.tsx` renders a native `<button>` (it does today).

- [ ] **Step 4: Typecheck and commit**

Run: `npx tsc --noEmit -p web`. Expected: no output.

```bash
git add web/components/chart-story.tsx web/components/chart-story.test.tsx
git commit -m "feat(chart): story mode trigger (gradient ring + wand) and controlled story panel

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Wire the story into `ChartView`

**Files:**
- Modify: `web/components/chart.tsx` — imports (`:27`, after `:72`), `SeriesDot` (`:709-795`), the `styleOpen` state (`:1135`), the spec-swap block (`:1156-1165`), `toggleStylePanel` (`:1540-1547`), the tab row (`:1680-1688`), the Line/Area `dot=` calls (`:1894-1901`, `:1969-1976`), the panel slot (`:2148`), the download gate is unchanged.
- Modify: `web/components/chart.test.tsx` — append a describe block.

**Interfaces:**
- Consumes: `buildStorySteps`, `StoryStep` (Task 1); `setView` (Task 2); `ChartStoryTrigger`, `ChartStoryPanel` (Task 3); `trackChartStyleEvent('story_open' | 'story_step')`.
- Produces: nothing new outside this file. `SeriesDot` gains an 8th parameter `storyPeriodCode: string | null = null`.

- [ ] **Step 1: Write the failing integration tests**

Append to `web/components/chart.test.tsx` (uses the file's existing `threePointSpec`, `twoSeriesFourYearLineSpec`, `multiRegionBarSpec`, `scanForUnboundDigits`, `spec`, `point`, `setChartUsageSink`, `LangProvider`):

```tsx
describe('Story mode (session 92): a code-built story under the chart', () => {
  it('offers the colourful Verhaal trigger next to Opmaak on a chart with a story, not on Tabel, not on a one-point chart', () => {
    const { container, unmount } = render(<ChartView spec={threePointSpec()} />);
    const trigger = screen.getByRole('button', { name: 'Verhaal' });
    expect(container.querySelector('[data-story-trigger-ring]')).toContainElement(trigger);
    expect(trigger.querySelector('svg')).not.toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Tabel' }));
    expect(screen.queryByRole('button', { name: 'Verhaal' })).toBeNull();
    unmount();
    render(<ChartView spec={spec()} />);
    expect(screen.queryByRole('button', { name: 'Verhaal' })).toBeNull();
  });

  it('opening the story closes Opmaak and vice versa (one panel under the chart)', () => {
    render(<ChartView spec={threePointSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    expect(screen.getByRole('region', { name: 'Opmaak van de grafiek' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Verhaal' }));
    expect(screen.queryByRole('region', { name: 'Opmaak van de grafiek' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Verhaal bij de grafiek' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    expect(screen.queryByRole('region', { name: 'Verhaal bij de grafiek' })).toBeNull();
  });

  it('a point step rings exactly that point outside its own marker, and never carries data-point', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verhaal' }));
    expect(container.querySelector('[data-story-marker]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
    const rings = container.querySelectorAll('[data-story-marker]');
    expect(rings).toHaveLength(1);
    const ring = rings[0]!;
    expect(ring.getAttribute('data-point')).toBeNull();
    expect(ring.getAttribute('data-story-marker')).toBe('lo');
    expect(container.querySelectorAll('[data-point]')).toHaveLength(3);
    const dot = container.querySelector('[data-result-id="lo"]')!;
    expect(Number(ring.getAttribute('r'))).toBeGreaterThan(Number(dot.getAttribute('r')));
  });

  it('a series step highlights that series (others dim) and closing restores the reader\'s own view', () => {
    const { container } = render(<ChartView spec={twoSeriesFourYearLineSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: /Utrecht/ }));
    expect(container.querySelectorAll('.recharts-line')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Verhaal' }));
    expect(container.querySelectorAll('.recharts-line')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
    expect(container.querySelectorAll('[data-series-dimmed="true"]')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Sluiten' }));
    expect(container.querySelectorAll('[data-series-dimmed="true"]')).toHaveLength(0);
    expect(container.querySelectorAll('.recharts-line')).toHaveLength(1);
  });

  it('a comparison story highlights the highest bar', () => {
    const { container } = render(<ChartView spec={multiRegionBarSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verhaal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
    expect(screen.getByRole('region', { name: 'Verhaal bij de grafiek' })).toHaveTextContent('Friesland: 20 %');
    expect(container.querySelectorAll('[data-series-dimmed="true"]').length).toBeGreaterThan(0);
  });

  it('a spec swap on the same instance closes the story and starts the next one at the first step', () => {
    const { rerender } = render(<ChartView spec={threePointSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verhaal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
    rerender(<ChartView spec={twoSeriesFourYearLineSpec()} />);
    expect(screen.queryByRole('region', { name: 'Verhaal bij de grafiek' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Verhaal' }));
    expect(screen.getAllByRole('article')[0]).toHaveAttribute('aria-current', 'step');
  });

  it('counts story_open once per open and story_step per landed step', () => {
    const events: ChartStyleEvent[] = [];
    setChartUsageSink((e) => {
      events.push(e);
    });
    try {
      render(<ChartView spec={threePointSpec()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Verhaal' }));
      fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
      fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
      expect(events).toEqual(['story_open', 'story_step', 'story_step']);
    } finally {
      setChartUsageSink(null);
    }
  });

  it('with the story open the whole card still shows only spec digits, in Dutch and in English', () => {
    const s = threePointSpec({ provisionalNote: 'Voorlopige cijfers (2024) zijn gemarkeerd met *.' });
    const strings = [
      s.title,
      s.unit,
      s.attributionLine,
      s.attribution.tableId,
      s.attribution.syncedAt,
      s.provisionalNote ?? '',
      ...s.series.flatMap((se) => se.points.flatMap((p) => [p.formattedValue ?? '', p.periodLabel])),
    ].filter(Boolean);
    const nl = render(<ChartView spec={s} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verhaal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
    scanForUnboundDigits(nl.container, strings);
    nl.unmount();
    const en = render(
      <LangProvider lang="en">
        <ChartView spec={s} />
      </LangProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Story mode' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    scanForUnboundDigits(en.container, strings);
  });

  it('nothing of the story enters the SVG export', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verhaal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
    const svg = container.querySelector('svg')!;
    expect(svg.querySelector('[data-story-marker]')).not.toBeNull();
    expect(svg.textContent).not.toContain('Hoogste punt');
    expect(svg.textContent).not.toContain('Begin');
  });
});
```

(Check `LangProvider`'s prop name in `web/lib/i18n/lang-provider.tsx` — use what it exports; the English tests already in this file show the pattern.) Note the 'lo' expectation: `threePointSpec`'s first point has `resultId: 'lo'` and the second step is `start`, whose point is that first point — the ring's `data-story-marker` carries the point's `resultId` (see Step 2). The export test deliberately keeps the ring INSIDE the svg (it is a chart mark, like the highlight dimming, and is digit-free) while the panel text stays out — `#46(c)`: what is on screen is what is exported.

Run: `cd web && npx vitest run components/chart.test.tsx -t "Story mode"`
Expected: FAIL — no "Verhaal" button.

- [ ] **Step 2: Implement in `chart.tsx`**

(a) Imports — add `useMemo` to the react import at line 27 and, after the `ChartDownloadMenu` import (line 72):

```ts
import { buildStorySteps, type StoryStep } from '../lib/chart-story.ts';
import { ChartStoryPanel, ChartStoryTrigger } from './chart-story.tsx';
```

(b) `SeriesDot` — add an 8th parameter after `lang: Lang = 'nl',`:

```ts
  // Story mode (session 92): the periodCode of the point the active story
  // step tells about, or null. Draws ONE extra ring OUTSIDE the point's own
  // marker (r + 5) so the hollow provisional ring (R11) stays fully visible
  // inside it. Not a data point: no data-point attribute, no role, no
  // handlers, pointer-events none — the [data-point] count and keyboard
  // walking are unchanged.
  storyPeriodCode: string | null = null,
```

and inside `Dot`, right before `return (` compute `const isStory = storyPeriodCode !== null && payload.periodCode === storyPeriodCode;` and as the FIRST child of the returned `<g>` add:

```tsx
        {isStory ? (
          <circle
            cx={cx}
            cy={cy}
            r={geometry.r + 5}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeOpacity={opacity}
            pointerEvents="none"
            data-story-marker={resultId == null ? 'true' : String(resultId)}
          />
        ) : null}
```

(c) State — replace `const [styleOpen, setStyleOpen] = useState(false);` (line 1135) with:

```ts
  // Story mode (session 92): Style and Story share the slot under the chart —
  // one open at a time, so a single discriminated value replaces the old
  // boolean (`styleOpen` is derived, every existing read of it is unchanged).
  const [openPanel, setOpenPanel] = useState<'style' | 'story' | null>(null);
  const styleOpen = openPanel === 'style';
  const setStyleOpen = (open: boolean): void => setOpenPanel(open ? 'style' : null);
  const [storyIndex, setStoryIndex] = useState(0);
  // The reader's own hidden/highlight/zoom state, taken when the story opens
  // and put back when it closes (the story drives highlight itself and needs
  // the full, unhidden, unzoomed chart so every step's point is on screen).
  const storySnapshot = useRef<Pick<ChartViewState, 'hiddenKeys' | 'highlightedKey' | 'periodRange'> | null>(null);
```

(`ChartViewState` is exported by `../lib/chart-view-state.ts` — add it to that import if missing.)

(d) Spec-swap block (line 1156-1165): replace `setStyleOpen(false);` with:

```ts
    setOpenPanel(null);
    setStoryIndex(0);
    storySnapshot.current = null;
```

(e) `toggleStylePanel` (line 1540): replace the body with:

```ts
    if (openPanel !== 'style') trackChartStyleEvent('panel_open');
    setOpenPanel(openPanel === 'style' ? null : 'style');
```

(f) Steps + story controls — directly after the `styleControlsId` line (1538) add:

```ts
  const storyTriggerId = `${domId}-story-trigger`;
  const storyControlsId = `${domId}-story`;
  // Built from the FULL spec (never the zoomed viewSpec) in the chart's
  // language, so every step's point exists on the chart the story shows.
  const storySteps: StoryStep[] = useMemo(
    () => buildStorySteps(translateSpecForDisplay(spec, chartLang), chartLang),
    [spec, chartLang],
  );
  const storyAvailable =
    state.form !== 'table' && !(smallMultiples && smallMultiplesAvailable) && storySteps.length >= 3;
  const storyOpen = openPanel === 'story' && storyAvailable;
  const activeStoryStep: StoryStep | null = storyOpen ? (storySteps[storyIndex] ?? null) : null;

  function openStory(): void {
    storySnapshot.current = { hiddenKeys: state.hiddenKeys, highlightedKey: state.highlightedKey, periodRange: state.periodRange };
    dispatch({ type: 'setView', view: { hiddenKeys: new Set(), highlightedKey: storySteps[0]?.highlight ?? null, periodRange: null } });
    setStoryIndex(0);
    setOpenPanel('story');
    trackChartStyleEvent('story_open');
  }

  function closeStory(): void {
    const snapshot = storySnapshot.current;
    storySnapshot.current = null;
    if (snapshot) dispatch({ type: 'setView', view: snapshot });
    setOpenPanel(null);
  }

  function toggleStory(): void {
    if (storyOpen) closeStory();
    else openStory();
  }

  function onStoryIndexChange(next: number): void {
    setStoryIndex(next);
    dispatch({ type: 'setHighlight', key: storySteps[next]?.highlight ?? null });
    trackChartStyleEvent('story_step');
  }
```

`useMemo` must sit ABOVE the `schemaVersion` guard (line ~1301) like the other Hooks — place this whole block right after the `styleControlsId` declaration only if that is above the guard; if `styleControlsId` is declared below the guard (it is, line 1538), keep `storyTriggerId`/`storyControlsId`/the functions there but move the `useMemo` line up next to the `useEffect` for fonts (line ~1255) — `spec` and `chartLang` are both defined there.

Also: `toggleStylePanel` must close the story's snapshot honestly — replace its body (from (e)) with:

```ts
    if (openPanel === 'story') closeStory();
    if (openPanel !== 'style') trackChartStyleEvent('panel_open');
    setOpenPanel(openPanel === 'style' ? null : 'style');
```

(g) Trigger — in the tab row, directly after the `ChartConfigTrigger` block (`) : null}` at line 1688) add:

```tsx
        {storyAvailable ? (
          <ChartStoryTrigger
            open={storyOpen}
            onToggle={toggleStory}
            controlsId={storyControlsId}
            triggerId={storyTriggerId}
            lang={chartLang}
          />
        ) : null}
```

(h) Point ring — in BOTH the `<Line …>` (line 1894) and `<Area …>` (line 1969) `dot={SeriesDot(…)}` calls add an 8th argument after `chartLang,`:

```ts
                        activeStoryStep?.point?.seriesKey === s.key ? activeStoryStep.point.periodCode : null,
```

(i) Panel — directly BEFORE the `{state.form !== 'table' ? (<ChartConfigPanel` block (line 2148) add:

```tsx
      {/* Story mode (session 92): the same slot as the Opmaak region — chart
        * first, the story under it — and, like ChartNotes, OUTSIDE
        * chartContainerRef so no caption can ever enter an export. */}
      {storyAvailable ? (
        <ChartStoryPanel
          steps={storySteps}
          index={storyIndex}
          onIndexChange={onStoryIndexChange}
          open={storyOpen}
          onClose={closeStory}
          triggerId={storyTriggerId}
          idPrefix={domId}
          lang={chartLang}
        />
      ) : null}
```

- [ ] **Step 3: Run the story tests, then the whole chart suite**

Run: `cd web && npx vitest run components/chart.test.tsx components/chart-story.test.tsx components/chart-config-panel.test.tsx`
Expected: PASS. If the "one panel" test fails because `ChartConfigPanel` calls `onOpenChange(false)` on Escape and that arrives as `setStyleOpen(false)` while the story is open, that is fine (it sets `null` only when the style panel closes itself; the story path never routes through it). If the highlight test finds 2 dimmed lines, check that `openStory` runs `setView` BEFORE `setOpenPanel` (it must, so the first render of the open story already has the first step's highlight).

- [ ] **Step 4: Run the full web suite, typecheck, build**

Run: `cd web && npx vitest run` — Expected: all files pass (1138 + the new tests).
Run: `npx tsc --noEmit -p web` (root) — Expected: no output.
Run: `cd web && npx next build` — Expected: build succeeds (the `web-db` dev server must be stopped first; restart it afterwards if used for a browser check).

- [ ] **Step 5: Commit**

```bash
git add web/components/chart.tsx web/components/chart.test.tsx
git commit -m "feat(chart): Story mode — colourful trigger in the tab row, story panel under the chart, point ring + per-step highlight, snapshot/restore

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Docs — the decision, the assumption, the huisstijl note

**Files:**
- Modify: `docs/decisions/039-chart-presentation-panel.md` (append an addendum)
- Modify: `docs/open-questions.md` (append one row at the end of the table; next free number after the current last row)
- Modify: `docs/12-huisstijl.md` (§ "Answer card and chart panel layout" — add a bullet)
- Modify: `docs/03-mvp-scope.md:55` (the Studio row — one sentence)
- Modify: `docs/04-architecture.md` (the chart capability row — one sentence)
- Modify: `docs/superpowers/specs/2026-09-09-story-mode-and-embed-design.md` (A2/A3: the zoom deviation)

- [ ] **Step 1: ADR 039 addendum** — append:

```markdown
## Addendum 2026-09-09 (session 92, owner present) — Story mode, as built

The owner asked for a "Story mode" button with a colourful border and a magic-wand icon, "to show something exciting will happen", and chose (from three options) a scroll story IN the chat: the chart stays, short steps scroll past it. Design: [superpowers/specs/2026-09-09-story-mode-and-embed-design.md](../superpowers/specs/2026-09-09-story-mode-and-embed-design.md) Part A.

- **Mechanism:** `web/lib/chart-story.ts` — `buildStorySteps(displayedSpec, lang)`, pure — turns the chart's own spec into steps (time series: overview · start · highest · lowest · latest · explore, duplicates dropped; several series: overview · one step per series up to five · explore; comparison: overview · highest · lowest · explore). A caption is a message template filled ONLY with spec strings (`periodLabel`, `formattedValue`, `unit`, a series label, `trendHeadline`); the whole-card digit scans run with the story open in both languages. "Highest/lowest" is a selection over the spec's values (the caption repeats that point's own `formattedValue`), the same class as highlight — **Assumption**, open-questions (the R6 row added this session). Ties → the earliest period; null points skipped; a provisional point says so in words.
- **UI:** `ChartStoryTrigger` (the app's one gradient: a 2 px ring, lucide `WandSparkles`, "Verhaal" / "Story mode") as a row-mate of the Weergave tablist after Opmaak, offered only for chart forms with at least three steps and never with small multiples on; `ChartStoryPanel` (`chart-story.tsx`) in the Opmaak slot under the chart, outside the export container, one open panel at a time (`openPanel: 'style' | 'story' | null` in `ChartView`). Cards in a fixed-height scroll area, the card nearest the centre is the step (IntersectionObserver; buttons, dots and arrow keys drive the same index); Escape closes and refocuses.
- **Chart reaction:** per step the reducer's `setHighlight`; a point step draws one ring outside the point's marker (`r + 5`, digit-free, no `data-point`) — R11's hollow ring stays visible inside it. Opening snapshots the reader's hidden/highlight/zoom state and shows the full chart; closing restores it in one new reducer action `setView`. A spec swap closes the story (owner E). **Zoom is not used** (the spec's "zoom to the step's period window" was dropped: a one-period window is a degenerate chart, a wider window would be an invented range) — recorded as a follow-up.
- **Counted, not stored:** `story_open`, `story_step` on the anonymous counter (migration 028, file-only until applied). Nothing persisted; a download taken mid-story bakes the ring (it is on screen) and never the panel text.
- **Rollback:** remove the trigger render in `chart.tsx`; nothing else depends on it.
```

- [ ] **Step 2: open-questions row** — append to the table (replace `NNN` with the next free number):

```markdown
| NNN | Product / honesty | **Story mode (session 92): may a code-built caption say "highest point" / "lowest point" and repeat that point's own value?** The step builder SELECTS the max/min over the spec's `value`s (skipping nulls, ties → earliest) and shows that point's `formattedValue` verbatim — no new number is computed or displayed, so R1/R3 hold by construction; R6 forbids a renderer omitting or re-computing data, and this is a presentation selection like highlight/zoom (ADR 038). | **Assumption, taken 2026-09-09 (session 92, owner present, design approved in chat): allowed.** If a later review reads R6 more strictly, drop the `high`/`low` step kinds in `web/lib/chart-story.ts` — the rest of the story (overview, start, latest, per-series, explore) stands. Follow-ups recorded in the same design: zoomed steps, story inside the embed, LLM-written captions only on measured demand. |
```

- [ ] **Step 3: 12-huisstijl** — under "## Answer card and chart panel layout" add:

```markdown
- **Story mode (session 92):** the "Verhaal / Story mode" trigger is the product's ONE gradient — a 2 px ring (`linear-gradient(135deg, #7c3aed, #ec4899, #f59e0b)`) around a ghost button with the lucide `WandSparkles` icon, a row-mate of the Weergave tabs after Opmaak. The story panel opens in the Opmaak slot under the chart (one open at a time) as bordered step cards in a short scroll area with Previous / Next and a dotted step list. No other control gets a gradient.
```

- [ ] **Step 4: 03-mvp-scope, 04-architecture, the spec** — in 03-mvp-scope's Studio row append one sentence: "**Session 92 (2026-09-09): a code-built Story mode (scroll steps under the chart) is IN scope and built — ADR 039 addendum.**" In 04-architecture's chart capability row append: "Story mode (session 92): code-built steps under the chart, `web/lib/chart-story.ts`, ADR 039 addendum." In the spec, in A2 replace "dispatches the existing reducer actions — nothing new in `chart-view-state.ts`: `setPeriodRange` (zoom to the step's period window), `setHighlight`" with "dispatches the existing `setHighlight` per step (zoom is NOT used in v1 — see the Global Constraints of the plan and ADR 039's addendum; one new action `setView` restores the reader's view on close)", and in A3 drop `zoom: [periodCode, periodCode] | null,` from the `StoryStep` shape.

- [ ] **Step 5: Docs test and commit**

Run: `npm run -s test:docs` (root). Expected: 11 passed.

```bash
git add docs/decisions/039-chart-presentation-panel.md docs/open-questions.md docs/12-huisstijl.md docs/03-mvp-scope.md docs/04-architecture.md docs/superpowers/specs/2026-09-09-story-mode-and-embed-design.md
git commit -m "docs: Story mode as built — ADR 039 addendum, R6 assumption row, huisstijl ring, scope + architecture rows

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review (done while writing)

- **Spec coverage:** A1 trigger (Task 3 + 4g), A2 panel incl. scroll/buttons/keys/Escape/restore (Task 3, 4f/i), A3 steps + digit rule + provisional + caps + ties (Task 1), A4 counter/export/tests (Tasks 2, 4), A5 exclusions honoured. Zoom deliberately dropped and documented (Task 5).
- **Type consistency:** `StoryStep.point.seriesKey` matches `buildRows`' `s<index>` keys (`seriesKey(index)` in Task 1; `s.key` in Task 4h); `setView` shape identical in Tasks 2 and 4; `ChartStoryPanelProps` identical in Tasks 3 and 4i; the region id `${idPrefix}-story` equals `storyControlsId`.
- **Placeholders:** none; `NNN` in Task 5 is an instruction to look up the next row number, not a placeholder value.
