// Co-pilot phase 2 (session 113, Task 8) — the chat doorway's two pure
// inputs: what THIS chart can currently do (the advisory capability list the
// prompt is narrowed by) and the three example chips shown under the input.
// Both are deterministic; the chips are also digit-free, which is what keeps
// the whole-card digit scan clean while they are on screen.
import { describe, expect, it } from 'vitest';
import { cbsCapabilities, cbsExampleChips, exampleChips, ownDataCapabilities, ownDataRenderableForms } from './chart-capabilities.ts';
import type { RegionScope } from '../backend/query/types.ts';
import { allowedForms } from './chart-fit.ts';
import { COPILOT_FORMS, PRESENTATION_KEYS, TEMPLATE_IDS } from '../backend/attachments/copilot/types.ts';
import { initialDocState, type ChartDocState } from './chart-commands.ts';
import { ownDataPieFormAllowed, ownDataStacked100FormAllowed, ownDataStackedFormAllowed } from './chart-view-state.ts';
import type { PresentationKey } from './chart-presentation.ts';
import type { ClientChartInstruction, DatasetProfile, UserChartSpec } from '../backend/attachments/types.ts';
import type { PlottableSpec } from '../components/chart.tsx';
import type { ChartSpec } from '../backend/chart/types.ts';

const ALL_APPLICABLE: ReadonlySet<PresentationKey> = new Set(PRESENTATION_KEYS as readonly PresentationKey[]);

function plottable(kind: 'line' | 'bar', seriesCount: number): PlottableSpec {
  return {
    kind,
    series: Array.from({ length: seriesCount }, (_, i) => ({
      label: `Series ${i}`,
      points: [{ periodCode: 'p', periodLabel: 'p', value: 1, formattedValue: '1', provisional: false, resultId: `r${i}` }],
    })),
  };
}

describe('ownDataCapabilities', () => {
  it('offers only the forms this spec actually allows (lineFormAllowed et al.)', () => {
    // A bar-kind spec with more than one series: a line would connect
    // unrelated categories, so lineFormAllowed says no — and area/hbar
    // follow their own rules (area is single-series line only; hbar is
    // bar-kind only).
    const caps = ownDataCapabilities({ spec: plottable('bar', 2), form: 'bar', seriesCount: 2, applicable: ALL_APPLICABLE, lang: 'nl' });
    expect(caps.forms).not.toContain('line');
    expect(caps.forms).not.toContain('area');
    expect(caps.forms).toEqual(expect.arrayContaining(['bar', 'hbar', 'table']));
  });

  it('offers line + area for a single-series line spec, and never hbar', () => {
    const caps = ownDataCapabilities({ spec: plottable('line', 1), form: 'line', seriesCount: 1, applicable: ALL_APPLICABLE, lang: 'nl' });
    expect(caps.forms).toEqual(expect.arrayContaining(['line', 'area', 'bar', 'table']));
    expect(caps.forms).not.toContain('hbar');
  });

  it('reports exactly the applicable presentation keys the chat may patch', () => {
    const applicable: ReadonlySet<PresentationKey> = new Set<PresentationKey>(['grid', 'markers', 'valueLabels']);
    const caps = ownDataCapabilities({ spec: plottable('line', 1), form: 'line', seriesCount: 1, applicable, lang: 'nl' });
    // `valueLabels` is not in the chat's own vocabulary (PRESENTATION_KEYS),
    // so an applicable key the chat cannot patch is still left out.
    expect(caps.presentationKeys.sort()).toEqual(['grid', 'markers']);
  });

  it('offers the template gallery on a chart form and nothing in table form', () => {
    expect(ownDataCapabilities({ spec: plottable('line', 1), form: 'line', seriesCount: 1, applicable: ALL_APPLICABLE, lang: 'en' }).templates).toEqual([
      ...TEMPLATE_IDS,
    ]);
    const table = ownDataCapabilities({ spec: plottable('line', 1), form: 'table', seriesCount: 1, applicable: new Set(), lang: 'en' });
    expect(table.templates).toEqual([]);
    expect(table.presentationKeys).toEqual([]);
  });

  it("carries the chart's own language", () => {
    expect(ownDataCapabilities({ spec: plottable('line', 1), form: 'line', seriesCount: 1, applicable: ALL_APPLICABLE, lang: 'en' }).lang).toBe('en');
  });

  // Own-data wiring of the CBS tier's co-pilot phase 6 addDerivedOverlay
  // (pitfall #1's gate): the SAME form-only predicate cbsCapabilities below
  // uses for its own `overlays` field.
  it('offers overlays only in line/area form, whatever the spec kind or series count', () => {
    expect(ownDataCapabilities({ spec: plottable('line', 1), form: 'line', seriesCount: 1, applicable: ALL_APPLICABLE, lang: 'nl' }).overlays).toBe(true);
    expect(ownDataCapabilities({ spec: plottable('line', 1), form: 'area', seriesCount: 1, applicable: ALL_APPLICABLE, lang: 'nl' }).overlays).toBe(true);
    expect(ownDataCapabilities({ spec: plottable('bar', 2), form: 'bar', seriesCount: 2, applicable: ALL_APPLICABLE, lang: 'nl' }).overlays).toBe(false);
    expect(ownDataCapabilities({ spec: plottable('line', 1), form: 'table', seriesCount: 1, applicable: ALL_APPLICABLE, lang: 'nl' }).overlays).toBe(false);
  });
});

