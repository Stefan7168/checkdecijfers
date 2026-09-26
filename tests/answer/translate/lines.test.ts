// ADR 058 (English answers, Task 5): the hand-written English structural
// lines and staleness warning. None of this is model output — every function
// here is pure over a ValidatedResult (+ already-translated definition/
// alternate text for the two lines that need it), mirroring the Dutch
// builders in src/answer/compose/format.ts exactly in structure, null-ness
// and ordering (never rewording — principle a). The digit-invariance checks
// below are the same discipline mask.ts and english-names.ts already pin:
// every digit run the English line shows must also appear in the Dutch line
// it mirrors, so a translation can never silently change a data-bearing
// number.
import { describe, expect, it } from 'vitest';
import type { RegionSeriesCoverage, RegionSetCoverage, ValidatedResult } from '../../../src/query/index.ts';
import {
  buildAssumptionLine,
  buildAttributionLine,
  buildDefinitionLine,
  buildRegionSeriesLine,
  buildRegionSetLine,
} from '../../../src/answer/compose/format.ts';
import {
  assembleEnglishText,
  buildEnglishLines,
  dutchAlternateLabels,
  dutchDefinitionContent,
  translateStalenessWarning,
  type EnglishLines,
} from '../../../src/answer/translate/lines.ts';
import { cpiSeries, makeCell, makeResult, populationSingle } from '../../helpers/synthetic-results.ts';

/** Every digit run in `s`, sorted — the shared invariance check. */
function digitRuns(s: string): string[] {
  return (s.match(/\d+/g) ?? []).sort();
}

// ---------------------------------------------------------------------------
// dutchDefinitionContent
// ---------------------------------------------------------------------------

describe('dutchDefinitionContent', () => {
  it('is null when buildDefinitionLine is null (circular definitionLabel === measureTitle)', () => {
    const result = makeResult({
      shape: 'single',
      definitionLabel: 'Bevolking',
      cells: [
        makeCell({
          measureTitle: 'Bevolking',
          region: { code: 'NL01', label: 'Nederland' },
          periodCode: '2025JJ00', periodLabel: '2025', value: 1, unit: 'aantal',
        }),
      ],
    });
    expect(dutchDefinitionContent(result)).toBeNull();
  });

  it('strips the leading label and the terminal period', () => {
    const result = makeResult({
      shape: 'single',
      definitionLabel: 'woningvoorraad per 1 januari',
      cells: [
        makeCell({
          measureTitle: 'Beginstand voorraad',
          periodCode: '2024JJ00', periodLabel: '2024', value: 1, unit: 'aantal',
        }),
      ],
    });
    expect(buildDefinitionLine(result)).toBe('Definitie: woningvoorraad per 1 januari.');
    expect(dutchDefinitionContent(result)).toBe('woningvoorraad per 1 januari');
  });
});

// ---------------------------------------------------------------------------
// dutchAlternateLabels
// ---------------------------------------------------------------------------

describe('dutchAlternateLabels', () => {
  it('is empty when the attribution carries no alternates key (A1)', () => {
    expect(dutchAlternateLabels(populationSingle)).toEqual([]);
  });

  it('is the exact label list buildAlternatesLine would join', () => {
    const result = makeResult({
      shape: 'single',
      definitionLabel: 'woningvoorraad per 1 januari',
      alternates: [{ measure: 'D002968', label: 'stand per 31 december (Eindstand Voorraad)' }],
      cells: [
        makeCell({
          table: '82235NED', measure: 'D002936', measureTitle: 'Beginstand voorraad',
          periodCode: '2024JJ00', periodLabel: '2024', value: 1, unit: 'aantal',
        }),
      ],
    });
    expect(dutchAlternateLabels(result)).toEqual(['stand per 31 december (Eindstand Voorraad)']);
  });
});

// ---------------------------------------------------------------------------
// buildEnglishLines: assumptionLine
// ---------------------------------------------------------------------------

