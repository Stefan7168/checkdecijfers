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

// Session-30 review: the two validator blind spots the WP16 go-live exposed
// (the FIRST live onboarded answer was a negative value with a long
// descriptive unit — a shape no Phase-0 seed table has).
describe('negative cell values (session-30 review — the live -24 consumentenvertrouwen case)', () => {
  const LONG_UNIT = 'gemiddelde saldo van de deelvragen';
  const confidenceSingle = makeResult({
    shape: 'single',
    cells: [
      makeCell({
        table: '83694NED',
        measure: 'M1',
        measureTitle: 'Consumentenvertrouwen',
        region: null,
        periodCode: '2024JJ00',
        periodLabel: '2024',
        value: -24,
        unit: LONG_UNIT,
        decimals: 0,
      }),
    ],
    definitionLabel: 'Consumentenvertrouwen',
  });

  it('the live answer body VALIDATES: sign matched to the cell, long unit adjacent', () => {
    // The exact body shape production served (and stored — R8 re-validation
    // runs THIS validator over THIS body, audit/reconstruct.ts).
    const body = 'Consumentenvertrouwen was in 2024 -24 (gemiddelde saldo van de deelvragen).';
    const report = validateAnswerBody(body, confidenceSingle);
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('a sign-DROPPED display (24 for the -24 cell) fails R3 — never serve a wrong sign', () => {
    const body = 'Consumentenvertrouwen was in 2024 24 (gemiddelde saldo van de deelvragen).';
    const report = validateAnswerBody(body, confidenceSingle);
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toContain('24');
  });

  it('a wrong-sign display (-24 for a +24 cell) fails R3', () => {
    const positive = makeResult({
      shape: 'single',
      cells: [
        makeCell({
          table: 'T', measure: 'M', measureTitle: 'Testmaat',
          region: null, periodCode: '2024JJ00', periodLabel: '2024',
          value: 24, unit: '%', decimals: 0,
        }),
      ],
    });
    expect(validateAnswerBody('Testmaat was in 2024 -24%.', positive).ok).toBe(false);
  });

  it('tokenizer: a sign is captured only when standalone — ranges and compounds unchanged', () => {
    expect(findNumericTokens('van 2019-2024').map((t) => t.value)).toEqual([2019, 2024]);
    expect(findNumericTokens('was -24 punten').map((t) => t.value)).toEqual([-24]);
    expect(findNumericTokens('een top-3 notering').map((t) => t.value)).toEqual([3]);
    expect(findNumericTokens('de CO2 uitstoot').map((t) => t.value)).toEqual([2]);
    expect(findNumericTokens('(-3,5)').map((t) => t.value)).toEqual([-3.5]);
    expect(findNumericTokens('-18.044.027').map((t) => t.value)).toEqual([-18044027]);
  });

  it('R10 long unit: the phrase must still START next to the value — a distant unit fails', () => {
    const body =
      'Consumentenvertrouwen was in 2024 -24 en dat is echt opvallend veel lager dan ooit ' +
      'tevoren gemeten (gemiddelde saldo van de deelvragen).';
    const report = validateAnswerBody(body, confidenceSingle);
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toContain('R10');
  });

  it('R10 long digit-bearing unit gets the same extended window (factor branch)', () => {
    const longFactorUnit = 'aantal per 1 000 inwoners van 15 tot 65 jaar';
    const result = makeResult({
      shape: 'single',
      cells: [
        makeCell({
          table: 'T', measure: 'M', measureTitle: 'Testmaat',
          region: null, periodCode: '2024JJ00', periodLabel: '2024',
          value: 42, unit: longFactorUnit, decimals: 0,
        }),
      ],
    });
    const body = `Testmaat was in 2024 42 (${longFactorUnit}).`;
    expect(validateAnswerBody(body, result).problems).toEqual([]);
  });
});

// #140 (session-44 data-integrity hunt): the metadata-number whitelist bypass.
// buildAllowedNumbers pooled every DIGIT found anywhere in metadata prose
// (definitionLabel, periodSemantics, measureTitle, regionLabel, dimLabels) and
// exempted any body number equal to one — with NO context. A fabricated value
// that merely COINCIDED with a digit buried in that prose (e.g. the "2024"
// inside a "2024JJ00" period code) passed every check. The fix binds the
// exemption to the number's SOURCE anchor: the body number must reappear next
// to the same word it sat beside in the metadata (same pattern as countContext).
describe('#140: metadata numbers are exempt only beside their source anchor (fabrication hole)', () => {
  const incomeWith2024InSemantics = makeResult({
    shape: 'single',
    cells: [
      makeCell({
        table: '83932NED', measure: 'M1', measureTitle: 'Gemiddeld besteedbaar inkomen',
        region: null, periodCode: '2023JJ00', periodLabel: '2023',
        value: 57.6, unit: '1 000 euro', decimals: 1,
      }),
    ],
    definitionLabel: 'gemiddeld besteedbaar inkomen van huishoudens',
    // Real-shape internal guidance: the digits 2023/2024 sit inside period codes.
    periodSemantics: 'Cijfer voor het genoemde inkomstenjaar; 2023JJ00 Definitief, 2024JJ00 nog Voorlopig.',
  });

  it('a fabricated "2024 euro" (2024 buried in the "2024JJ00" of periodSemantics) now FAILS R3', () => {
    const body =
      'Het gemiddeld besteedbaar inkomen van huishoudens was in 2023 57,6 (1 000 euro). ' +
      'Per persoon is dat ongeveer 2024 euro.';
    const report = validateAnswerBody(body, incomeWith2024InSemantics);
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.includes("'2024'"))).toBe(true);
  });

  it("the bare fabricated '2024' classifies as unbacked, not metadata", () => {
    const token = scanBody('ongeveer 2024 euro', incomeWith2024InSemantics).find((t) => t.value === 2024);
    expect(token?.kind).toBe('unbacked');
  });

  it('a GENUINE metadata echo still validates — "op 1 januari" keeps the "1" exempt (no false positive)', () => {
    // populationSingle's definition/semantics carry "1 januari"; the "1" beside
    // "januari" must still ground as metadata, or every population answer breaks.
    const report = validateAnswerBody(
      'De bevolking op 1 januari in Nederland was in 2025 18.044.027 inwoners.',
      populationSingle,
    );
    expect(report.problems).toEqual([]);
    expect(scanBody('op 1 januari', populationSingle).find((t) => t.value === 1)?.kind).toBe('metadata');
  });

  it('the anchor is context-specific: the same number beside a DIFFERENT word is not exempted', () => {
    const ageShareResult = makeResult({
      shape: 'single',
      cells: [
        makeCell({
          table: 'T', measure: 'M', measureTitle: 'Testmaat',
          region: null, periodCode: '2024JJ00', periodLabel: '2024',
          value: 5, unit: '%', decimals: 0,
        }),
      ],
      definitionLabel: 'aandeel van 65 jaar en ouder', // "65" anchored to "jaar"
    });
    // Echoing "65 jaar" (distinctive after-word) → metadata; a fabricated count
    // "65 gemeenten" (no matching neighbour) → unbacked.
    expect(scanBody('vanaf 65 jaar', ageShareResult).find((t) => t.value === 65)?.kind).toBe('metadata');
    expect(scanBody('er zijn 65 gemeenten', ageShareResult).find((t) => t.value === 65)?.kind).toBe('unbacked');
  });

  // The fix-review of the first (single-anchor) attempt found it too weak: the
  // real 03759ned periodSemantics contains "groei-in-2024", so "2024" was
  // anchored by the stopword "in" and a fabricated "in 2024" re-passed. Two
  // hardenings: periodSemantics is no longer a source, and a single-sided anchor
  // match must go through a DISTINCTIVE (non-stopword) word.
  it('the fix-review exploit is closed: a fabricated "in 2024" (2024 buried in periodSemantics "groei-in-2024") FAILS', () => {
    const populationGuidance = makeResult({
      shape: 'single',
      cells: [
        makeCell({
          table: '03759ned', measure: 'M000352', measureTitle: 'Bevolking op 1 januari',
          region: null, periodCode: '2025JJ00', periodLabel: '2025',
          value: 18044027, unit: 'aantal', decimals: 0,
        }),
      ],
      definitionLabel: 'bevolking op 1 januari',
      periodSemantics:
        "Measure-afhankelijk: voor M000352 (Bevolking op 1 januari) is dit een standcijfer per 1 januari van " +
        "het genoemde jaar (B13's groei-in-2024 leunt hierop); voor M000365 (Gemiddelde bevolking) is het jaargemiddelde.",
    });
    const body =
      'De bevolking op 1 januari in Nederland was in 2025 18.044.027 inwoners. ' +
      'Dat is opvallend, want in 2024 was de instroom nog nooit zo hoog.';
    const report = validateAnswerBody(body, populationGuidance);
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.includes("'2024'"))).toBe(true);
  });

  it('a single stopword anchor ("in") never exempts on its own; a distinctive after-word does', () => {
    const revised = makeResult({
      shape: 'single',
      cells: [
        makeCell({
          table: 'T', measure: 'M', measureTitle: 'Testmaat',
          region: null, periodCode: '2024JJ00', periodLabel: '2024',
          value: 5, unit: '%', decimals: 0,
        }),
      ],
      definitionLabel: 'percentage in 2015 herzien', // "2015": before "in" (stopword), after "herzien"
    });
    // Reusing only the common "in" next to a fabricated 2015 → unbacked.
    expect(scanBody('dat was in 2015 anders', revised).find((t) => t.value === 2015)?.kind).toBe('unbacked');
    // Echoing the distinctive "2015 herzien" → metadata.
    expect(scanBody('cijfer 2015 herzien', revised).find((t) => t.value === 2015)?.kind).toBe('metadata');
  });

  // The v2 fix-review found the single-anchor+stopword version STILL too weak on
  // two shapes: (a) a bare digit-run counted as a "distinctive" anchor, so CBS's
  // space-grouped labels ("20 000 tot 30 000 euro") and index bases ("(2015=100)")
  // let a numeral anchor launder a fabrication; (b) fully dropping periodSemantics
  // broke a legit "per 1 januari" echo when definitionLabel is null (onboarded/
  // explicit targets). Fix: an anchor must contain a LETTER, and periodSemantics
  // is kept but STRICT (both-side phrase echo only).
  it('a bare digit-run is not a binding anchor: a CBS bracket label "20 000 tot 30 000 euro" cannot launder a fabricated "20 000"', () => {
    const income = makeResult({
      shape: 'single',
      cells: [
        makeCell({
          table: '83932NED', measure: 'M1', measureTitle: 'Gemiddeld inkomen',
          region: null, periodCode: '2023JJ00', periodLabel: '2023',
          value: 57.6, unit: '1 000 euro', decimals: 1,
        }),
      ],
      definitionLabel: 'gemiddeld besteedbaar inkomen van huishoudens',
    });
    income.cells[0]!.dimLabels = { Inkomensklassen: 'Inkomen: 20 000 tot 30 000 euro' }; // real CBS Title
    const body = 'Het inkomen was in 2023 57,6 (1 000 euro). Sommige huishoudens gaven echter 20 000 euro uit.';
    const report = validateAnswerBody(body, income);
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.includes("'20'"))).toBe(true);
  });

  it('an index base "(2015=100)" cannot launder a fabricated "100" via the numeral "2015"', () => {
    const cpi = makeResult({
      shape: 'single',
      cells: [
        makeCell({
          table: '86141NED', measure: 'M1', measureTitle: 'CPI indexniveau (2015=100)',
          region: null, periodCode: '2024JJ00', periodLabel: '2024',
          value: 118.3, unit: 'punten', decimals: 1,
        }),
      ],
      definitionLabel: 'CPI indexniveau',
    });
    expect(scanBody('In 2015 100 asielzoekers kwamen aan', cpi).find((t) => t.value === 100)?.kind).toBe('unbacked');
    expect(validateAnswerBody('De CPI was in 2024 118,3 punten. In 2015 100 asielzoekers kwamen aan.', cpi).ok).toBe(false);
  });

  it('periodSemantics is kept but STRICT: a null-definitionLabel "per 1 januari" echo validates, "in 2024/2024 leunt" does not', () => {
    const nullDef = makeResult({
      shape: 'single',
      cells: [
        makeCell({
          table: '82235NED', measure: 'D1', measureTitle: 'Beginstand voorraad',
          region: null, periodCode: '2024JJ00', periodLabel: '2024',
          value: 8100000, unit: 'aantal', decimals: 0,
        }),
      ],
      definitionLabel: null,
      periodSemantics: 'Beginstand voorraad = stand per 1 januari van het genoemde jaar.',
    });
    // The genuine full-phrase echo "per 1 januari" (both sides match) validates.
    expect(validateAnswerBody('De woningvoorraad per 1 januari was in 2024 8.100.000.', nullDef).ok).toBe(true);
    expect(scanBody('per 1 januari', nullDef).find((t) => t.value === 1)?.kind).toBe('metadata');
    // A guidance number reachable only through one side stays unbacked.
    const guided = makeResult({
      shape: 'single',
      cells: [makeCell({ table: 'T', measure: 'M', measureTitle: 'Testmaat', region: null, periodCode: '2025JJ00', periodLabel: '2025', value: 5, unit: '%', decimals: 0 })],
      definitionLabel: null,
      periodSemantics: "B13's groei-in-2024 leunt hierop.",
    });
    expect(scanBody('want in 2024 was het hoog', guided).find((t) => t.value === 2024)?.kind).toBe('unbacked');
  });
});