const PROFILE: DatasetProfile = {
  columns: [
    { id: 'c0', header: 'Gemeente 2024', type: 'text', distinct: ['Amsterdam', 'Rotterdam'], nulls: 0 },
    { id: 'c1', header: 'Omzet', type: 'number', numberFormat: 'nl', nulls: 0 },
  ],
  rowCount: 2,
};

const INSTRUCTION: ClientChartInstruction = {
  version: 2,
  kind: 'bar',
  x: 'c0',
  y: ['c1'],
  seriesBy: null,
  filters: [],
  sort: null,
  limit: null,
  aggregate: null,
  derived: null,
  unsupported: null,
};

function point(label: string, value: number | null) {
  return { rowRef: `r-${label}-${value}`, xKey: label, xLabel: label, value, formattedValue: String(value), sourceText: String(value) };
}

function spec(kind: 'line' | 'bar', series: { label: string; points: ReturnType<typeof point>[] }[]): UserChartSpec {
  return {
    schemaVersion: 1,
    origin: 'user_dataset',
    trust: 'unverified',
    kind,
    xHeader: 'Gemeente',
    yHeaders: ['Omzet'],
    series,
    provenance: {
      datasetId: 1,
      sourceKind: 'file_csv',
      displayName: 'x.csv',
      sourceUrlHost: null,
      capturedAt: '2026-09-18T00:00:00.000Z',
      contentSha256: 'x',
    },
    disclaimerLine: 'User-uploaded data — not verified by checkdecijfers.',
  };
}

const ONE_SERIES = spec('bar', [{ label: 'Omzet', points: [point('Amsterdam', 3)] }]);
const TWO_SERIES = spec('line', [
  { label: 'Amsterdam', points: [point('a', 1), point('b', 9)] },
  { label: 'Rotterdam', points: [point('a', 4), point('b', 2)] },
]);

function state(overrides: Partial<ChartDocState> = {}): ChartDocState {
  return { ...initialDocState('bar', {}, INSTRUCTION), ...overrides };
}

