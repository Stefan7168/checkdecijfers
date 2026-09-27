// ADR 058 phase 2 (#332), Task 4: English labels for every chip on a refusal
// or clarification. All hermetic — hand-built QueryRefusal/ParseOutcome/
// ResolutionFailure fed to the deterministic template layers directly, no db,
// no LLM (the same discipline tests/answer/english-refusals.test.ts and
// english-clarifications.test.ts already use for Tasks 2/3). Every chip kind
// this design doc names gets one focused case:
//  - a freshness refusal's retry chip (buildRefusalSuggestionsBoth)
//  - an outside_loaded_slice retry chip, single and #137 range forms
//  - a WP26c rescue chip (buildRescueOffer)
//  - the region_scope_on_national_measure offer chip (buildQueryRefusal)
//  - a region_ambiguous click option (decide(), policy.ts)
// plus the two invariants that must hold everywhere: `submit` is always the
// exact Dutch label, and the STORED pending never carries `labelEn`.
import { describe, expect, it } from 'vitest';
import { buildRefusalSuggestionsBoth } from '../../src/answer/respond/suggestions.ts';
import { buildRescueOffer } from '../../src/answer/respond/rescue.ts';
import { buildQueryRefusal, toClarificationResponse } from '../../src/answer/respond/index.ts';
import { periodCodeToNl } from '../../src/answer/respond/period-nl.ts';
import { periodCodeToEn } from '../../src/answer/respond/english.ts';
import { decide } from '../../src/answer/intent/index.ts';
import type {
  OutcomeContext,
  ParserConfig,
  ResolutionFailure,
  ServabilityCheck,
} from '../../src/answer/intent/index.ts';
import type { ParseOutcome, RawParse } from '../../src/answer/intent/types.ts';
import { INTENT_SCHEMA_VERSION } from '../../src/query/index.ts';
import type { QueryRefusal, StructuredIntent } from '../../src/query/index.ts';

// ---------------------------------------------------------------------------
// Shared synthetic fixtures
// ---------------------------------------------------------------------------

const CPI = 'cpi_yearly_inflation';
const CPI_LABEL = 'inflatie (jaarmutatie CPI, alle bestedingen)';
const CPI_LABEL_EN = 'inflation (year-on-year change in the consumer price index, all spending categories)';

const alwaysServable: ServabilityCheck = async () => ({ servable: true });

function cpiIntent(period: StructuredIntent['period']): StructuredIntent {
  return {
    schemaVersion: INTENT_SCHEMA_VERSION,
    target: { kind: 'canonical', key: CPI },
    period,
    derivation: 'none',
  };
}

function refusalOf(
  kind: QueryRefusal['refusal']['kind'],
  overrides: Partial<QueryRefusal['refusal']> = {},
  intent: StructuredIntent = cpiIntent({ kind: 'codes', codes: ['2025JJ00'] }),
): QueryRefusal {
  return {
    ok: false,
    refusal: { kind, message: `stub ${kind}`, ...overrides },
    intent,
  };
}

const neverLabels = async (): Promise<never> => {
  throw new Error('labelRegions must not be consulted for a region-less intent');
};

// ---------------------------------------------------------------------------
// 1. buildRefusalSuggestionsBoth — the period-coverage retry chip
// ---------------------------------------------------------------------------

