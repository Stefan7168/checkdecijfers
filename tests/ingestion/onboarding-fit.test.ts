// WP27 stage C — the measure-fit module in isolation (ADR 027 D1/D2/D4):
// validator allowlist discipline (mirrors rerank-schema.test coverage), the
// prompt payload's metadata-only shape, the request pins (model tier,
// deterministic sampling, structured output), and amendment A3's
// deterministic deliverability pre-checks against the REAL stage-A fixture
// schemas (37789ksz time-only vs 85615NED breakdown-dimensioned). The gate's
// end-to-end routing lives in onboarding-job.test.ts.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FixtureSource, loadFixtureDocs } from '../../src/cbs-adapter/fixture-source.ts';
import type { CbsTableSchema } from '../../src/cbs-adapter/types.ts';
import {
  DEFAULT_MEASURE_FIT_CONFIG,
  MEASURE_FIT_MODEL,
  MEASURE_FIT_NONE,
  MEASURE_FIT_SCHEMA_VERSION,
  MeasureFitValidationError,
  buildMeasureFitRequest,
  hasOnlyTimeDimensions,
  hasYearlyPeriodCodes,
  questionNamesBareYear,
  serializeMeasureList,
  validateMeasureFitOutput,
} from '../../src/ingestion/onboarding-fit.ts';

const FIXTURES = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));

function fixture(tableId: string): FixtureSource {
  return new FixtureSource(loadFixtureDocs(`${FIXTURES}/${tableId}`));
}

const CODES = ['D000203_2', '90210', '90200'];

function output(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: MEASURE_FIT_SCHEMA_VERSION,
    measureCode: 'D000203_2',
    confidence: 0.92,
    reading: 'telt het totale aantal bijstandsuitkeringen',
    ...over,
  });
}

describe('validateMeasureFitOutput — the hard allowlist (principle a)', () => {
  it('accepts a verbatim measure code from the list', () => {
    const result = validateMeasureFitOutput(output(), CODES);
    expect(result.measureCode).toBe('D000203_2');
    expect(result.confidence).toBe(0.92);
    expect(result.reading).toContain('bijstandsuitkeringen');
  });

  it("maps 'geen' to measureCode null (a verdict, never an error)", () => {
    const result = validateMeasureFitOutput(output({ measureCode: MEASURE_FIT_NONE }), CODES);
    expect(result.measureCode).toBeNull();
    expect(result.confidence).toBe(0.92);
  });

  it('THROWS on an invented measure code — the model may not invent a measure', () => {
    expect(() => validateMeasureFitOutput(output({ measureCode: 'M999999' }), CODES)).toThrow(
      MeasureFitValidationError,
    );
  });

  it('the allowlist is case-exact (CBS codes are verbatim, catalog quirk #1)', () => {
    expect(() => validateMeasureFitOutput(output({ measureCode: 'd000203_2' }), CODES)).toThrow(
      MeasureFitValidationError,
    );
  });

  it('THROWS on invalid JSON, schema violation, and out-of-range confidence', () => {
    expect(() => validateMeasureFitOutput('not json', CODES)).toThrow(MeasureFitValidationError);
    expect(() => validateMeasureFitOutput(JSON.stringify({ version: 99 }), CODES)).toThrow(
      MeasureFitValidationError,
    );
    expect(() => validateMeasureFitOutput(output({ confidence: 1.4 }), CODES)).toThrow(
      MeasureFitValidationError,
    );
    expect(() => validateMeasureFitOutput(output({ confidence: -0.1 }), CODES)).toThrow(
      MeasureFitValidationError,
    );
  });

  it('rejects extra fields (strict schema — same discipline as the rerank contract)', () => {
    expect(() => validateMeasureFitOutput(output({ extra: 'field' }), CODES)).toThrow(
      MeasureFitValidationError,
    );
  });
});