describe('exampleChips', () => {
  it('leads with the aggregate chip, naming the grouping column digit-free', () => {
    const chips = exampleChips({ instruction: INSTRUCTION, profile: PROFILE, spec: ONE_SERIES, state: state(), lang: 'nl' });
    expect(chips).toHaveLength(3);
    // The header is "Gemeente 2024" in the file; the label strips the digits.
    expect(chips[0]).toEqual({ label: 'Totaal per Gemeente', message: 'Totaal per Gemeente' });
  });

  it('offers the spotlight chip for a multi-series chart, naming the highest last value', () => {
    const chips = exampleChips({ instruction: INSTRUCTION, profile: PROFILE, spec: TWO_SERIES, state: state(), lang: 'nl' });
    // Amsterdam's last non-null value (9) beats Rotterdam's (2).
    expect(chips.map((c) => c.label)).toContain('Zet Amsterdam in de schijnwerper');
  });

  it('falls back to "Hoogste eerst" on a single-series bar chart', () => {
    const chips = exampleChips({ instruction: INSTRUCTION, profile: PROFILE, spec: ONE_SERIES, state: state(), lang: 'nl' });
    expect(chips.map((c) => c.label)).toContain('Hoogste eerst');
  });

  it('asks for a title when there is none and for a shorter one when there is', () => {
    const none = exampleChips({ instruction: INSTRUCTION, profile: PROFILE, spec: ONE_SERIES, state: state(), lang: 'nl' });
    expect(none.map((c) => c.label)).toContain('Geef de grafiek een kop');
    const titled = exampleChips({ instruction: INSTRUCTION, profile: PROFILE, spec: ONE_SERIES, state: state({ title: 'Een hele lange kop' }), lang: 'nl' });
    expect(titled.map((c) => c.label)).toContain('Maak de kop korter');
  });

  it('fills to exactly three from the fallback list when the rules cannot', () => {
    // No distinct column, already aggregated, one series, line kind: only
    // the title rule fires.
    const aggregated: ClientChartInstruction = { ...INSTRUCTION, aggregate: { fn: 'sum' } };
    const bare: DatasetProfile = { columns: [{ id: 'c1', header: 'Omzet', type: 'number', numberFormat: 'nl', nulls: 0 }], rowCount: 1 };
    const chips = exampleChips({
      instruction: aggregated,
      profile: bare,
      spec: spec('line', [{ label: 'Omzet', points: [point('a', 1)] }]),
      state: state(),
      lang: 'en',
    });
    expect(chips).toHaveLength(3);
    expect(chips.map((c) => c.label)).toEqual(['Give the chart a title', 'Make it a bar chart', 'Hide the grid']);
  });

  it('every chip label is digit-free, in both languages, and is its own message', () => {
    for (const lang of ['nl', 'en'] as const) {
      for (const input of [ONE_SERIES, TWO_SERIES]) {
        const chips = exampleChips({ instruction: INSTRUCTION, profile: PROFILE, spec: input, state: state({ title: 'x' }), lang });
        expect(chips).toHaveLength(3);
        for (const chip of chips) {
          expect(chip.label).not.toMatch(/\d/);
          expect(chip.message).toBe(chip.label);
        }
      }
    }
  });
});

// Co-pilot phase 3 (session 114, Task 2) — the CBS/Eurostat tier's own
// capability list and example chips. Same pure-leaf shape, narrower
// vocabulary (no data-side capability at all — that tier only ever offers
// a view change or a follow-up hand-off).
function cbsPoint(periodLabel: string, value: number | null) {
  return { periodCode: periodLabel, periodLabel, value, formattedValue: value === null ? null : String(value), provisional: false, resultId: `r-${periodLabel}-${value}` };
}

function cbsSpec(kind: 'line' | 'bar', series: { label: string; points: ReturnType<typeof cbsPoint>[] }[]): PlottableSpec {
  return { kind, series };
}

const CBS_ONE_SERIES: PlottableSpec = cbsSpec('bar', [{ label: 'Amsterdam', points: [cbsPoint('2020', 1)] }]);
const CBS_TWO_SERIES: PlottableSpec = cbsSpec('line', [
  { label: 'Amsterdam', points: [cbsPoint('2020', 1), cbsPoint('2021', 9)] },
  { label: 'Rotterdam', points: [cbsPoint('2020', 4), cbsPoint('2021', 2)] },
]);

