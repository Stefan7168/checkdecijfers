// ADR 058 phase 3 (#332), Task 1: toEnglishChartSpec is a pure, DB-free
// display-copy converter — every reader-visible Dutch text becomes English
// where a deterministic name table or template mapping exists, every
// id/code/value/status field stays byte-identical, the input is never
// mutated, and no number is invented or lost (digit-multiset invariance).
import { describe, expect, it } from 'vitest';
import {
  buildChartSpec,
  PROVISIONAL_NOTE,
  PROVISIONAL_NOTE_EN,
  toEnglishChartSpec,
} from '../../src/chart/index.ts';
import type { ChartSpec } from '../../src/chart/index.ts';
import { DERIVED_DATA_MARKING } from '../../src/query/index.ts';
import type { DerivationRecord } from '../../src/query/index.ts';
import { deepFreeze, makeCell, makeResult } from './helpers.ts';

// --- digit-multiset invariance helper ---------------------------------------

/** Every reader-visible TEXT field toEnglishChartSpec may translate — never
 * the id/code/status fields that must stay byte-identical (those trivially
 * carry the same digits anyway). */
function collectTextFields(spec: ChartSpec): string[] {
  const fields: string[] = [spec.title, spec.unit, ...Object.values(spec.dimLabels)];
  for (const series of spec.series) {
    fields.push(series.label);
    for (const point of series.points) {
      fields.push(point.periodLabel);
      if (point.formattedValue !== null) fields.push(point.formattedValue);
    }
  }
  if (spec.provisionalNote !== null) fields.push(spec.provisionalNote);
  fields.push(...spec.nullNotes);
  if (spec.definitionLine !== null) fields.push(spec.definitionLine);
  fields.push(spec.attributionLine, spec.attribution.tableTitle);
  if (spec.attribution.trendHeadline !== undefined) fields.push(spec.attribution.trendHeadline);
  if (spec.annotations) fields.push(...spec.annotations.map((a) => a.label));
  return fields;
}

/** Numeric groups (with Dutch OR English thousands/decimal separators)
 * normalised to bare digit strings, so '18.044.027' (Dutch) and '18,044,027'
 * (English) both become '18044027' — the same number, notation stripped. */
function digitGroups(text: string): string[] {
  return (text.match(/\d[\d.,]*/g) ?? []).map((g) => g.replace(/[.,]/g, ''));
}

function digitMultiset(spec: ChartSpec): string[] {
  return collectTextFields(spec)
    .flatMap(digitGroups)
    .sort();
}