describe('serializeMeasureList / buildMeasureFitRequest — metadata only (R1), pinned knobs', () => {
  const schema: CbsTableSchema = {
    tableId: '37789ksz',
    title: 'Sociale zekerheid; kerncijfers',
    dimensions: [{ name: 'Perioden', kind: 'TimeDimension' }],
    measures: [
      {
        code: 'D000203_2',
        title: 'Totaal bijstandsuitkeringen',
        unit: 'x 1 000',
        decimals: 1,
        description: 'Het totale aantal bijstandsuitkeringen aan het eind van de periode.',
      },
      { code: '90210', title: 'Bijstandsuitkeringen tot de AOW-leeftijd', unit: 'x 1 000', decimals: 1, description: '' },
    ],
  };

  it('carries the full question, the table identity, and every measure (code, unit, title, description)', () => {
    const payload = serializeMeasureList('Hoeveel mensen zaten er in 2023 in de bijstand?', schema);
    expect(payload).toContain('Volledige vraag van de gebruiker: "Hoeveel mensen zaten er in 2023 in de bijstand?"');
    expect(payload).toContain('Tabel: 37789ksz — Sociale zekerheid; kerncijfers');
    expect(payload).toContain('measureCode=D000203_2');
    expect(payload).toContain('titel: Totaal bijstandsuitkeringen');
    expect(payload).toContain('eenheid=x 1 000');
    expect(payload).toContain('omschrijving: Het totale aantal bijstandsuitkeringen');
    expect(payload).toContain('measureCode=90210');
  });

  it('long descriptions are condensed to one budgeted line (token cap, like the rerank prompt)', () => {
    const verbose: CbsTableSchema = {
      ...schema,
      measures: [{ ...schema.measures[0]!, description: 'woord '.repeat(200) }],
    };
    const payload = serializeMeasureList('vraag', verbose);
    const line = payload.split('\n').find((l) => l.includes('omschrijving:'))!;
    expect(line.length).toBeLessThan(300);
    expect(line).toContain('…');
  });

  it('request pins: Haiku tier (ADR 027 D4), temperature 0, structured output schema attached', () => {
    const request = buildMeasureFitRequest('vraag', schema);
    expect(request.model).toBe(MEASURE_FIT_MODEL);
    expect(MEASURE_FIT_MODEL).toContain('haiku');
    expect(request.temperature).toBe(0);
    expect(request.jsonSchema).toBeDefined();
    expect(request.maxTokens).toBe(1024);
    // The system prompt is static + date-free (ADR 012 hash-stability): no
    // reference date may ever enter it.
    expect(request.system).not.toMatch(/\b20\d{2}\b/);
  });

  it('the acceptance threshold is the documented pre-calibration placeholder', () => {
    // Stage D calibrates from benchmark/measurefit-labelled-set.json; until
    // then the value must stay at the finder's conservative 0.8 floor. A
    // recalibration should change ONE constant, and this test, knowingly.
    expect(DEFAULT_MEASURE_FIT_CONFIG.acceptThreshold).toBe(0.8);
  });
});

describe('A3 deliverability pre-checks — deterministic, against the REAL fixture schemas', () => {
  it('37789ksz (the stock target): time-only dims ✓ and JJ codes ✓ — passes both checks', async () => {
    const source = fixture('37789ksz');
    const schema = await source.fetchTableSchema('37789ksz');
    expect(hasOnlyTimeDimensions(schema)).toBe(true);
    const codes = await source.fetchCodeList('37789ksz', 'Perioden');
    expect(hasYearlyPeriodCodes(codes)).toBe(true);
  });

  it('85615NED (the flows mis-pick): breakdown dimensions → fails (a); and its Perioden carry NO JJ codes → fails (b) too', async () => {
    const source = fixture('85615NED');
    const schema = await source.fetchTableSchema('85615NED');
    expect(hasOnlyTimeDimensions(schema)).toBe(false);
    const codes = await source.fetchCodeList('85615NED', 'Perioden');
    expect(hasYearlyPeriodCodes(codes)).toBe(false);
  });

  it('a table without any time dimension fails (a) — no Perioden means no period resolution', () => {
    expect(
      hasOnlyTimeDimensions({ tableId: 'X', title: 'x', dimensions: [], measures: [] }),
    ).toBe(false);
  });

  it('questionNamesBareYear: year-carrying questions trigger the JJ check; year-free ones do not', () => {
    expect(questionNamesBareYear('Hoeveel mensen zaten er in 2023 in de bijstand?')).toBe(true);
    expect(questionNamesBareYear('Wat was de werkloosheid in 1999?')).toBe(true);
    expect(questionNamesBareYear('Hoeveel mensen zitten er nu in de bijstand?')).toBe(false);
    // Digit runs that are not calendar years must not trigger it.
    expect(questionNamesBareYear('Hoeveel huishoudens hebben 3 kinderen?')).toBe(false);
    expect(questionNamesBareYear('Wat kost een brood van 800 gram?')).toBe(false);
  });

  it('hasYearlyPeriodCodes: JJ00 counts, quarters/months alone do not', () => {
    const kw = [{ code: '2023KW01', title: '', dimensionGroup: null, status: null, index: null }];
    const jj = [...kw, { code: '2023JJ00', title: '', dimensionGroup: null, status: null, index: null }];
    expect(hasYearlyPeriodCodes(kw)).toBe(false);
    expect(hasYearlyPeriodCodes(jj)).toBe(true);
  });
});