describe('buildEnglishLines: assumptionLine', () => {
  it('is null when neither axis was defaulted', () => {
    const lines = buildEnglishLines(populationSingle, { definition: null, alternates: [] });
    expect(lines.assumptionLine).toBeNull();
  });

  it('states the national-figure disclosure when the region was defaulted', () => {
    const result = { ...populationSingle, regionDefaulted: true };
    const lines = buildEnglishLines(result, { definition: null, alternates: [] });
    expect(lines.assumptionLine).toBe(
      'This is the national figure for the Netherlands as a whole. ' +
        'Name a municipality or province in your question if you want a specific region.',
    );
    expect(digitRuns(lines.assumptionLine!)).toEqual(digitRuns(buildAssumptionLine(result)!));
  });

  it('states the recent-window disclosure, naming the last served period, when the period was defaulted', () => {
    const result = { ...cpiSeries(), periodDefaulted: true };
    const lines = buildEnglishLines(result, { definition: null, alternates: [] });
    expect(lines.assumptionLine).toBe(
      'This is the development over recent years, up to 2024. ' +
        'Feel free to ask for only the latest figure or for a different period.',
    );
    expect(digitRuns(lines.assumptionLine!)).toEqual(digitRuns(buildAssumptionLine(result)!));
  });
});

// ---------------------------------------------------------------------------
// buildEnglishLines: regionSetLine
// ---------------------------------------------------------------------------

function regionSetResult(): ValidatedResult {
  const served = makeCell({
    table: '84720NED', measureTitle: 'Bevolking',
    region: { code: 'PV19', label: 'Utrecht' },
    periodCode: '2025JJ00', periodLabel: '2025', value: 100, unit: 'aantal',
  });
  const notApplicable = makeCell({
    table: '84720NED', measureTitle: 'Bevolking',
    region: { code: 'PV20', label: 'Zuid-Holland' },
    periodCode: '2025JJ00', periodLabel: '2025', value: null, unit: 'aantal', valueAttribute: 'Impossible',
  });
  const withheld = makeCell({
    table: '84720NED', measureTitle: 'Bevolking',
    region: { code: 'PV21', label: 'Noord-Brabant' },
    periodCode: '2025JJ00', periodLabel: '2025', value: null, unit: 'aantal', valueAttribute: 'Geheim',
  });
  const coverage: RegionSetCoverage = {
    scope: { kind: 'all_provincies' },
    rosterSize: 4,
    notApplicable: ['PV20'],
    withheld: ['PV21'],
    missing: ['PV22'],
    complete: false,
  };
  return { ...makeResult({ shape: 'single', cells: [served, notApplicable, withheld] }), regionSet: coverage };
}

describe('buildEnglishLines: regionSetLine', () => {
  it('is null when the result carries no regionSet coverage', () => {
    const lines = buildEnglishLines(populationSingle, { definition: null, alternates: [] });
    expect(lines.regionSetLine).toBeNull();
  });

  it('mirrors every clause of the Dutch coverage disclosure, translating named members', () => {
    const result = regionSetResult();
    const lines = buildEnglishLines(result, { definition: null, alternates: [] });
    expect(lines.regionSetLine).toBe(
      'Coverage: 1 of the 4 provinces have a figure. ' +
        '1 province did not exist in this period according to CBS (South Holland). ' +
        'CBS publishes no value for 1 province (North Brabant). ' +
        'We have no figure in our database for 1 province (PV22). ' +
        'That is why this answer gives no ranking.',
    );
    expect(digitRuns(lines.regionSetLine!)).toEqual(digitRuns(buildRegionSetLine(result)!));
  });
});

// ---------------------------------------------------------------------------
// buildEnglishLines: regionSeriesLine
// ---------------------------------------------------------------------------

function regionSeriesResult(): ValidatedResult {
  const points: [string, string, number | null][] = [
    ['2020JJ00', '2020', 1], ['2021JJ00', '2021', null], ['2022JJ00', '2022', 3],
  ];
  const cells = points.map(([code, label, value]) =>
    makeCell({
      table: '84720NED', measureTitle: 'Bevolking',
      region: { code: 'GM0001', label: 'Noord-Brabant' },
      periodCode: code, periodLabel: label, value, unit: 'aantal',
      ...(value === null ? { valueAttribute: 'Geheim' } : {}),
    }),
  );
  const coverage: RegionSeriesCoverage = {
    requested: ['GM0001', 'GM0002'],
    partial: ['GM0001'],
    excluded: ['GM0002'],
    complete: false,
  };
  return { ...makeResult({ shape: 'series', cells }), regionSeries: coverage };
}