function cbsState(overrides: Partial<Pick<ChartDocState, 'title' | 'hiddenKeys'>> = {}): Pick<ChartDocState, 'title' | 'hiddenKeys'> {
  return { title: null, hiddenKeys: new Set(), ...overrides };
}

/** #300: the tabs' live verdict gates, all permissive. The fixtures above
 * carry no `regionScope`, so the STRUCTURAL guard already excludes the three
 * verified-whole forms for them — passing "all allowed" here proves the live
 * filter is a pure intersection with that ceiling, never an addition. */
const LIVE_ALL = { pie: true, stacked: true, stacked100: true } as const;

/** A structurally pie/stacked-eligible spec: a complete-roster provenance
 * (`regionScope`, the same literal chart-commands.test.ts uses), at least
 * two series, one point each. */
const CBS_ROSTER_ONE_PERIOD: PlottableSpec & Pick<ChartSpec, 'regionScope'> = {
  ...cbsSpec('bar', [
    { label: 'Groningen', points: [cbsPoint('2025', 1)] },
    { label: 'Friesland', points: [cbsPoint('2025', 2)] },
  ]),
  regionScope: { kind: 'all_provincies' },
};

describe('cbsCapabilities', () => {
  it('forms for a 2-series / 2-point line spec are line/bar/table plus the phase-5 trio (chart-fit scorer)', () => {
    // Phase 5: CBS_TWO_SERIES has exactly two points per series, so it is
    // precisely the shape dumbbell/slope are for — and a 2 × 2 grid for
    // heatmap. Before the scorer this pinned ['line', 'bar', 'table'].
    const caps = cbsCapabilities({ spec: CBS_TWO_SERIES, form: 'line', applicable: ALL_APPLICABLE, zoomAvailable: true, liveWholeForms: LIVE_ALL, lang: 'nl' });
    expect(caps.forms).toEqual(['line', 'bar', 'table', 'dumbbell', 'slope', 'heatmap']);
  });

  it('a normal multi-point time series offers heatmap but never dumbbell/slope', () => {
    const threePoints = cbsSpec('line', [
      { label: 'Amsterdam', points: [cbsPoint('2020', 1), cbsPoint('2021', 9), cbsPoint('2022', 5)] },
      { label: 'Rotterdam', points: [cbsPoint('2020', 4), cbsPoint('2021', 2), cbsPoint('2022', 6)] },
    ]);
    const caps = cbsCapabilities({ spec: threePoints, form: 'line', applicable: ALL_APPLICABLE, zoomAvailable: true, liveWholeForms: LIVE_ALL, lang: 'nl' });
    expect(caps.forms).toEqual(['line', 'bar', 'table', 'heatmap']);
  });

  it('a bar spec with one series offers line/bar/hbar/table', () => {
    const caps = cbsCapabilities({ spec: CBS_ONE_SERIES, form: 'bar', applicable: ALL_APPLICABLE, zoomAvailable: false, liveWholeForms: LIVE_ALL, lang: 'nl' });
    expect(caps.forms).toEqual(['line', 'bar', 'hbar', 'table']);
  });

  it('templates are empty in table form', () => {
    const caps = cbsCapabilities({ spec: CBS_ONE_SERIES, form: 'table', applicable: ALL_APPLICABLE, zoomAvailable: false, liveWholeForms: LIVE_ALL, lang: 'nl' });
    expect(caps.templates).toEqual([]);
  });

  it('zoom mirrors the input', () => {
    expect(cbsCapabilities({ spec: CBS_ONE_SERIES, form: 'bar', applicable: ALL_APPLICABLE, zoomAvailable: true, liveWholeForms: LIVE_ALL, lang: 'nl' }).zoom).toBe(true);
    expect(cbsCapabilities({ spec: CBS_ONE_SERIES, form: 'bar', applicable: ALL_APPLICABLE, zoomAvailable: false, liveWholeForms: LIVE_ALL, lang: 'nl' }).zoom).toBe(false);
  });
});