describe('toEnglishChartSpec', () => {
  it('translates title (measure title), unit and dimLabels values', () => {
    const cells = [
      makeCell({
        periodCode: '2023JJ00',
        measureTitle: 'Bevolking op 1 januari',
        unit: 'aantal',
        decimals: 0,
        value: 17_811_291,
        dims: { Onderwerp: 'A048709' },
        dimLabels: { Onderwerp: 'Zonnestroom' },
      }),
      makeCell({
        periodCode: '2024JJ00',
        measureTitle: 'Bevolking op 1 januari',
        unit: 'aantal',
        decimals: 0,
        value: 17_900_000,
        dims: { Onderwerp: 'A048709' },
        dimLabels: { Onderwerp: 'Zonnestroom' },
      }),
    ];
    const spec = buildChartSpec(makeResult('series', cells))!;
    const en = toEnglishChartSpec(spec);

    expect(en.title).toBe('Population on 1 January');
    expect(en.unit).toBe('number');
    expect(en.dimLabels).toEqual({ Onderwerp: 'Solar photovoltaic' });
    // dims (codes) stay byte-identical.
    expect(en.dims).toEqual(spec.dims);
  });

  it('translates a quarter periodLabel and formattedValue notation, keeps every id/value/code/status field identical', () => {
    const cells = [
      makeCell({ periodCode: '2012KW01', periodLabel: '2012 1e kwartaal', value: 1234.5, decimals: 1 }),
      makeCell({ periodCode: '2012KW02', periodLabel: '2012 2e kwartaal', value: 1300.25, decimals: 2 }),
    ];
    const spec = buildChartSpec(makeResult('series', cells))!;
    const en = toEnglishChartSpec(spec);

    const enPoints = en.series[0]!.points;
    const nlPoints = spec.series[0]!.points;
    expect(enPoints.map((p) => p.periodLabel)).toEqual(['2012 Q1', '2012 Q2']);
    expect(nlPoints[0]!.formattedValue).toBe('1.234,5');
    expect(enPoints[0]!.formattedValue).toBe('1,234.5');

    for (const [i, p] of enPoints.entries()) {
      const orig = nlPoints[i]!;
      expect(p.resultId).toBe(orig.resultId);
      expect(p.periodCode).toBe(orig.periodCode);
      expect(p.value).toBe(orig.value);
      expect(p.decimals).toBe(orig.decimals);
      expect(p.status).toBe(orig.status);
      expect(p.provisional).toBe(orig.provisional);
      expect(p.valueAttribute).toBe(orig.valueAttribute);
    }
  });

  it('translates a region series label via translateRegion, keeps regionCode identical', () => {
    const cells = [
      makeCell({ regionCode: 'PV26', regionLabel: 'Zuid-Holland', periodCode: '2024JJ00', value: 5 }),
      makeCell({ regionCode: 'PV24', regionLabel: 'Utrecht (PV)', periodCode: '2024JJ00', value: 3 }),
    ];
    const spec = buildChartSpec(makeResult('comparison', cells))!;
    const en = toEnglishChartSpec(spec);

    expect(en.series.map((s) => s.label)).toEqual(['South Holland', 'Utrecht (PV)']);
    expect(en.series.map((s) => s.regionCode)).toEqual(spec.series.map((s) => s.regionCode));
  });

  it('a national (regionless) series label is the measure title, translated the same way as the chart title', () => {
    const cells = [
      makeCell({ periodCode: '2023JJ00', measureTitle: 'Bevolking op 1 januari' }),
      makeCell({ periodCode: '2024JJ00', measureTitle: 'Bevolking op 1 januari' }),
    ];
    const spec = buildChartSpec(makeResult('series', cells))!;
    const en = toEnglishChartSpec(spec);
    expect(spec.series[0]!.regionCode).toBeNull();
    expect(en.series[0]!.label).toBe('Population on 1 January');
  });

  it('provisionalNote becomes its English sibling exactly when set', () => {
    const cells = [
      makeCell({ periodCode: '2023JJ00', value: 3.8 }),
      makeCell({ periodCode: '2024JJ00', value: 3.3, status: 'Voorlopig', provisional: true }),
    ];
    const spec = buildChartSpec(makeResult('series', cells))!;
    expect(spec.provisionalNote).toBe(PROVISIONAL_NOTE);
    const en = toEnglishChartSpec(spec);
    expect(en.provisionalNote).toBe(PROVISIONAL_NOTE_EN);

    const noProvisional = buildChartSpec(
      makeResult('series', [makeCell({ periodCode: '2023JJ00' }), makeCell({ periodCode: '2024JJ00' })]),
    )!;
    expect(toEnglishChartSpec(noProvisional).provisionalNote).toBeNull();
  });

  it('a null cell produces an English honest-gap note, region included on a multi-region chart', () => {
    const cells = [
      makeCell({ regionCode: 'PV26', regionLabel: 'Zuid-Holland', periodCode: '2024JJ00', value: 5 }),
      makeCell({ regionCode: 'PV24', regionLabel: 'Utrecht (PV)', periodCode: '2024JJ00', value: null, valueAttribute: 'Geheim' }),
    ];
    const spec = buildChartSpec(makeResult('comparison', cells))!;
    expect(spec.nullNotes).toHaveLength(1);
    expect(spec.nullNotes[0]).toBe('Geen waarde voor 2024 (Utrecht (PV)): Geheim (CBS).');
    const en = toEnglishChartSpec(spec);
    expect(en.nullNotes).toHaveLength(1);
    expect(en.nullNotes[0]).toBe('No value for 2024 (Utrecht (PV)): Geheim (CBS).');
  });

  it('a single-region null cell omits the region clause, same as the Dutch template', () => {
    const cells = [
      makeCell({ periodCode: '2020JJ00', value: 1.3 }),
      makeCell({ periodCode: '2021JJ00', value: null, valueAttribute: 'Geheim' }),
      makeCell({ periodCode: '2022JJ00', value: 10 }),
    ];
    const spec = buildChartSpec(makeResult('series', cells))!;
    const en = toEnglishChartSpec(spec);
    expect(en.nullNotes[0]).toBe('No value for 2021: Geheim (CBS).');
  });

  it('definitionLine: a known canonical definitionLabel becomes an English sentence', () => {
    const spec = buildChartSpec(
      makeResult(
        'series',
        [makeCell({ periodCode: '2023JJ00' }), makeCell({ periodCode: '2024JJ00' })],
        { definitionLabel: 'bevolking op 1 januari' },
      ),
    )!;
    expect(spec.definitionLine).toBe('Definitie: bevolking op 1 januari.');
    const en = toEnglishChartSpec(spec);
    expect(en.definitionLine).toBe('Definition: The population on 1 January.');
  });

  it('definitionLine: an unrecognised definitionLabel keeps the Dutch line (never guess)', () => {
    const spec = buildChartSpec(
      makeResult(
        'series',
        [makeCell({ periodCode: '2023JJ00' }), makeCell({ periodCode: '2024JJ00' })],
        { definitionLabel: 'consumentenprijsindex, jaarmutatie' },
      ),
    )!;
    const en = toEnglishChartSpec(spec);
    expect(en.definitionLine).toBe(spec.definitionLine);
    expect(en.definitionLine).toBe('Definitie: consumentenprijsindex, jaarmutatie.');
  });

  it('a spec with an unknown measure title keeps its Dutch title (never guess)', () => {
    const spec = buildChartSpec(makeResult('series', [makeCell({ periodCode: '2023JJ00' }), makeCell({ periodCode: '2024JJ00' })]))!;
    expect(spec.title).toBe('Testmaat'); // helpers.ts's default — not in MEASURE_TITLES
    const en = toEnglishChartSpec(spec);
    expect(en.title).toBe('Testmaat');
  });

  it('attributionLine and attribution.tableTitle are translated', () => {
    const spec = buildChartSpec(makeResult('series', [makeCell({ periodCode: '2023JJ00' }), makeCell({ periodCode: '2024JJ00' })]))!;
    const en = toEnglishChartSpec(spec);
    expect(en.attributionLine).toMatch(/^Source: /);
    expect(en.attributionLine).not.toBe(spec.attributionLine);
    // tableTitle 'Testtabel voor grafieken' (helpers.ts) is unseeded — stays
    // Dutch inside the translated skeleton, same never-guess contract.
    expect(en.attribution.tableTitle).toBe(spec.attribution.tableTitle);
    // Identical structural attribution fields.
    expect(en.attribution.tableId).toBe(spec.attribution.tableId);
    expect(en.attribution.tableVersion).toBe(spec.attribution.tableVersion);
    expect(en.attribution.syncedAt).toBe(spec.attribution.syncedAt);
    expect(en.attribution.coveredPeriods).toEqual(spec.attribution.coveredPeriods);
    expect(en.attribution.license).toBe(spec.attribution.license);
  });

  describe('trendHeadline', () => {
    function seriesWithDirection(definitionLabel: string) {
      const first = makeCell({ periodCode: '2023JJ00', value: 100 });
      const middle = makeCell({ periodCode: '2024JJ00', value: 110 });
      const last = makeCell({ periodCode: '2025JJ00', value: 120 });
      const direction: DerivationRecord = {
        kind: 'direction',
        explicit: false,
        sourceResultIds: [first.resultId, middle.resultId, last.resultId],
        unit: '%',
        marking: DERIVED_DATA_MARKING,
        direction: 'up',
        monotonic: true,
        netChange: 20,
        firstResultId: first.resultId,
        lastResultId: last.resultId,
      };
      return makeResult('series', [first, middle, last], { definitionLabel }, [direction]);
    }

    it('translates a known subject: "steeg gestaag" -> "rose steadily"', () => {
      const spec = buildChartSpec(seriesWithDirection('bevolking op 1 januari'))!;
      expect(spec.attribution.trendHeadline).toBe('Bevolking op 1 januari steeg gestaag sinds 2023.');
      const en = toEnglishChartSpec(spec);
      expect(en.attribution.trendHeadline).toBe('The population on 1 January rose steadily since 2023.');
    });

    it('an unrecognised subject keeps the Dutch subject word but still translates period/verb (best-effort, never invented)', () => {
      const spec = buildChartSpec(seriesWithDirection('bevolking'))!;
      expect(spec.attribution.trendHeadline).toBe('Bevolking steeg gestaag sinds 2023.');
      const en = toEnglishChartSpec(spec);
      expect(en.attribution.trendHeadline).toBe('Bevolking rose steadily since 2023.');
    });

    it('omits trendHeadline (no key at all) when the Dutch spec has none', () => {
      const spec = buildChartSpec(makeResult('series', [makeCell({ periodCode: '2023JJ00' }), makeCell({ periodCode: '2024JJ00' })]))!;
      expect('trendHeadline' in spec.attribution).toBe(false);
      const en = toEnglishChartSpec(spec);
      expect('trendHeadline' in en.attribution).toBe(false);
    });
  });

  it('annotations: labels have no English sibling table today and stay Dutch verbatim, periodCode identical', () => {
    const spec = buildChartSpec(makeResult('series', [makeCell({ periodCode: '2023JJ00' }), makeCell({ periodCode: '2024JJ00' })]))!;
    const withAnnotations: ChartSpec = {
      ...spec,
      annotations: [{ periodCode: '2023JJ00', label: 'Financiële crisis: val Lehman Brothers (september 2008)' }],
    };
    const en = toEnglishChartSpec(withAnnotations);
    expect(en.annotations).toEqual(withAnnotations.annotations);
    // Not the SAME array/object reference as the input.
    expect(en.annotations).not.toBe(withAnnotations.annotations);
    expect(en.annotations![0]).not.toBe(withAnnotations.annotations![0]);
  });

  it('a spec with no annotations key gets none on the English copy either', () => {
    const spec = buildChartSpec(makeResult('series', [makeCell({ periodCode: '2023JJ00' }), makeCell({ periodCode: '2024JJ00' })]))!;
    expect(spec.annotations).toBeUndefined();
    const en = toEnglishChartSpec(spec);
    expect('annotations' in en).toBe(false);
  });

  it('regionScope is carried over identical, present-vs-absent preserved', () => {
    const nullScopeSpec = buildChartSpec(
      makeResult('comparison', [makeCell({ regionCode: 'GM0363', value: 5 }), makeCell({ regionCode: 'GM0599', value: 3 })]),
    )!;
    expect(nullScopeSpec.regionScope).toBeNull();
    const en = toEnglishChartSpec(nullScopeSpec);
    expect('regionScope' in en).toBe(true);
    expect(en.regionScope).toBeNull();

    const noKeySpec = { ...nullScopeSpec } as ChartSpec;
    delete (noKeySpec as unknown as Record<string, unknown>).regionScope;
    expect('regionScope' in noKeySpec).toBe(false);
    const enNoKey = toEnglishChartSpec(noKeySpec);
    expect('regionScope' in enNoKey).toBe(false);
  });

  it('does not mutate its input (deep-equal to a structuredClone taken before the call)', () => {
    const spec = buildChartSpec(
      makeResult('series', [
        makeCell({ periodCode: '2023JJ00', value: 1.3 }),
        makeCell({ periodCode: '2024JJ00', value: null, valueAttribute: 'Geheim' }),
      ]),
    )!;
    const before = structuredClone(spec);
    const frozen = deepFreeze(spec);
    expect(() => toEnglishChartSpec(frozen)).not.toThrow();
    expect(frozen).toEqual(before);
  });

  it('returns a fresh object graph (no aliasing of nested arrays/objects with the input)', () => {
    const spec = buildChartSpec(
      makeResult('comparison', [makeCell({ regionCode: 'GM0363', value: 5 }), makeCell({ regionCode: 'GM0599', value: 3 })]),
    )!;
    const en = toEnglishChartSpec(spec);
    expect(en).not.toBe(spec);
    expect(en.series).not.toBe(spec.series);
    expect(en.series[0]).not.toBe(spec.series[0]);
    expect(en.series[0]!.points).not.toBe(spec.series[0]!.points);
    expect(en.series[0]!.points[0]).not.toBe(spec.series[0]!.points[0]);
    expect(en.dims).not.toBe(spec.dims);
    expect(en.dimLabels).not.toBe(spec.dimLabels);
    expect(en.attribution).not.toBe(spec.attribution);
    expect(en.attribution.coveredPeriods).not.toBe(spec.attribution.coveredPeriods);
  });

  it('digit-multiset invariance: no number is added or lost across a rich spec with every honesty field set', () => {
    const cells = [
      makeCell({
        regionCode: 'PV26',
        regionLabel: 'Zuid-Holland',
        periodCode: '2012KW01',
        periodLabel: '2012 1e kwartaal',
        value: 1234.5,
        decimals: 1,
        status: 'Voorlopig',
        provisional: true,
      }),
      makeCell({
        regionCode: 'PV24',
        regionLabel: 'Utrecht (PV)',
        periodCode: '2012KW01',
        periodLabel: '2012 1e kwartaal',
        value: null,
        valueAttribute: 'Geheim',
      }),
    ];
    const spec = buildChartSpec(makeResult('comparison', cells, { definitionLabel: 'bevolking op 1 januari' }))!;
    const en = toEnglishChartSpec(spec);
    expect(digitMultiset(en)).toEqual(digitMultiset(spec));
  });

  it('digit-multiset invariance holds on the trendHeadline fixture too', () => {
    const first = makeCell({ periodCode: '2023JJ00', value: 100 });
    const middle = makeCell({ periodCode: '2024JJ00', value: 110 });
    const last = makeCell({ periodCode: '2025JJ00', value: 120 });
    const direction: DerivationRecord = {
      kind: 'direction',
      explicit: false,
      sourceResultIds: [first.resultId, middle.resultId, last.resultId],
      unit: '%',
      marking: DERIVED_DATA_MARKING,
      direction: 'up',
      monotonic: true,
      netChange: 20,
      firstResultId: first.resultId,
      lastResultId: last.resultId,
    };
    const spec = buildChartSpec(
      makeResult('series', [first, middle, last], { definitionLabel: 'bevolking op 1 januari' }, [direction]),
    )!;
    const en = toEnglishChartSpec(spec);
    expect(digitMultiset(en)).toEqual(digitMultiset(spec));
  });
});