// #141 (session-44 data-integrity hunt, follow-up to #140): the PERIOD twin of
// the metadata hole. scanBody exempted ANY integer equal to ANY number a
// covered period contributes — years, but also the quarter/month sequence
// numbers of KW/MM results — with NO context: "2025 gemeenten" (a fabricated
// count) or "steeg met 4 punten" (in a Q4 result) passed as 'period'. Period
// labels carry no anchor word of their own, so the fix is a TEMPORAL-CONTEXT
// gate on the body side (periodEcho/gluedPeriodEcho): verbatim label echo,
// temporal marker before, list label / label order / span continuation after,
// with a quantity-noun veto behind temporal prepositions.
describe('#141: period numbers are exempt only in temporal context (fabrication hole)', () => {
  it('a fabricated count equal to the covered YEAR ("2025 gemeenten bij") FAILS R3', () => {
    const body = 'Het werkloosheidspercentage was in 2025 4e kwartaal 4,0%. Er kwamen 2025 gemeenten bij.';
    const report = validateAnswerBody(body, unemploymentSingle);
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.includes("'2025'"))).toBe(true);
  });

  it('a bare fabricated value equal to the covered year classifies unbacked ("bedroeg 2024")', () => {
    expect(scanBody('het aantal bedroeg 2024', housingSingle).find((t) => t.value === 2024)?.kind).toBe('unbacked');
    expect(scanBody('een stijging van 2024', housingSingle).find((t) => t.value === 2024)?.kind).toBe('unbacked');
    expect(scanBody('steeg met 2024', housingSingle).find((t) => t.value === 2024)?.kind).toBe('unbacked');
  });

  it('a fabricated QUARTER-sequence number ("steeg met 4 punten" in a Q4 result) is no longer laundered as period', () => {
    // A Q4 cell whose VALUE is not 4 — the 4 in periodNumbers comes only from
    // KW04; before the fix a fabricated bare "4" grounded as 'period'.
    const q4 = makeResult({
      shape: 'single',
      definitionLabel: 'werkloosheidspercentage, seizoengecorrigeerd',
      cells: [
        makeCell({
          table: '85224NED', measure: 'M001906', measureTitle: 'Werkloosheidspercentage',
          region: null, periodCode: '2025KW04', periodLabel: '2025 4e kwartaal', value: 3.8, unit: '%', decimals: 1,
        }),
      ],
    });
    expect(scanBody('het percentage steeg met 4 punten', q4).find((t) => t.value === 4)?.kind).toBe('unbacked');
    // The glued multiplier form is not an ordinal grain form.
    expect(scanBody('dat is 4x zo hoog', q4).find((t) => t.value === 4)?.kind).toBe('unbacked');
  });

  it('a fabricated MONTH-sequence number in a monthly result is no longer laundered as period', () => {
    const monthly = makeResult({
      shape: 'single',
      definitionLabel: 'uitgesproken faillissementen',
      cells: [
        makeCell({
          table: '82242NED', measure: 'M1', measureTitle: 'Uitgesproken faillissementen',
          region: null, periodCode: '2026MM05', periodLabel: '2026 mei', value: 326, unit: 'aantal', decimals: 0,
        }),
      ],
    });
    // 2026MM05 puts 5 in periodNumbers; a fabricated count "5 bedrijven" must not pass.
    expect(scanBody('waarvan 5 bedrijven in de bouw', monthly).find((t) => t.value === 5)?.kind).toBe('unbacked');
    // Both legit temporal orders for the month stay exempt: prose order and CBS label order.
    expect(scanBody('in mei 2026 waren het er 326', monthly).find((t) => t.value === 2026)?.kind).toBe('period');
    expect(scanBody('in 2026 mei waren het er 326', monthly).find((t) => t.value === 2026)?.kind).toBe('period');
  });

  it('a temporal preposition does not launder a quantity: "in 2024 gemeenten" / the result\'s own unit word FAIL', () => {
    expect(scanBody('in 2024 gemeenten steeg het aantal', housingSingle).find((t) => t.value === 2024)?.kind).toBe('unbacked');
    // solarSingle's unit is 'mln kWh' — its own unit word right after the year is a value claim.
    expect(scanBody('in 2024 kwh werd opgewekt', solarSingle).find((t) => t.value === 2024)?.kind).toBe('unbacked');
  });

  it('every corpus-measured temporal phrasing still grounds as period (no false positives)', () => {
    const cpi = cpiSeries();
    for (const [body, value] of [
      ['de inflatie bedroeg in 2024 3,3%', 2024],
      ['van 2020 tot en met 2024 in Nederland', 2020],
      ['van 2020 tot en met 2024 in Nederland', 2024],
      ['tussen 2020 en 2024 steeg de inflatie', 2020],
      ['tussen 2020 en 2024 steeg de inflatie', 2024],
      ['in 2020 en 2021 bedroeg de inflatie', 2021],
      ['de reeks 2020-2024 laat een stijging zien', 2020],
      ['de reeks 2020-2024 laat een stijging zien', 2024],
      ['sinds 2020 is de inflatie gestegen', 2020],
      ['eind 2024 lag het niveau hoger', 2024],
      ['ten opzichte van 2020 is dat meer', 2020],
      ['vergeleken met 2023 daalde de inflatie', 2023],
      ['per periode: 2020: 1,3%; 2021: 2,7%', 2020],
      ['per periode: 2020: 1,3%; 2021: 2,7%', 2021],
    ] as const) {
      expect(scanBody(body, cpi).find((t) => t.value === value)?.kind, `${body} [${value}]`).toBe('period');
    }
  });

  it('quarter-label phrasings stay exempt: glued ordinal, label echo, label order, "kwartaal van"', () => {
    const q = makeResult({
      shape: 'series',
      definitionLabel: 'werkloosheidspercentage, seizoengecorrigeerd',
      cells: [
        makeCell({
          table: '85224NED', measure: 'M001906', measureTitle: 'Werkloosheidspercentage',
          region: null, periodCode: '2025KW01', periodLabel: '2025 1e kwartaal', value: 3.8, unit: '%', decimals: 1,
        }),
        makeCell({
          table: '85224NED', measure: 'M001906', measureTitle: 'Werkloosheidspercentage',
          region: null, periodCode: '2026KW01', periodLabel: '2026 1e kwartaal', value: 4.0, unit: '%', decimals: 1,
        }),
      ],
    });
    const body = 'Het werkloosheidspercentage steeg van 3,8% in 2025 1e kwartaal naar 4,0% in 2026 1e kwartaal.';
    const tokens = scanBody(body, q);
    expect(tokens.filter((t) => t.value === 2025 || t.value === 2026).every((t) => t.kind === 'period')).toBe(true);
    expect(tokens.filter((t) => t.value === 1).every((t) => t.kind === 'period')).toBe(true);
    expect(scanBody('in het 1e kwartaal van 2026 was het 4,0%', q).find((t) => t.value === 2026)?.kind).toBe('period');
    expect(scanBody('in kwartaal 1 van 2026', q).find((t) => t.value === 1)?.kind).toBe('period');
  });

  it('the period fall-through now reaches the count branch: "van de 4 gemeenten" in a Q4 comparison counts', () => {
    const regions = [
      { code: 'GM0363', label: 'Amsterdam (gemeente)' },
      { code: 'GM0599', label: 'Rotterdam (gemeente)' },
      { code: 'GM0518', label: "'s-Gravenhage (gemeente)" },
      { code: 'GM0344', label: 'Utrecht (gemeente)' },
    ];
    const q4comparison = makeResult({
      shape: 'comparison',
      definitionLabel: 'werkloosheidspercentage',
      cells: regions.map((region, i) =>
        makeCell({
          // Values 3,1–3,4: no cell equals the bare 4, so the token can only
          // ground via period (blocked without temporal context) or count.
          table: '85224NED', measure: 'M001906', measureTitle: 'Werkloosheidspercentage',
          region, periodCode: '2025KW04', periodLabel: '2025 4e kwartaal', value: 3.1 + i / 10, unit: '%', decimals: 1,
        }),
      ),
    });
    // 4 is BOTH the KW04 sequence number and the region count: without temporal
    // context it may no longer ground as 'period', and the count branch (with
    // its structure noun) must catch the honest structural mention instead.
    expect(scanBody('het gemiddelde van de 4 gemeenten', q4comparison).find((t) => t.value === 4)?.kind).toBe('count');
  });

  // Adversarial-review round (2026-07-16): the first version's TEMPORAL_AFTER
  // had a bare ':' leg with no before-context and no noun veto — a CONFIRMED
  // critical bypass ("daarnaast 2025: extra gemeenten"). The list-label form
  // now requires list context BEFORE the year AND a value/'geen waarde' after
  // the colon (LIST_CONTEXT_BEFORE + LIST_LABEL_AFTER).
  it('review bypass closed: a mid-clause "2025: <claim>" no longer launders a fabricated year', () => {
    const body =
      'De bevolking op 1 januari in Nederland was in 2025 18.044.027 inwoners. ' +
      'Er kwamen daarnaast 2025: extra gemeenten bij.';
    const report = validateAnswerBody(body, populationSingle);
    expect(report.ok).toBe(false);
    expect(scanBody('Er kwamen daarnaast 2025: extra gemeenten bij.', populationSingle).find((t) => t.value === 2025)?.kind).toBe('unbacked');
    expect(scanBody('Er kwamen daarnaast 2025 in Almere: extra woningen bij.', populationSingle).find((t) => t.value === 2025)?.kind).toBe('unbacked');
  });

  it('legit list labels still pass: body-start, per-periode, regional and geen-waarde forms', () => {
    const cpi = cpiSeries();
    expect(scanBody('2020: 1,3%; 2021: 2,7%', cpi).find((t) => t.value === 2020)?.kind).toBe('period');
    const comparison = scanBody('Bevolking op 1 januari: 2024 in Amsterdam: 931.298; 2024 in Rotterdam: 670.610.', populationComparison());
    expect(comparison.filter((t) => t.value === 2024).every((t) => t.kind === 'period')).toBe(true);
    expect(
      scanBody('Bevolking per periode: 2024 in Aduard: geen waarde — deze waarde kan volgens CBS niet voorkomen.', nullCellSingle)
        .find((t) => t.value === 2024)?.kind,
    ).toBe('period');
  });

  it('review hardening: the quantity-noun veto fires through a hyphen, but a negative value after a year stays clean', () => {
    expect(scanBody('in 2024-gemeenten kwam dat vaker voor', housingSingle).find((t) => t.value === 2024)?.kind).toBe('unbacked');
    // The consumentenvertrouwen shape: a negative CELL value directly after the
    // year must not be read as a hyphen-glued noun.
    const sentiment = makeResult({
      shape: 'single',
      definitionLabel: null,
      cells: [
        makeCell({
          table: '83694NED', measure: 'M1', measureTitle: 'Consumentenvertrouwen',
          region: null, periodCode: '2024JJ00', periodLabel: '2024', value: -24, unit: 'gemiddelde saldo van de deelvragen', decimals: 0,
        }),
      ],
    });
    expect(scanBody('Consumentenvertrouwen was in 2024 -24', sentiment).find((t) => t.value === 2024)?.kind).toBe('period');
    // Dynamic unitWords veto (mutation-review test gap): 'saldo' is NOT on the
    // static noun list — only the result's own unit words can veto it.
    expect(scanBody('in 2024 saldo van iets', sentiment).find((t) => t.value === 2024)?.kind).toBe('unbacked');
  });

  it('review hardening: whitespace bridges are capped — a window-edge fake word boundary cannot exempt', () => {
    const body = `${'q'.repeat(46)}in${' '.repeat(46)}2024 zaken.`;
    expect(scanBody(body, housingSingle).find((t) => t.value === 2024)?.kind).toBe('unbacked');
  });

  it('idiomatic annual-total prose "In heel 2025" validates (owner-facing quality, corpus-adjacent)', () => {
    const bankruptcies = makeResult({
      shape: 'single',
      definitionLabel: 'faillissementen van bedrijven en instellingen',
      cells: [
        makeCell({
          table: '82242NED', measure: 'M1', measureTitle: 'Uitgesproken faillissementen',
          region: null, periodCode: '2025JJ00', periodLabel: '2025', value: 3226, unit: 'aantal', decimals: 0,
        }),
      ],
    });
    expect(validateAnswerBody('In heel 2025 werden in totaal 3.226 faillissementen uitgesproken.', bankruptcies).problems).toEqual([]);
    expect(scanBody('in heel 2025', bankruptcies).find((t) => t.value === 2025)?.kind).toBe('period');
  });

  it('a year failing the temporal gate still falls through to a genuine metadata anchor', () => {
    const revisedIn2015 = makeResult({
      shape: 'single',
      cells: [
        makeCell({
          table: 'T', measure: 'M', measureTitle: 'Testmaat',
          region: null, periodCode: '2015JJ00', periodLabel: '2015', value: 42, unit: '%', decimals: 0,
        }),
      ],
      definitionLabel: 'prijspeil 2015 herzien',
    });
    // "cijfer 2015 herzien": no temporal context (before "cijfer"), but the
    // definitionLabel anchor "2015 herzien" legitimately echoes → metadata.
    expect(scanBody('cijfer 2015 herzien', revisedIn2015).find((t) => t.value === 2015)?.kind).toBe('metadata');
  });
});

