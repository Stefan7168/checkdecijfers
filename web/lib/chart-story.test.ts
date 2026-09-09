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
    expect(steps[0]).toMatchObject({ title: 'Overzicht', caption: 'Van 2021 tot 2024', highlight: null, point: null });
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
    expect(steps[0]?.caption).toBe('Van 2022 tot 2024');
  });

  it('yields nothing for a series with fewer than two plotted values', () => {
    expect(buildStorySteps(spec(), 'nl')).toEqual([]);
  });

  it('translates titles and templates to English, keeping the spec strings verbatim', () => {
    const steps = buildStorySteps(fourPointSpec(), 'en');
    expect(steps[0]).toMatchObject({ title: 'Overview', caption: 'From 2021 to 2024' });
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
