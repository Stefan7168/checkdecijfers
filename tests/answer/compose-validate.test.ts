// WP7 validator unit tests — docs/05 R3 ("Unit-tested with seeded mismatches
// including word-form fabrications"), R9 (incl. the correct-prose fixtures:
// "false positives are bugs too"), R10, R11.
import { describe, expect, it } from 'vitest';
import {
  findNumericTokens,
  formatValueNl,
  parseNlNumber,
  scanBody,
  validateAnswerBody,
} from '../../src/answer/compose/index.ts';
import {
  cpiSeries,
  makeCell,
  makeResult,
  g4Max,
  housingSingle,
  incomeSingle,
  inflationDrop,
  makeHomePriceSeries,
  nullCellSingle,
  populationComparison,
  populationDifference,
  populationSingle,
  solarSingle,
  unemploymentSingle,
} from '../helpers/synthetic-results.ts';

describe('Dutch number formatting and parsing (R3 canonicalization)', () => {
  it('formats Dutch-locale values from CBS decimals metadata', () => {
    expect(formatValueNl(18044027, 0)).toBe('18.044.027');
    expect(formatValueNl(3.3, 1)).toBe('3,3');
    expect(formatValueNl(10, 1)).toBe('10,0');
    expect(formatValueNl(8204, 0)).toBe('8.204');
    expect(formatValueNl(-101085, 0)).toBe('-101.085');
    expect(formatValueNl(1.9999999999999998, 1)).toBe('2,0');
  });

  it('parses tokens back to the same value (round-trip)', () => {
    for (const [value, decimals] of [[18044027, 0], [3.3, 1], [450985, 0], [57.6, 1]] as const) {
      expect(parseNlNumber(formatValueNl(value, decimals))).toBeCloseTo(value, 9);
    }
  });

  it('tokenizes grouped numbers whole, not per group', () => {
    const tokens = findNumericTokens('van 17.942.942 naar 18.044.027 (3,3%) in 2024');
    expect(tokens.map((t) => t.value)).toEqual([17942942, 18044027, 3.3, 2024]);
  });
});

describe('R3: verbatim numbers, digit form', () => {
  it('accepts a correct single-value answer', () => {
    const report = validateAnswerBody('De bevolking op 1 januari in Nederland was in 2025 18.044.027 inwoners.', populationSingle);
    expect(report.problems).toEqual([]);
  });

  it('rejects a single altered digit', () => {
    const report = validateAnswerBody('De bevolking op 1 januari in Nederland was in 2025 18.044.028 inwoners.', populationSingle);
    expect(report.problems.some((p) => p.includes("'18.044.028'"))).toBe(true);
  });

  it('rejects a rounded value (rounding only via registered derivations)', () => {
    const report = validateAnswerBody('Nederland telde in 2025 ongeveer 18.000.000 inwoners.', populationSingle);
    expect(report.ok).toBe(false);
  });

  it('rejects word-form fabrications ("achttien miljoen", "een kwart", "verdubbeld")', () => {
    for (const body of [
      'Nederland telde in 2025 ruim achttien miljoen inwoners.',
      'De werkloosheid bedroeg in 2025 4e kwartaal een kwart minder.',
      'De prijs is in 2024 verdubbeld.',
    ]) {
      const report = validateAnswerBody(body, populationSingle);
      expect(report.ok, body).toBe(false);
    }
  });

  it('rejects an answer that shows no validated value at all', () => {
    const report = validateAnswerBody('Daar is geen eenduidig antwoord op te geven.', populationSingle);
    expect(report.problems.some((p) => p.includes('geen enkele gevalideerde waarde'))).toBe(true);
  });

  it('does not read factor-unit digits as data claims (masking)', () => {
    const report = validateAnswerBody('De woningvoorraad per 1 januari was in 2024 8.204 (x 1 000).', housingSingle);
    expect(report.problems).toEqual([]);
  });
});