// Phase 5b follow-up (#300): the three verified-whole forms are gated by
// MORE than structure on screen — a live server verdict, hidden series, an
// alternate reading, a missing audit row, the period window. The chat's
// capability list must mirror the tabs' real state, so `liveWholeForms`
// (chart.tsx's own canUsePie/canUseStacked/canUseStacked100) intersects
// the structural ceiling: it only ever narrows, never widens.
describe('cbsCapabilities — live verified-whole gates (#300)', () => {
  it('the roster fixture is structurally eligible for all three forms when every live gate is open', () => {
    const caps = cbsCapabilities({ spec: CBS_ROSTER_ONE_PERIOD, form: 'bar', applicable: ALL_APPLICABLE, zoomAvailable: false, liveWholeForms: LIVE_ALL, lang: 'nl' });
    expect(caps.forms).toEqual(expect.arrayContaining(['pie', 'stacked', 'stacked100']));
  });

  it('(a) drops pie when the tab has it disabled (pending/refused verdict, hidden series, window), keeping the other two', () => {
    const caps = cbsCapabilities({
      spec: CBS_ROSTER_ONE_PERIOD,
      form: 'bar',
      applicable: ALL_APPLICABLE,
      zoomAvailable: false,
      liveWholeForms: { pie: false, stacked: true, stacked100: true },
      lang: 'nl',
    });
    expect(caps.forms).not.toContain('pie');
    expect(caps.forms).toEqual(expect.arrayContaining(['stacked', 'stacked100']));
  });

  it('(b) keeps pie but drops stacked and 100%-stacked when only those tabs are disabled', () => {
    const caps = cbsCapabilities({
      spec: CBS_ROSTER_ONE_PERIOD,
      form: 'bar',
      applicable: ALL_APPLICABLE,
      zoomAvailable: false,
      liveWholeForms: { pie: true, stacked: false, stacked100: false },
      lang: 'nl',
    });
    expect(caps.forms).toContain('pie');
    expect(caps.forms).not.toContain('stacked');
    expect(caps.forms).not.toContain('stacked100');
  });

  it('(c) never ADDS a form the structural guard excludes: no regionScope means no roster form, whatever the live gates say', () => {
    for (const spec of [CBS_ONE_SERIES, CBS_TWO_SERIES]) {
      const caps = cbsCapabilities({ spec, form: 'bar', applicable: ALL_APPLICABLE, zoomAvailable: false, liveWholeForms: LIVE_ALL, lang: 'nl' });
      expect(caps.forms).not.toContain('pie');
      expect(caps.forms).not.toContain('stacked');
      expect(caps.forms).not.toContain('stacked100');
    }
  });

  it('the live filter leaves every non-roster form untouched', () => {
    const open = cbsCapabilities({ spec: CBS_ROSTER_ONE_PERIOD, form: 'bar', applicable: ALL_APPLICABLE, zoomAvailable: false, liveWholeForms: LIVE_ALL, lang: 'nl' });
    const closed = cbsCapabilities({
      spec: CBS_ROSTER_ONE_PERIOD,
      form: 'bar',
      applicable: ALL_APPLICABLE,
      zoomAvailable: false,
      liveWholeForms: { pie: false, stacked: false, stacked100: false },
      lang: 'nl',
    });
    const roster = new Set(['pie', 'stacked', 'stacked100']);
    expect(closed.forms).toEqual(open.forms.filter((f) => !roster.has(f)));
  });
});