describe('buildRefusalSuggestionsBoth — retry chip English labels', () => {
  it('freshness: English sibling of the freshest-available retry chip', async () => {
    const refusal = refusalOf('freshness', {
      axis: 'period',
      freshness: { freshestAvailable: { periodCode: '2025JJ00', status: 'Definitief' }, freshestDefinitief: null },
      nearestAlternative: '2025JJ00',
    });
    const chips = await buildRefusalSuggestionsBoth(refusal, alwaysServable, neverLabels);
    expect(chips.nl).toEqual([`Wat was ${CPI_LABEL} in 2025?`]);
    expect(chips.en).toEqual([`What was ${CPI_LABEL_EN} in ${periodCodeToEn('2025JJ00')}?`]);
    // submit == the Dutch label (this generator's "submit" IS the plain nl
    // string itself — respond.ts's englishChips pairs {label: en, submit: nl}).
    expect(chips.en[0]).not.toBe(chips.nl[0]);
  });

  it('outside_loaded_slice (single period): English sibling of the loaded-slice-floor retry chip', async () => {
    const refusal = refusalOf('outside_loaded_slice', { axis: 'period', nearestAlternative: '2010JJ00' });
    const chips = await buildRefusalSuggestionsBoth(refusal, alwaysServable, neverLabels);
    expect(chips.nl).toEqual([`Wat was ${CPI_LABEL} in 2010?`]);
    expect(chips.en).toEqual([`What was ${CPI_LABEL_EN} in ${periodCodeToEn('2010JJ00')}?`]);
  });

  it('outside_loaded_slice (#137 range form): English sibling of the working-sub-range trend chip', async () => {
    const refusal = refusalOf(
      'outside_loaded_slice',
      { axis: 'period', nearestAlternative: '2010JJ00' },
      cpiIntent({ kind: 'range', from: '2001JJ00', to: '2024JJ00' }),
    );
    const chips = await buildRefusalSuggestionsBoth(refusal, alwaysServable, neverLabels);
    expect(chips.nl).toEqual([`Hoe ontwikkelde ${CPI_LABEL} zich van 2010 tot en met 2024?`]);
    expect(chips.en).toEqual([
      `How did ${CPI_LABEL_EN} develop from ${periodCodeToEn('2010JJ00')} to ${periodCodeToEn('2024JJ00')}?`,
    ]);
  });

  it('no digit in the English label that the Dutch label does not carry (belt over both chip forms)', async () => {
    const single = await buildRefusalSuggestionsBoth(
      refusalOf('outside_loaded_slice', { axis: 'period', nearestAlternative: '2010JJ00' }),
      alwaysServable,
      neverLabels,
    );
    const range = await buildRefusalSuggestionsBoth(
      refusalOf(
        'outside_loaded_slice',
        { axis: 'period', nearestAlternative: '2010JJ00' },
        cpiIntent({ kind: 'range', from: '2001JJ00', to: '2024JJ00' }),
      ),
      alwaysServable,
      neverLabels,
    );
    for (const { nl, en } of [single, range]) {
      const nlDigits = (nl[0]!.match(/\d+/g) ?? []).sort();
      const enDigits = (en[0]!.match(/\d+/g) ?? []).sort();
      expect(enDigits).toEqual(nlDigits);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. buildRescueOffer — the WP26c rescue chip
// ---------------------------------------------------------------------------

function forecastMisfireParse(question: string, nearest: string[]): Extract<ParseOutcome, { kind: 'refusal' }> {
  const raw: RawParse = {
    version: 4,
    kind: 'forecast_request',
    candidates: [],
    unmatchedMeasureTerm: null,
    nearestCanonicalKeys: nearest,
    note: null,
  };
  return {
    kind: 'refusal',
    question,
    raw,
    model: 'test-model',
    usage: { inputTokens: 0, outputTokens: 0 },
    refusalKind: 'forecast',
    note: null,
  };
}

describe('buildRescueOffer — the rescue chip English label', () => {
  it('forecast misfire: English sibling of "{period} is al gepubliceerd — toon het cijfer voor {label}."', async () => {
    const parse = forecastMisfireParse('Wat was de inflatie in 2024?', [CPI]);
    const offer = await buildRescueOffer(parse, {
      servability: async () => ({ servable: true }),
      freshest: async () => {
        throw new Error('freshest must not be consulted for a forecast rescue (it reads the absolute period)');
      },
    });
    expect(offer).not.toBeNull();
    expect(offer!.label).toBe(`2024 is al gepubliceerd — toon het cijfer voor ${CPI_LABEL}.`);
    expect(offer!.labelEn).toBe(`2024 has already been published — show the figure for ${CPI_LABEL_EN}.`);
    // submit (what the take-path matches / the option carries) is the exact
    // Dutch label, never the English one.
    expect(offer!.option.label).toBe(offer!.label);
  });
});

// ---------------------------------------------------------------------------
// 3. buildQueryRefusal — the region_scope_on_national_measure offer chip
// ---------------------------------------------------------------------------

describe('buildQueryRefusal — the region_scope_on_national_measure offer chip', () => {
  it('carries an English label alongside the Dutch one, submit == the Dutch label', () => {
    const refusal: QueryRefusal = {
      ok: false,
      refusal: {
        kind: 'invalid_intent',
        axis: 'region',
        message: 'stub region_scope_on_national_measure',
        subReason: 'region_scope_on_national_measure',
      },
      intent: {
        schemaVersion: INTENT_SCHEMA_VERSION,
        target: { kind: 'canonical', key: 'unemployment_rate_seasonally_adjusted' },
        period: { kind: 'codes', codes: ['2024KW04'] },
        derivation: 'none',
        regionSet: { kind: 'all_provincies' },
      },
    };
    const built = buildQueryRefusal(refusal);
    if (built.kind !== 'refusal') throw new Error(`expected a refusal, got ${built.kind}`);
    const offerChip = built.refusal.offerChip;
    if (!offerChip) throw new Error('expected an offerChip candidate');
    expect(offerChip.label).toBe(`Wat was de werkloosheid in ${periodCodeToNl('2024KW04')}?`);
    // The Dutch subject is everydayTerms[0] ('werkloosheid', the SHORT term),
    // never definitionLabel ('de seizoengecorrigeerde werkloosheid...') — its
    // English sibling is the matching SHORT term, ENGLISH_TOPIC_TERMS
    // ('unemployment'), not englishMeasureLabel's longer fallback register.
    expect(offerChip.labelEn).toBe(`What was unemployment in ${periodCodeToEn('2024KW04')}?`);
    expect(offerChip.labelEn).not.toBe(offerChip.label);
  });
});

// ---------------------------------------------------------------------------
// 4. decide() — a region_ambiguous click option (Utrecht gemeente/provincie)
// ---------------------------------------------------------------------------

const config: ParserConfig = { answerThreshold: 0.9, runnerUpThreshold: 0.35 };

function context(): OutcomeContext {
  return {
    question: 'Hoeveel inwoners had Utrecht in 2024?',
    raw: {
      version: 4,
      kind: 'data_query',
      candidates: [],
      unmatchedMeasureTerm: null,
      nearestCanonicalKeys: [],
      note: null,
    },
    model: 'test-model',
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

const UTRECHT_GEMEENTE: StructuredIntent = {
  schemaVersion: INTENT_SCHEMA_VERSION,
  target: { kind: 'canonical', key: 'population_on_1_january' },
  regions: ['GM0344'],
  period: { kind: 'codes', codes: ['2024JJ00'] },
  derivation: 'none',
};

const UTRECHT_PROVINCE: StructuredIntent = { ...UTRECHT_GEMEENTE, regions: ['PV26'] };

function utrechtAmbiguity(): ResolutionFailure {
  return {
    axis: 'region',
    reason: 'region_ambiguous',
    message: 'synthetic region_ambiguous',
    options: ['Utrecht (gemeente)', 'Utrecht (PV)'],
    optionIntents: [UTRECHT_GEMEENTE, UTRECHT_PROVINCE],
    optionImpliedRecency: false,
    confidence: 0.9,
    reading: 'bevolking van Utrecht in 2024',
  };
}

describe("decide() — a region_ambiguous click option ('Utrecht (municipality)'/'Utrecht (province)')", () => {
  it('mints two ClickOptions, each carrying the English label, submit == the Dutch label', async () => {
    const outcome = await decide(context(), [utrechtAmbiguity()], config, alwaysServable, undefined, true);
    if (outcome.kind !== 'clarification') throw new Error(`expected a clarification, got ${outcome.kind}`);
    expect(outcome.question_nl).toBe('Bedoel je Utrecht (gemeente) of Utrecht (PV)?');
    expect(outcome.options_en).toEqual(['Utrecht (municipality)', 'Utrecht (province)']);

    const clickOptions = outcome.clickOptions ?? [];
    expect(clickOptions).toHaveLength(2);
    expect(clickOptions.map((o) => o.label)).toEqual(['Utrecht (gemeente)', 'Utrecht (PV)']);
    expect(clickOptions.map((o) => o.labelEn)).toEqual(['Utrecht (municipality)', 'Utrecht (province)']);
    // submit (the take-path match / the option's own `label`) is ALWAYS the
    // Dutch string — never the English one.
    for (const option of clickOptions) {
      expect(option.labelEn).not.toBe(option.label);
    }
  });

  it('the STORED pending carries no labelEn — toClarificationResponse strips it before the envelope/pending are assembled', async () => {
    const outcome = await decide(context(), [utrechtAmbiguity()], config, alwaysServable, undefined, true);
    if (outcome.kind !== 'clarification') throw new Error(`expected a clarification, got ${outcome.kind}`);

    const response = toClarificationResponse({
      question: outcome.question,
      referenceDate: '2026-09-27',
      axes: outcome.axes,
      questionNl: outcome.question_nl,
      options: outcome.options,
      parse: outcome,
      clickOptions: outcome.clickOptions,
      english: {
        question: outcome.question_en ?? '',
        options: outcome.options_en ?? [],
        untranslated: outcome.untranslated_en ?? [],
      },
      englishChips: outcome.options.map((o, i) => ({ label: outcome.options_en?.[i] ?? o, submit: o })),
    });

    const storedOptions = response.pending.clickOptions ?? [];
    expect(storedOptions).toHaveLength(2);
    for (const option of storedOptions) {
      expect(Object.hasOwn(option, 'labelEn')).toBe(false);
    }
    // Dutch bytes are completely unaffected by the strip.
    expect(storedOptions.map((o) => o.label)).toEqual(['Utrecht (gemeente)', 'Utrecht (PV)']);
    expect(response.text).toBe('Bedoel je Utrecht (gemeente) of Utrecht (PV)?');
    // englishChips itself is accepted but not (yet) attached to the envelope
    // (Task 5's job) — the returned response carries no such key today.
    expect(Object.hasOwn(response, 'englishChips')).toBe(false);
  });
});