describe('R10: unit adjacency', () => {
  it('accepts % and rejects procentpunt next to a level', () => {
    expect(validateAnswerBody('Het werkloosheidspercentage was in 2025 4e kwartaal 4,0%.', unemploymentSingle).problems).toEqual([]);
    const wrong = validateAnswerBody('Het werkloosheidspercentage was in 2025 4e kwartaal 4,0 procentpunt.', unemploymentSingle);
    expect(wrong.ok).toBe(false);
  });

  it('requires procentpunt (not %) on a difference between %-levels', () => {
    const ok = validateAnswerBody('De inflatie daalde van 3,8% in 2023 naar 3,3% in 2024, een afname van 0,5 procentpunt.', inflationDrop());
    expect(ok.problems).toEqual([]);
    const wrong = validateAnswerBody('De inflatie daalde in 2024 met 0,5%, van 3,8% in 2023 naar 3,3% in 2024.', inflationDrop());
    expect(wrong.problems.some((p) => p.includes('procentpunt'))).toBe(true);
  });

  it('requires the verbatim factor unit — the ×1.000 misreading guard', () => {
    const okHousing = validateAnswerBody('De woningvoorraad per 1 januari was in 2024 8.204 x 1 000 woningen.', housingSingle);
    expect(okHousing.problems).toEqual([]);
    const bare = validateAnswerBody('Nederland telde in 2024 zo’n 8.204 woningen.', housingSingle);
    expect(bare.ok).toBe(false);

    const okIncome = validateAnswerBody('Het gemiddeld besteedbaar inkomen was in 2023 57,6 (× 1 000 euro).', incomeSingle);
    expect(okIncome.problems).toEqual([]);
    const wrongIncome = validateAnswerBody('Het gemiddeld besteedbaar inkomen was in 2023 57,6 euro.', incomeSingle);
    expect(wrongIncome.ok).toBe(false);
  });

  it('requires euro next to euro values and the verbatim unit otherwise', () => {
    const solarOk = validateAnswerBody('In 2024 werd 21.822 mln kWh zonnestroom opgewekt (voorlopig cijfer).', solarSingle);
    expect(solarOk.problems).toEqual([]);
    const solarWrong = validateAnswerBody('In 2024 werd 21.822 kWh zonnestroom opgewekt (voorlopig cijfer).', solarSingle);
    expect(solarWrong.ok).toBe(false);
  });
});

describe('R9: semantic binding', () => {
  it('accepts values bound to their own region and rejects swapped regions', () => {
    const result = populationComparison();
    const ok = validateAnswerBody('Amsterdam telde in 2024 931.298 inwoners en Rotterdam 670.610.', result);
    expect(ok.problems).toEqual([]);
    const swapped = validateAnswerBody('Rotterdam telde in 2024 931.298 inwoners. Amsterdam telde 670.610 inwoners.', result);
    expect(swapped.ok).toBe(false);
  });

  it('requires each series value in a sentence with its period', () => {
    const result = cpiSeries();
    const ok = validateAnswerBody('De inflatie was 1,3% in 2020 en 3,3% in 2024.', result);
    expect(ok.problems).toEqual([]);
    const wrongYear = validateAnswerBody('De inflatie was 10,0% in 2020.', result);
    expect(wrongYear.ok).toBe(false);
  });

  it('rejects a wrong year even when the number is right (period binding)', () => {
    const report = validateAnswerBody('De bevolking op 1 januari in Nederland was in 2024 18.044.027 inwoners.', populationSingle);
    expect(report.ok).toBe(false);
  });
});