// Own-data chart-fit parity (plan 2026-09-22, Task 1) — replaces the phase-5
// "CBS tier only" block that stood here: the own-data tier now reads the
// SAME scorer (`allowedForms`), capped to the forms user-chart.tsx has a
// render branch for (`ownDataRenderableForms`) and, on the chat's wire, to
// the forms the own-data co-pilot's SERVER accepts today (`COPILOT_FORMS`,
// widened in Task 5 together with the prompt bump and the offline fixture
// regen). The chat may never offer a shape its own panel cannot draw, nor
// one the server would drop.
describe('own-data chart-fit parity (Task 1) — the scorer, capped to what the own-data card renders', () => {
  const THREE_POINTS = cbsSpec('line', [
    { label: 'Amsterdam', points: [cbsPoint('2020', 1), cbsPoint('2021', 9), cbsPoint('2022', 5)] },
    { label: 'Rotterdam', points: [cbsPoint('2020', 4), cbsPoint('2021', 2), cbsPoint('2022', 6)] },
  ]);
  const TWO_BARS_ONE_MOMENT = cbsSpec('bar', [
    { label: 'Amsterdam', points: [cbsPoint('2020', 1)] },
    { label: 'Rotterdam', points: [cbsPoint('2020', 2)] },
  ]);
  const NULL_CELL = cbsSpec('line', [
    { label: 'Amsterdam', points: [cbsPoint('2020', 1), cbsPoint('2021', 9)] },
    { label: 'Rotterdam', points: [cbsPoint('2020', 4), cbsPoint('2021', null)] },
  ]);
  const RAGGED = cbsSpec('line', [
    { label: 'Amsterdam', points: [cbsPoint('2020', 1), cbsPoint('2021', 9)] },
    { label: 'Rotterdam', points: [cbsPoint('2019', 4), cbsPoint('2020', 2)] },
  ]);
  const SHAPES: readonly [PlottableSpec, number][] = [
    [CBS_TWO_SERIES, 2],
    [THREE_POINTS, 2],
    [CBS_ONE_SERIES, 1],
    [TWO_BARS_ONE_MOMENT, 2],
    [NULL_CELL, 2],
    [RAGGED, 2],
  ];

  it('a 2-series × 2-point spec (dumbbell-, slope- AND heatmap-shaped) surfaces all three, in the scorer\'s order — dumbbell since Task 2 gave it a render branch — then the stacks (Task 3: two moments is never a pie)', () => {
    expect(ownDataRenderableForms(CBS_TWO_SERIES, 2)).toEqual(['line', 'bar', 'table', 'dumbbell', 'slope', 'heatmap', 'stacked', 'stacked100']);
  });

  it('a multi-point time series surfaces heatmap but not slope (a slope needs exactly two moments), and the stacks', () => {
    expect(ownDataRenderableForms(THREE_POINTS, 2)).toEqual(['line', 'bar', 'table', 'heatmap', 'stacked', 'stacked100']);
  });

  it('a single series gets none of the chart-fit or whole forms; two series at ONE moment get the pie and the stacks (Task 3) but none of the two-point/grid forms', () => {
    expect(ownDataRenderableForms(CBS_ONE_SERIES, 1)).toEqual(['line', 'bar', 'hbar', 'table']);
    expect(ownDataRenderableForms(TWO_BARS_ONE_MOMENT, 2)).toEqual(['bar', 'hbar', 'table', 'pie', 'stacked', 'stacked100']);
  });

  it('a null cell withholds the chart-fit trio; ragged periods withhold only the heatmap (dumbbell and slope need two real points per series, not shared ones) — the table and (Task 3) the stacks stay: the own-data whole guards read series and point COUNTS, not values', () => {
    expect(ownDataRenderableForms(NULL_CELL, 2)).toEqual(['line', 'bar', 'table', 'stacked', 'stacked100']);
    // Two real points per series is dumbbellFormAllowed's (and so
    // slopeFormAllowed's) whole condition — the SAME verdict chart.tsx's
    // canUseDumbbell/canUseSlope reach for a ragged CBS pair; each line
    // then spans its own two moments over a three-moment axis, each
    // dumbbell row its own two values, every drawn point a real value. The
    // grid, which needs a cell at every intersection, is withheld.
    expect(ownDataRenderableForms(RAGGED, 2)).toEqual(['line', 'bar', 'table', 'dumbbell', 'slope', 'stacked', 'stacked100']);
  });

  it('is the shared scorer\'s own verdict, in the scorer\'s order, followed by exactly the whole forms own-data\'s OWN guards allow (Task 3) — the cap removes nothing for an own-data spec and never adds a form the scorer withheld', () => {
    for (const [spec, seriesCount] of SHAPES) {
      const scorer = allowedForms(spec, seriesCount);
      // No own-data spec carries `regionScope`, so the scorer never offers
      // the three roster forms here — they arrive from the own-data guards,
      // appended last (the tripwire below proves the cap strips the
      // scorer's own roster verdict even where it exists).
      expect(scorer).not.toEqual(expect.arrayContaining(['pie']));
      const result = ownDataRenderableForms(spec, seriesCount);
      expect(result.slice(0, scorer.length)).toEqual(scorer);
      expect(result.slice(scorer.length)).toEqual(
        (['pie', 'stacked', 'stacked100'] as const).filter((form) =>
          form === 'pie'
            ? ownDataPieFormAllowed(spec, seriesCount)
            : form === 'stacked'
              ? ownDataStackedFormAllowed(spec, seriesCount)
              : ownDataStacked100FormAllowed(spec, seriesCount),
        ),
      );
    }
  });

  it('tripwire (rewritten in Task 3, deliberately): the three whole forms come from own-data\'s OWN shape-only guards, never from the scorer\'s roster verdict — a spec that DID carry a roster (never a real own-data spec) lists them exactly once, exactly as its roster-less twin does', () => {
    const rostered: PlottableSpec & { regionScope: RegionScope } = { ...TWO_BARS_ONE_MOMENT, regionScope: { kind: 'all_provincies' } };
    // The scorer itself offers the three for the rostered twin only…
    expect(allowedForms(rostered, 2)).toEqual(['bar', 'hbar', 'table', 'pie', 'stacked', 'stacked100']);
    expect(allowedForms(TWO_BARS_ONE_MOMENT, 2)).toEqual(['bar', 'hbar', 'table']);
    // …while own-data's render list is provenance-blind: identical for
    // both, each whole form once (the cap strips the scorer's copy, the
    // own-data guards append theirs).
    expect(ownDataRenderableForms(TWO_BARS_ONE_MOMENT, 2)).toEqual(['bar', 'hbar', 'table', 'pie', 'stacked', 'stacked100']);
    expect(ownDataRenderableForms(rostered, 2)).toEqual(ownDataRenderableForms(TWO_BARS_ONE_MOMENT, 2));
  });

  it('a whole form on screen (Task 3): templates offered (not a tabular form), overlays off, and the three whole forms reach the render list but not yet the chat\'s wire', () => {
    const caps = ownDataCapabilities({ spec: TWO_BARS_ONE_MOMENT, form: 'pie', seriesCount: 2, applicable: ALL_APPLICABLE, lang: 'nl' });
    expect(caps.templates).toEqual([...TEMPLATE_IDS]);
    expect(caps.overlays).toBe(false);
    expect(caps.forms).toEqual(['bar', 'hbar', 'table']);
  });

  it('ownDataCapabilities forwards that list through the server\'s own COPILOT_FORMS allowlist — today slope/heatmap/the whole forms reach the TABS but not yet the chat (tripwire: flips in Task 5)', () => {
    // When this guard fails because COPILOT_FORMS now names 'slope', Task 5
    // has landed: change the expectation below to ['line', 'bar', 'table',
    // 'dumbbell', 'slope', 'heatmap', 'stacked', 'stacked100'] and delete
    // the guard.
    expect([...COPILOT_FORMS]).not.toContain('slope');
    expect([...COPILOT_FORMS]).not.toContain('heatmap');
    expect([...COPILOT_FORMS]).not.toContain('pie');
    expect([...COPILOT_FORMS]).not.toContain('stacked');
    const caps = ownDataCapabilities({ spec: CBS_TWO_SERIES, form: 'line', seriesCount: 2, applicable: ALL_APPLICABLE, lang: 'nl' });
    expect(caps.forms).toEqual(['line', 'bar', 'table']);
    // …and the wire cap is exactly that allowlist, nothing narrower.
    const wire = new Set<string>(COPILOT_FORMS);
    for (const [spec, seriesCount] of SHAPES) {
      const c = ownDataCapabilities({ spec, form: 'line', seriesCount, applicable: ALL_APPLICABLE, lang: 'nl' });
      expect(c.forms).toEqual(ownDataRenderableForms(spec, seriesCount).filter((f) => wire.has(f)));
    }
  });

  it('cbsCapabilities lists the trio for that same spec — the CBS card draws all three', () => {
    const caps = cbsCapabilities({ spec: CBS_TWO_SERIES, form: 'line', applicable: ALL_APPLICABLE, zoomAvailable: false, liveWholeForms: LIVE_ALL, lang: 'nl' });
    expect(caps.forms).toEqual(expect.arrayContaining(['dumbbell', 'slope', 'heatmap']));
  });

  it('templates are empty in heatmap form too (the Style panel is mounted for neither tabular form) and offered on slope', () => {
    expect(ownDataCapabilities({ spec: CBS_TWO_SERIES, form: 'heatmap', seriesCount: 2, applicable: new Set(), lang: 'nl' }).templates).toEqual([]);
    expect(ownDataCapabilities({ spec: CBS_TWO_SERIES, form: 'slope', seriesCount: 2, applicable: ALL_APPLICABLE, lang: 'nl' }).templates).toEqual([...TEMPLATE_IDS]);
  });

  it('overlays stay line/area-only — a slope, exactly as on the CBS card, offers none', () => {
    expect(ownDataCapabilities({ spec: CBS_TWO_SERIES, form: 'slope', seriesCount: 2, applicable: ALL_APPLICABLE, lang: 'nl' }).overlays).toBe(false);
    expect(ownDataCapabilities({ spec: CBS_TWO_SERIES, form: 'heatmap', seriesCount: 2, applicable: ALL_APPLICABLE, lang: 'nl' }).overlays).toBe(false);
  });
});