describe('buildEnglishLines: regionSeriesLine', () => {
  it('is null when the series coverage is complete or absent', () => {
    const lines = buildEnglishLines(populationSingle, { definition: null, alternates: [] });
    expect(lines.regionSeriesLine).toBeNull();
  });

  it('mirrors both the partial-region and the excluded-region clauses', () => {
    const result = regionSeriesResult();
    const lines = buildEnglishLines(result, { definition: null, alternates: [] });
    expect(lines.regionSeriesLine).toBe(
      'For North Brabant a figure is missing in 1 of the 3 requested years; ' +
        'that is why this answer gives no development for that region. ' +
        'This answer says nothing about GM0002: our database lacks figures for ' +
        'one or more of the requested years.',
    );
    expect(digitRuns(lines.regionSeriesLine!)).toEqual(digitRuns(buildRegionSeriesLine(result)!));
  });
});

// ---------------------------------------------------------------------------
// buildEnglishLines: definitionLine
// ---------------------------------------------------------------------------

describe('buildEnglishLines: definitionLine', () => {
  it('is null when the translated definition is null', () => {
    const lines = buildEnglishLines(populationSingle, { definition: null, alternates: [] });
    expect(lines.definitionLine).toBeNull();
  });

  it('adds a terminal period when the translated text has none', () => {
    const lines = buildEnglishLines(populationSingle, {
      definition: 'the housing stock as of 1 January',
      alternates: [],
    });
    expect(lines.definitionLine).toBe('Definition: the housing stock as of 1 January.');
  });

  it('does not double a terminal period the translated text already has', () => {
    const lines = buildEnglishLines(populationSingle, { definition: 'a test phrase.', alternates: [] });
    expect(lines.definitionLine).toBe('Definition: a test phrase.');
  });
});

// ---------------------------------------------------------------------------
// buildEnglishLines: alternatesLine
// ---------------------------------------------------------------------------

describe('buildEnglishLines: alternatesLine', () => {
  it('is null when there are no translated alternates', () => {
    const lines = buildEnglishLines(populationSingle, { definition: null, alternates: [] });
    expect(lines.alternatesLine).toBeNull();
  });

  it('states a single alternate', () => {
    const lines = buildEnglishLines(populationSingle, { definition: null, alternates: ['end-of-year stock'] });
    expect(lines.alternatesLine).toBe('Another reading is also available: end-of-year stock.');
  });

  it('joins several alternates with a semicolon', () => {
    const lines = buildEnglishLines(populationSingle, {
      definition: null,
      alternates: ['gross income', 'standardised income', 'primary income'],
    });
    expect(lines.alternatesLine).toBe(
      'Other readings are also available: gross income; standardised income; primary income.',
    );
  });
});

// ---------------------------------------------------------------------------
// buildEnglishLines: markingLine
// ---------------------------------------------------------------------------

describe('buildEnglishLines: markingLine', () => {
  it('is null for a plain lookup (no derivations)', () => {
    const lines = buildEnglishLines(populationSingle, { definition: null, alternates: [] });
    expect(lines.markingLine).toBeNull();
  });

  it('states the derived-data marking for a result with derivations', () => {
    const lines = buildEnglishLines(cpiSeries(), { definition: null, alternates: [] });
    expect(lines.markingLine).toBe('— adaptation of CBS data by checkdecijfers.nl');
  });
});

// ---------------------------------------------------------------------------
// buildEnglishLines: attributionLine (always non-null)
// ---------------------------------------------------------------------------