describe('R9: direction, superlative and comparison words', () => {
  it('accepts honest trend prose on a series (correct-prose fixture)', () => {
    const body =
      'De inflatie steeg per saldo van 1,3% in 2020 naar 3,3% in 2024, maar niet in een rechte lijn: in 2022 piekte zij op 10,0% en in 2023 daalde zij naar 3,8%.';
    expect(validateAnswerBody(body, cpiSeries()).problems).toEqual([]);
  });

  it('rejects a net-direction claim that contradicts the derivation', () => {
    const body = 'De inflatie daalde van 1,3% in 2020 naar 3,3% in 2024.';
    expect(validateAnswerBody(body, cpiSeries()).ok).toBe(false);
  });

  it('rejects a sub-period direction claim that contradicts that step', () => {
    const body = 'De inflatie was 10,0% in 2022. In 2023 steeg de inflatie naar 3,8%.';
    expect(validateAnswerBody(body, cpiSeries()).ok).toBe(false);
  });

  it('rejects trend words on a result without any trend derivation', () => {
    const body = 'De bevolking op 1 januari in Nederland was in 2025 18.044.027 inwoners, een stijging.';
    expect(validateAnswerBody(body, populationSingle).ok).toBe(false);
  });

  it('binds "meer dan" to the ranking: right order passes, wrong order fails', () => {
    const result = populationComparison();
    const ok = validateAnswerBody('Amsterdam had in 2024 met 931.298 inwoners meer inwoners dan Rotterdam (670.610).', result);
    expect(ok.problems).toEqual([]);
    const wrong = validateAnswerBody('Rotterdam had in 2024 met 670.610 inwoners meer inwoners dan Amsterdam (931.298).', result);
    expect(wrong.ok).toBe(false);
  });

  it('requires the ranking winner in a superlative sentence', () => {
    const result = g4Max();
    const ok = validateAnswerBody(
      'Van de 4 gemeenten had Amsterdam in 2025 de meeste inwoners: 934.526. Daarna: Rotterdam 672.960; ’s-Gravenhage 568.945; Utrecht 376.757.',
      result,
    );
    expect(ok.problems).toEqual([]);
    const wrong = validateAnswerBody(
      'Van de 4 gemeenten had Rotterdam in 2025 de meeste inwoners: 934.526. Daarna: Amsterdam 672.960; ’s-Gravenhage 568.945; Utrecht 376.757.',
      result,
    );
    expect(wrong.ok).toBe(false);
  });

  it('accepts honest prose from the first live run (regression: false positives found 2026-07-03)', () => {
    // B8 attempt 1: a year range must not tokenize as a negative number, and
    // 'ten opzichte van' marks the base year of a sub-period step.
    const b8 = 'In de periode 2019-2024 steeg de gemiddelde verkoopprijs van 307.978 euro naar 450.985 euro. In 2023 daalde de gemiddelde verkoopprijs ten opzichte van 2022.';
    const series = makeHomePriceSeries();
    expect(validateAnswerBody(b8, series).problems).toEqual([]);
    // B4 attempt 1: both direction families in one clause of a non-monotonic
    // series — both movements factually occurred.
    const b4 = 'De inflatie bedroeg 1,3% in 2020, 2,7% in 2021, 10,0% in 2022, 3,8% in 2023 en 3,3% in 2024: na de stijging naar 10,0% in 2022 daalde de inflatie in de jaren daarna weer.';
    expect(validateAnswerBody(b4, cpiSeries()).problems).toEqual([]);
  });

  it('still rejects a net-direction lie phrased as a span ("daalde tussen 2020 en 2024")', () => {
    expect(validateAnswerBody('De inflatie daalde tussen 2020 en 2024.', cpiSeries()).ok).toBe(false);
    expect(validateAnswerBody('De inflatie is sinds 2020 gedaald.', cpiSeries()).ok).toBe(false);
  });

  it('accepts the honest B13 growth phrasing (correct-prose fixture)', () => {
    const body =
      'De bevolking op 1 januari in Nederland groeide in 2024 met 101.085 inwoners: van 17.942.942 in 2024 naar 18.044.027 in 2025.';
    expect(validateAnswerBody(body, populationDifference()).problems).toEqual([]);
  });

  it('rejects a growth claim when the difference is a decline', () => {
    const body = 'De inflatie steeg met 0,5 procentpunt, van 3,8% in 2023 naar 3,3% in 2024.';
    expect(validateAnswerBody(body, inflationDrop()).ok).toBe(false);
  });
});