describe('cbsExampleChips', () => {
  it('returns exactly three chips, all digit-free', () => {
    for (const lang of ['nl', 'en'] as const) {
      const chips = cbsExampleChips({ spec: CBS_TWO_SERIES, state: cbsState(), zoomAvailable: true, lang });
      expect(chips).toHaveLength(3);
      for (const c of chips) {
        expect(c.label).not.toMatch(/\d/);
        expect(c.message).toBe(c.label);
      }
    }
  });

  it('the spotlight chip names the top series (highest last value)', () => {
    const chips = cbsExampleChips({ spec: CBS_TWO_SERIES, state: cbsState(), zoomAvailable: false, lang: 'nl' });
    expect(chips.map((c) => c.label)).toContain('Zet Amsterdam in de schijnwerper');
  });

  it('drops makeBar on a bar spec (already bars) and offers the newsroom-look filler instead', () => {
    const chips = cbsExampleChips({ spec: CBS_ONE_SERIES, state: cbsState({ title: 'x' }), zoomAvailable: false, lang: 'nl' });
    expect(chips.map((c) => c.label)).not.toContain('Maak er een staafdiagram van');
    expect(chips).toHaveLength(3);
  });

  it('offers "lastYears" only when zoomAvailable is true', () => {
    const withZoom = cbsExampleChips({ spec: CBS_TWO_SERIES, state: cbsState({ title: 'x' }), zoomAvailable: true, lang: 'nl' });
    expect(withZoom.map((c) => c.label)).toContain('Alleen de laatste jaren');
    const withoutZoom = cbsExampleChips({ spec: CBS_TWO_SERIES, state: cbsState({ title: 'x' }), zoomAvailable: false, lang: 'nl' });
    expect(withoutZoom.map((c) => c.label)).not.toContain('Alleen de laatste jaren');
  });
});
