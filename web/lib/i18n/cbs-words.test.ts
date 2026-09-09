// WP218 phase 4 (#219), Task 4 (design §4): the CBS word-list converters.
// Every converter is a hand-written table/regex over real CBS shapes — see
// cbs-words.ts's own header for the exact fixture citations — and every one
// must return its input UNCHANGED when nothing matches (never guess), which
// this file pins directly. The digit-invariance block at the bottom is the
// design's own R6 guard: a converter must never touch a numeric token.
import { describe, expect, it } from 'vitest';
import {
  translateAttributionLine,
  translateMeasureTitle,
  translatePeriodLabel,
  translateRegion,
  translateUnit,
} from './cbs-words.ts';

describe('translateUnit', () => {
  it('translates known CBS units (tests/fixtures/cbs/85773NED, 85224NED)', () => {
    expect(translateUnit('aantal')).toBe('number');
    expect(translateUnit('euro')).toBe('euros');
    expect(translateUnit('mln euro')).toBe('million euros');
  });

  it('translates the design\'s own examples', () => {
    expect(translateUnit('personen')).toBe('persons');
    expect(translateUnit('per 1 000 inwoners')).toBe('per 1 000 inhabitants');
  });

  it('leaves an already-neutral or unrecognised unit unchanged (never guess)', () => {
    expect(translateUnit('%')).toBe('%');
    expect(translateUnit('x 1 000')).toBe('x 1 000');
    expect(translateUnit('2025=100')).toBe('2025=100');
    expect(translateUnit('Coëfficiënt')).toBe('Coëfficiënt');
  });
});

describe('translateRegion', () => {
  it('translates Nederland and the provinces with an English exonym', () => {
    expect(translateRegion('Nederland')).toBe('the Netherlands');
    expect(translateRegion('Noord-Holland')).toBe('North Holland');
    expect(translateRegion('Zuid-Holland')).toBe('South Holland');
    expect(translateRegion('Noord-Brabant')).toBe('North Brabant');
  });

  it('leaves a province with no English exonym unchanged', () => {
    expect(translateRegion('Friesland')).toBe('Friesland');
    expect(translateRegion('Utrecht')).toBe('Utrecht');
    expect(translateRegion('Limburg')).toBe('Limburg');
  });

  it('never changes a municipality (no table entry — falls through)', () => {
    expect(translateRegion('Amsterdam')).toBe('Amsterdam');
    expect(translateRegion('Groningen')).toBe('Groningen');
  });
});

describe('translateMeasureTitle', () => {
  it('translates the five Ontdek curated titles (src/chart/curated.ts, src/registry/defaults.ts measureTitle)', () => {
    expect(translateMeasureTitle('Consumentenvertrouwen')).toBe('Consumer confidence');
    expect(translateMeasureTitle('Bruto binnenlands product')).toBe('Gross domestic product');
    expect(translateMeasureTitle('Jaarmutatie CPI')).toBe('Annual change in CPI');
    expect(translateMeasureTitle('Gemiddelde verkoopprijs')).toBe('Average sale price');
    expect(translateMeasureTitle('Werkloosheidspercentage')).toBe('Unemployment rate');
  });

  it('leaves an unseeded title unchanged (never guess)', () => {
    expect(translateMeasureTitle('Een onbekende titel')).toBe('Een onbekende titel');
  });
});

describe('translatePeriodLabel', () => {
  it('translates the real CBS quarter shape (tests/fixtures/cbs/85615NED/codes-Perioden.json)', () => {
    expect(translatePeriodLabel('2021 1e kwartaal')).toBe('2021 Q1');
    expect(translatePeriodLabel('2012 4e kwartaal')).toBe('2012 Q4');
  });

  it('translates the real CBS month shape (tests/fixtures/cbs/83693NED/codes-Perioden.json)', () => {
    expect(translatePeriodLabel('1987 januari')).toBe('January 1987');
    expect(translatePeriodLabel('2024 december')).toBe('December 2024');
  });

  it('leaves a bare year unchanged (already identical in English)', () => {
    expect(translatePeriodLabel('2021')).toBe('2021');
  });

  it('leaves an unrecognised shape unchanged, e.g. a provisional-marked label (never guess)', () => {
    expect(translatePeriodLabel('2024*')).toBe('2024*');
    expect(translatePeriodLabel('2021 t/m 2023')).toBe('2021 t/m 2023');
  });
});

describe('translateAttributionLine', () => {
  const nl =
    'Bron: CBS StatLine, tabel 83693NED — Consumentenvertrouwen. Gegevens gesynchroniseerd op 2026-09-01. Periode: 2021 1e kwartaal. Licentie: CC BY 4.0.';

  it('rewrites the fixed skeleton words, keeping id/date/title/period/licence byte-identical', () => {
    expect(translateAttributionLine(nl)).toBe(
      'Source: CBS StatLine, table 83693NED — Consumentenvertrouwen. Data synced on 2026-09-01. Period: 2021 1e kwartaal. License: CC BY 4.0.',
    );
  });

  it('handles a single-period line (from === to, no "t/m" in the period text)', () => {
    const single =
      'Bron: CBS StatLine, tabel 85773NED — Gemiddelde verkoopprijs. Gegevens gesynchroniseerd op 2026-01-15. Periode: 2024. Licentie: CC BY 4.0.';
    expect(translateAttributionLine(single)).toBe(
      'Source: CBS StatLine, table 85773NED — Gemiddelde verkoopprijs. Data synced on 2026-01-15. Period: 2024. License: CC BY 4.0.',
    );
  });

  it('leaves a line that does not match the exact template unchanged (never guess)', () => {
    expect(translateAttributionLine('iets heel anders')).toBe('iets heel anders');
    expect(translateAttributionLine('')).toBe('');
  });
});

describe('digit invariance (design §4: a converter never touches a numeric token)', () => {
  const converters: [string, (s: string) => string][] = [
    ['translateUnit', translateUnit],
    ['translateRegion', translateRegion],
    ['translateMeasureTitle', translateMeasureTitle],
    ['translatePeriodLabel', translatePeriodLabel],
    ['translateAttributionLine', translateAttributionLine],
  ];
  const samples = [
    'aantal',
    'euro',
    'per 1 000 inwoners',
    '2025=100',
    'Nederland',
    'Noord-Holland',
    'Amsterdam',
    'Consumentenvertrouwen',
    'Een onbekende titel met 42 in de tekst',
    '2021 1e kwartaal',
    '1987 januari',
    '2021',
    '2024*',
    'Bron: CBS StatLine, tabel 83693NED — Consumentenvertrouwen. Gegevens gesynchroniseerd op 2026-09-01. Periode: 2021 1e kwartaal. Licentie: CC BY 4.0.',
    'iets heel anders met 7 cijfers',
  ];

  for (const [name, fn] of converters) {
    it(`${name} never adds, drops or changes a digit token`, () => {
      for (const input of samples) {
        const output = fn(input);
        expect(output.match(/\d[\d.,]*/g)).toEqual(input.match(/\d[\d.,]*/g));
      }
    });
  }
});

describe('translatePeriodLabel — cumulative partial year (P4 task-4 review gap)', () => {
  it('translates a month range and keeps every digit', () => {
    expect(translatePeriodLabel('2026 januari-april')).toBe('2026 January-April');
    expect(translatePeriodLabel('2026 januari-april').match(/\d[\d.,]*/g)).toEqual(['2026']);
    expect(translatePeriodLabel('2026 januari-x')).toBe('2026 januari-x');
  });
});