describe('buildEnglishLines: attributionLine', () => {
  it('translates the table title and a single period, CBS shape', () => {
    const result = makeResult({
      shape: 'single',
      cells: [
        makeCell({
          table: '82235NED', measureTitle: 'Beginstand voorraad',
          periodCode: '2024JJ00', periodLabel: '2024', value: 8204, unit: 'x 1 000',
        }),
      ],
    });
    result.attribution.tableTitle = 'Voorraad woningen; standen en mutaties vanaf 1921';
    const dutch = buildAttributionLine(result);
    expect(dutch).toBe(
      'Bron: CBS StatLine, tabel 82235NED — Voorraad woningen; standen en mutaties vanaf 1921. ' +
        'Gegevens gesynchroniseerd op 2026-07-02. Periode: 2024. Licentie: CC BY 4.0.',
    );
    const lines = buildEnglishLines(result, { definition: null, alternates: [] });
    expect(lines.attributionLine).toBe(
      'Source: CBS StatLine, table 82235NED — Housing stock; levels and changes since 1921. ' +
        'Data synced on 2026-07-02. Period: 2024. License: CC BY 4.0.',
    );
    expect(digitRuns(lines.attributionLine)).toEqual(digitRuns(dutch));
  });

  it('translates a quarter period label', () => {
    const result = makeResult({
      shape: 'single',
      cells: [
        makeCell({
          table: '85224NED', measureTitle: 'Werkloosheidspercentage',
          periodCode: '2025KW04', periodLabel: '2025 4e kwartaal', value: 4.0, unit: '%', decimals: 1,
        }),
      ],
    });
    const dutch = buildAttributionLine(result);
    const lines = buildEnglishLines(result, { definition: null, alternates: [] });
    expect(lines.attributionLine).toMatch(/Period: 2025 Q4\./);
    expect(digitRuns(lines.attributionLine)).toEqual(digitRuns(dutch));
  });

  it('translates a period range with "to"', () => {
    const result = cpiSeries();
    const dutch = buildAttributionLine(result);
    expect(dutch).toMatch(/Periode: 2020 t\/m 2024\./);
    const lines = buildEnglishLines(result, { definition: null, alternates: [] });
    expect(lines.attributionLine).toMatch(/Period: 2020 to 2024\./);
    expect(digitRuns(lines.attributionLine)).toEqual(digitRuns(dutch));
  });

  it('renders the Eurostat shape with an untranslated (already-English) title and a DOI clause', () => {
    const result = makeResult({
      shape: 'single',
      cells: [
        makeCell({
          table: 'eurostat:demo_pjan', measureTitle: 'Population',
          periodCode: '2024JJ00', periodLabel: '2024', value: 1, unit: 'aantal',
        }),
      ],
    });
    result.attribution.source = 'eurostat';
    result.attribution.tableTitle = 'Population on 1 January by age and sex';
    result.attribution.doi = '10.2908/DEMO_PJAN';
    const dutch = buildAttributionLine(result);
    expect(dutch).toBe(
      'Bron: Eurostat, dataset demo_pjan — Population on 1 January by age and sex (DOI 10.2908/DEMO_PJAN). ' +
        'Gegevens gesynchroniseerd op 2026-07-02. Licentie: CC BY 4.0.',
    );
    const lines = buildEnglishLines(result, { definition: null, alternates: [] });
    expect(lines.attributionLine).toBe(
      'Source: Eurostat, dataset demo_pjan — Population on 1 January by age and sex (DOI 10.2908/DEMO_PJAN). ' +
        'Data synced on 2026-07-02. License: CC BY 4.0.',
    );
    expect(digitRuns(lines.attributionLine)).toEqual(digitRuns(dutch));
  });

  it('renders the Eurostat shape with no DOI clause when doi is absent', () => {
    const result = makeResult({
      shape: 'single',
      cells: [
        makeCell({
          table: 'eurostat:demo_pjan', measureTitle: 'Population',
          periodCode: '2024JJ00', periodLabel: '2024', value: 1, unit: 'aantal',
        }),
      ],
    });
    result.attribution.source = 'eurostat';
    result.attribution.tableTitle = 'Population on 1 January by age and sex';
    const lines = buildEnglishLines(result, { definition: null, alternates: [] });
    expect(lines.attributionLine).not.toContain('DOI');
  });
});