describe('adversarial-review regressions (2026-07-03): confirmed validator bypasses must stay dead', () => {
  it('rejects Dutch cardinal number-words, including compounds', () => {
    const comparison = populationComparison();
    const wordForm = validateAnswerBody(
      'Amsterdam telde in 2024 931.298 inwoners. Rotterdam telde in 2024 zeshonderdzeventigduizend inwoners.',
      comparison,
    );
    expect(wordForm.ok).toBe(false);
    const tienProcent = validateAnswerBody(
      'De inflatie was 1,3% in 2020, piekte in 2022 op ongeveer tien procent, en kwam uit op 3,3% in 2024.',
      cpiSeries(),
    );
    expect(tienProcent.ok).toBe(false);
  });

  it('does not reject ordinals or number-morpheme fragments inside ordinary words', () => {
    const body = 'Het werkloosheidspercentage was in het vierde kwartaal van 2025 4,0%, aldus de achterliggende reeks.';
    const report = validateAnswerBody(body, unemploymentSingle);
    expect(report.problems.filter((p) => p.includes('telwoord'))).toEqual([]);
  });

  it("recognizes 'daling' (noun) and separable verbs ('nam af', 'nam toe') as direction words", () => {
    const result = populationDifference();
    const nounLie = validateAnswerBody(
      'De bevolking van Nederland ging van 17.942.942 in 2024 naar 18.044.027 in 2025, een daling van 101.085.',
      result,
    );
    expect(nounLie.ok).toBe(false);
    const separableLie = validateAnswerBody(
      'De bevolking nam tussen 2024 en 2025 af met 101.085 inwoners: van 17.942.942 naar 18.044.027.',
      result,
    );
    expect(separableLie.ok).toBe(false);
    const separableHonest = validateAnswerBody(
      'De bevolking van Nederland nam tussen 2024 en 2025 toe met 101.085 inwoners: van 17.942.942 in 2024 naar 18.044.027 in 2025.',
      result,
    );
    expect(separableHonest.problems).toEqual([]);
  });

  it("recognizes 'ongewijzigd' as a flat claim and rejects it on a changing series", () => {
    const report = validateAnswerBody('De inflatie bleef tussen 2020 en 2024 ongewijzigd.', cpiSeries());
    expect(report.ok).toBe(false);
  });

  it('sees fullwidth Unicode digits after normalization', () => {
    const report = validateAnswerBody(
      'Nederland telde in 2025 １８．１２３．４５６ inwoners.',
      populationSingle,
    );
    expect(report.ok).toBe(false);
  });

  it('only accepts count numbers in structural context', () => {
    const result = g4Max();
    const fabricated = validateAnswerBody(
      'Van de 4 gemeenten had Amsterdam in 2025 de meeste inwoners: 934.526. Gemiddeld wonen er 4 personen per woning.',
      result,
    );
    expect(fabricated.ok).toBe(false);
    const structural = validateAnswerBody(
      'Van de 4 gemeenten had Amsterdam in 2025 de meeste inwoners: 934.526. Daarna: Rotterdam 672.960; ’s-Gravenhage 568.945; Utrecht 376.757.',
      result,
    );
    expect(structural.problems).toEqual([]);
  });

  it('binds derivation values to their source periods (R9)', () => {
    const bare = validateAnswerBody('Het verschil bedroeg 0,5 procentpunt, een afname.', inflationDrop());
    expect(bare.ok).toBe(false);
    const bound = validateAnswerBody(
      'De inflatie daalde van 3,8% in 2023 naar 3,3% in 2024, een afname van 0,5 procentpunt.',
      inflationDrop(),
    );
    expect(bound.problems).toEqual([]);
  });

  it("scopes the voorlopig marking to the provisional value's own sentence (R11)", () => {
    const stray = validateAnswerBody(
      'Voorlopig is dit het beste beeld. In 2024 werd 21.822 mln kWh zonnestroom opgewekt.',
      solarSingle,
    );
    expect(stray.ok).toBe(false);
  });

  it('requires the marking when a derivation is computed from provisional source cells (R11)', () => {
    const drop = inflationDrop();
    drop.cells[1]!.status = 'Voorlopig';
    (drop.cells[1] as { provisional: boolean }).provisional = true;
    const unmarked = validateAnswerBody(
      'De inflatie daalde van 3,8% in 2023 naar 3,3% in 2024, een afname van 0,5 procentpunt.',
      drop,
    );
    expect(unmarked.problems.some((p) => p.includes('R11'))).toBe(true);
  });

  it('a negative change shown as a positive number needs a decline word (matchedAbsolute)', () => {
    const noDirection = validateAnswerBody(
      'De inflatie veranderde tussen 2023 en 2024 met 0,5 procentpunt.',
      inflationDrop(),
    );
    expect(noDirection.ok).toBe(false);
  });

  it("rejects a false 'ten opzichte van' sub-period claim (base-year detection is load-bearing)", () => {
    const lie = validateAnswerBody(
      'In 2023 steeg de gemiddelde verkoopprijs ten opzichte van 2022.',
      makeHomePriceSeries(),
    );
    expect(lie.ok).toBe(false);
  });

  it("grounds 'sinds X' on the span from X to the series end, not the step at X", () => {
    // 2023 dipped vs 2022, but 2023→2024 (the span since 2023) rose: the
    // sinds-branch accepts this honest claim where the single-year-step
    // fallback would wrongly reject it — this test dies if the branch dies.
    const honest = validateAnswerBody(
      'Sinds 2023 is de gemiddelde verkoopprijs gestegen; in 2024 bedroeg die 450.985 euro.',
      makeHomePriceSeries(),
    );
    expect(honest.problems).toEqual([]);
  });

  it('rejects a comparative whose two sides resolve to the same region', () => {
    const report = validateAnswerBody(
      'In Amsterdam wonen meer mensen dan in Amsterdam-Noord.',
      populationComparison(),
    );
    expect(report.ok).toBe(false);
  });

  it('rejects an equality claim between unequal compared values', () => {
    const report = validateAnswerBody(
      'Amsterdam en Rotterdam telden in 2024 ongeveer evenveel inwoners: 931.298 en 670.610.',
      populationComparison(),
    );
    expect(report.ok).toBe(false);
  });

  it('requires each unit directly at its value, not merely nearby (R10 suffix window)', () => {
    const distant = validateAnswerBody(
      'De gemiddelde verkoopprijs was in 2024 precies 450.985, een bedrag uitgedrukt in hele euro.',
      makeResult({
        shape: 'single',
        definitionLabel: 'gemiddelde verkoopprijs van bestaande koopwoningen',
        cells: [
          makeCell({
            table: '85773NED', measure: 'M001534', measureTitle: 'Gemiddelde verkoopprijs',
            region: null, periodCode: '2024JJ00', periodLabel: '2024', value: 450985, unit: 'euro',
          }),
        ],
      }),
    );
    expect(distant.ok).toBe(false);
  });

  it('single-axis binding: the answer must name the sole region and period (mutation killers)', () => {
    const noRegion = validateAnswerBody('Op 1 januari 2025 waren er 18.044.027 inwoners.', populationSingle);
    expect(noRegion.problems.some((p) => p.includes('regio'))).toBe(true);
    const noPeriod = validateAnswerBody('Nederland telt 18.044.027 inwoners.', populationSingle);
    expect(noPeriod.problems.some((p) => p.includes('periode'))).toBe(true);
  });

  it("the 'laagste/minste' branch requires the bottom-ranked region (mutation killer)", () => {
    const result = g4Max();
    const honest = validateAnswerBody(
      'Van de 4 gemeenten had Utrecht in 2025 de minste inwoners: 376.757.',
      result,
    );
    expect(honest.problems).toEqual([]);
    const wrong = validateAnswerBody(
      'Van de 4 gemeenten had Rotterdam in 2025 de minste inwoners: 376.757.',
      result,
    );
    expect(wrong.ok).toBe(false);
  });
});