// #142 (session-44 data-integrity hunt, MEDIUM): count exemptions are now
// AXIS-BOUND. countNumbers pooled the cell/region/period counts and any
// structure noun accepted any of them — so "in 4 gemeenten" grounded as
// 'count' when 4 was the PERIOD count of a single-region result: a
// wrong-axis structural claim (no invented magnitude, but a false statement
// about the data's shape).
describe('#142: count numbers are exempt only next to their OWN axis noun', () => {
  it('a wrong-axis noun no longer grounds as count ("5 gemeenten" over a 5-period single-region series)', () => {
    const cpi = cpiSeries(); // 5 periods, 1 (national) region, 5 cells
    expect(scanBody('de inflatie steeg in 5 gemeenten', cpi).find((t) => t.value === 5)?.kind).toBe('unbacked');
    expect(validateAnswerBody('De inflatie was in 2024 3,3% en steeg in 5 gemeenten.', cpi).ok).toBe(false);
  });

  it('right-axis mentions still ground as count: periods, cells and regions each bind their own noun', () => {
    const cpi = cpiSeries();
    expect(scanBody('gemeten over 5 jaren', cpi).find((t) => t.value === 5)?.kind).toBe('count');
    expect(scanBody('de 5 waarden hierboven', cpi).find((t) => t.value === 5)?.kind).toBe('count');
    expect(scanBody('het inwonertal van de 2 gemeenten', populationComparison()).find((t) => t.value === 2)?.kind).toBe('count');
  });

  it('granularities the product does not serve never count: "2 wijken"/"2 buurten" over a gemeente comparison FAIL', () => {
    // Review-confirmed bypass of the first #142 version: 'wijken'/'buurten'
    // sat in REGION_COUNT_NOUNS while no result can be at that granularity
    // (intent schema has no wijk/buurt kind; policy refuses buurt questions)
    // — a body could describe a gemeente comparison as a wijk comparison.
    expect(scanBody('het inwonertal van de 2 wijken', populationComparison()).find((t) => t.value === 2)?.kind).toBe('unbacked');
    expect(scanBody('het inwonertal van de 2 buurten', populationComparison()).find((t) => t.value === 2)?.kind).toBe('unbacked');
  });
});