// ---------------------------------------------------------------------------
// translateStalenessWarning
// ---------------------------------------------------------------------------

describe('translateStalenessWarning', () => {
  it('translates the plain (never-reconfirmed-by-us) shape', () => {
    const dutch =
      'Let op: deze tabel wordt normaal maandelijks bijgewerkt door CBS, ' +
      'maar onze laatste synchronisatie was op 2026-08-01 — recentere cijfers kunnen inmiddels beschikbaar zijn.';
    expect(translateStalenessWarning(dutch)).toBe(
      'Note: CBS normally updates this table monthly, but our last sync was on 2026-08-01 — ' +
        'more recent figures may now be available.',
    );
  });

  it('translates the retained-cell shape, for each cadence word', () => {
    const dutch =
      'Let op: deze tabel wordt normaal jaarlijks bijgewerkt door CBS, ' +
      'maar een deel van deze cijfers is door CBS sinds 2026-01-15 niet opnieuw bevestigd — ' +
      'recentere cijfers kunnen inmiddels beschikbaar zijn.';
    expect(translateStalenessWarning(dutch)).toBe(
      'Note: CBS normally updates this table yearly, but part of these figures has not been reconfirmed ' +
        'by CBS since 2026-01-15 — more recent figures may now be available.',
    );
  });

  it('translates the quarterly cadence word', () => {
    const dutch =
      'Let op: deze tabel wordt normaal per kwartaal bijgewerkt door CBS, ' +
      'maar onze laatste synchronisatie was op 2026-05-01 — recentere cijfers kunnen inmiddels beschikbaar zijn.';
    expect(translateStalenessWarning(dutch)).toContain('updates this table quarterly');
  });

  it('is null for an unrecognized cadence word inside an otherwise-matching shape', () => {
    const dutch =
      'Let op: deze tabel wordt normaal tweewekelijks bijgewerkt door CBS, ' +
      'maar onze laatste synchronisatie was op 2026-08-01 — recentere cijfers kunnen inmiddels beschikbaar zijn.';
    expect(translateStalenessWarning(dutch)).toBeNull();
  });

  it('is null for text that matches neither known shape', () => {
    expect(translateStalenessWarning('Something else entirely.')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// assembleEnglishText
// ---------------------------------------------------------------------------

describe('assembleEnglishText', () => {
  const lines: EnglishLines = {
    assumptionLine: 'ASSUMPTION',
    regionSetLine: 'REGIONSET',
    regionSeriesLine: 'REGIONSERIES',
    definitionLine: 'DEFINITION',
    alternatesLine: 'ALTERNATES',
    markingLine: 'MARKING',
    attributionLine: 'ATTRIBUTION',
  };

  it('joins every present line, in the same order as compose.ts assemble()', () => {
    expect(assembleEnglishText('BODY', lines, null)).toBe(
      ['BODY', '', 'ASSUMPTION', 'REGIONSET', 'REGIONSERIES', 'DEFINITION', 'ALTERNATES', 'MARKING', 'ATTRIBUTION'].join(
        '\n',
      ),
    );
  });

  it('omits null structural lines, keeping the mandatory attribution line', () => {
    const sparse: EnglishLines = {
      assumptionLine: null,
      regionSetLine: null,
      regionSeriesLine: null,
      definitionLine: null,
      alternatesLine: null,
      markingLine: null,
      attributionLine: 'ATTRIBUTION',
    };
    expect(assembleEnglishText('BODY', sparse, null)).toBe(['BODY', '', 'ATTRIBUTION'].join('\n'));
  });

  it('appends the staleness warning after a blank line when present', () => {
    const sparse: EnglishLines = {
      assumptionLine: null,
      regionSetLine: null,
      regionSeriesLine: null,
      definitionLine: null,
      alternatesLine: null,
      markingLine: null,
      attributionLine: 'ATTRIBUTION',
    };
    expect(assembleEnglishText('BODY', sparse, 'WARNING')).toBe(
      ['BODY', '', 'ATTRIBUTION'].join('\n') + '\n\nWARNING',
    );
  });
});