describe('R11: provisional marking', () => {
  it('requires "voorlopig" whenever a provisional value is shown', () => {
    const missing = validateAnswerBody('In 2024 werd 21.822 mln kWh zonnestroom opgewekt.', solarSingle);
    expect(missing.problems.some((p) => p.includes('voorlopig'))).toBe(true);
    const marked = validateAnswerBody('In 2024 werd 21.822 mln kWh zonnestroom opgewekt (nader voorlopig cijfer).', solarSingle);
    expect(marked.problems).toEqual([]);
  });
});

describe('R1 answer half: token classification', () => {
  it('classifies every token in honest prose to a validated source', () => {
    const tokens = scanBody(
      'De bevolking op 1 januari in Nederland groeide in 2024 met 101.085 inwoners: van 17.942.942 in 2024 naar 18.044.027 in 2025.',
      populationDifference(),
    );
    expect(tokens.filter((t) => t.kind === 'unbacked')).toEqual([]);
    expect(tokens.filter((t) => t.kind === 'cell')).toHaveLength(2);
    expect(tokens.filter((t) => t.kind === 'derivation')).toHaveLength(1);
  });

  it('flags an invented number as unbacked', () => {
    const tokens = scanBody('Nederland telde 18.044.027 inwoners en 42 provincies.', populationSingle);
    expect(tokens.find((t) => t.value === 42)?.kind).toBe('unbacked');
  });

  it('classifies null-result prose without inventing values', () => {
    const tokens = scanBody('Voor 2024 in Aduard is er geen waarde.', nullCellSingle);
    expect(tokens.filter((t) => t.kind === 'unbacked')).toEqual([]);
  });
});
