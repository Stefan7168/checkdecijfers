// ADR 058 phase 2 (#332), Task 3: English siblings on every clarification
// question. Synthetic candidates only — no LLM, no database — same
// discipline as intent-policy.test.ts, whose helpers (context/candidate/
// failure/alwaysServable/config) this file reuses so the shape of a
// synthetic ResolutionFailure/RankedCandidate stays exactly what decide()
// itself is tested against.
import { describe, expect, it } from 'vitest';
import { buildUnmatchedClarification, decide } from '../../src/answer/intent/index.ts';
import type {
  OutcomeContext,
  ParseOutcome,
  ParserConfig,
  RankedCandidate,
  RawParse,
  ResolutionFailure,
  ServabilityCheck,
} from '../../src/answer/intent/index.ts';
import type { EchoServability, StructuredIntent } from '../../src/query/index.ts';
import { englishMeasureLabel } from '../../src/answer/respond/english.ts';
import { toClarificationResponse } from '../../src/answer/respond/index.ts';
import { CANONICAL_MEASURES } from '../../src/registry/defaults.ts';

// ---------------------------------------------------------------------------
// The same synthetic-fixture helpers as tests/answer/intent-policy.test.ts
// (kept as an exact copy rather than a shared import — that file's helpers
// are module-local, and duplicating four small functions is cheaper than a
// cross-test-file coupling for a handful of one-line builders).
// ---------------------------------------------------------------------------

const config: ParserConfig = { answerThreshold: 0.6, runnerUpThreshold: 0.35 };

const alwaysServable: ServabilityCheck = async () => ({ servable: true });

function intentOf(key: string, year: number, regions?: string[]): StructuredIntent {
  return {
    schemaVersion: 1,
    target: { kind: 'canonical', key },
    ...(regions ? { regions } : {}),
    period: { kind: 'codes', codes: [`${year}JJ00`] },
    derivation: 'none',
  };
}

function candidate(intent: StructuredIntent, confidence: number, reading = 'lezing'): RankedCandidate {
  return { intent, confidence, reading, impliedRecency: false };
}

function failure(
  reason: ResolutionFailure['reason'],
  confidence: number,
  options: string[] = [],
): ResolutionFailure {
  const axis =
    reason === 'max_needs_regions'
      ? 'region'
      : reason === 'max_on_national_measure'
        ? 'derivation'
        : reason.startsWith('region')
          ? 'region'
          : reason.startsWith('period') || reason === 'grain_unavailable'
            ? 'period'
            : 'measure';
  return {
    axis,
    reason,
    message: `synthetic ${reason}`,
    options,
    confidence,
    reading: `lezing met ${reason}`,
  };
}

function context(raw?: Partial<RawParse>, question = 'synthetische vraag'): OutcomeContext {
  return {
    question,
    raw: {
      version: 4,
      kind: 'data_query',
      candidates: [],
      unmatchedMeasureTerm: null,
      nearestCanonicalKeys: [],
      note: null,
      ...raw,
    },
    model: 'test-model',
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

// ---------------------------------------------------------------------------
// Shared assertions: every clarification outcome this file produces must
// hold these regardless of which branch built it.
// ---------------------------------------------------------------------------

/** ' het ', ' een ', ' voor ', ' welke ' — Dutch function words the brief
 * names explicitly. Checked OUTSIDE any untranslated fragment (a model
 * reading or a user's own term legitimately carries Dutch words — that is
 * exactly what untranslated_en exists to disclose). */
const DUTCH_FUNCTION_WORDS = [' het ', ' een ', ' voor ', ' welke '];

function questionMarkCount(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

function assertClarificationEnglishInvariants(outcome: ParseOutcome): void {
  if (outcome.kind !== 'clarification') throw new Error('expected a clarification outcome');
  expect(outcome.question_en, 'question_en must be set on every clarification outcome').toBeTruthy();
  const questionEn = outcome.question_en!;
  expect(
    questionMarkCount(questionEn),
    `question mark count must match: nl=${JSON.stringify(outcome.question_nl)} en=${JSON.stringify(questionEn)}`,
  ).toBe(questionMarkCount(outcome.question_nl));
  expect(outcome.options_en?.length ?? 0, 'options_en must be index-aligned (same length as options)').toBe(
    outcome.options.length,
  );
  let scanned = questionEn;
  for (const fragment of outcome.untranslated_en ?? []) {
    scanned = scanned.split(fragment).join('');
  }
  for (const word of DUTCH_FUNCTION_WORDS) {
    expect(
      scanned,
      `unexpected Dutch word "${word.trim()}" survives outside untranslated_en in "${questionEn}" (stripped: "${scanned}")`,
    ).not.toContain(word);
  }
}

function asClarification(outcome: ParseOutcome): Extract<ParseOutcome, { kind: 'clarification' }> {
  if (outcome.kind !== 'clarification') throw new Error('expected a clarification outcome');
  return outcome;
}

describe('English clarification siblings (ADR 058 phase 2, #332, Task 3)', () => {
  describe('every ResolutionFailure reason (failureQuestionEn sweep)', () => {
    const reasons: ResolutionFailure['reason'][] = [
      'region_ambiguous',
      'region_unknown',
      'region_on_national_measure',
      'max_needs_regions',
      'max_on_national_measure',
      'grain_unavailable',
      'period_missing',
      'period_invalid',
      'unknown_canonical_key',
      'other_source_available',
    ];

    for (const reason of reasons) {
      it(`${reason}: question_en set, one '?' per Dutch '?', options_en index-aligned, no stray Dutch`, async () => {
        const outcome = await decide(
          context(),
          [failure(reason, 0.9, ['optie A', 'optie B'])],
          config,
          alwaysServable,
        );
        assertClarificationEnglishInvariants(outcome);
      });
    }
  });

  it('region_ambiguous: Utrecht municipality vs province (exact English)', async () => {
    const top = failure('region_ambiguous', 0.9, ['Utrecht (gemeente)', 'Utrecht (PV)']);
    const outcome = asClarification(await decide(context(), [top], config, alwaysServable));
    expect(outcome.question_nl).toBe('Bedoel je Utrecht (gemeente) of Utrecht (PV)?');
    expect(outcome.question_en).toBe('Did you mean: Utrecht (municipality) or Utrecht (province)?');
    expect(outcome.options_en).toEqual(['Utrecht (municipality)', 'Utrecht (province)']);
    expect(outcome.untranslated_en ?? []).toEqual([]);
    assertClarificationEnglishInvariants(outcome);
  });

  it('region_unknown: exact English', async () => {
    const top = failure('region_unknown', 0.9, [
      'heel Nederland (landelijk cijfer)',
      'een specifieke gemeente of provincie — noem de naam',
    ]);
    const outcome = asClarification(await decide(context(), [top], config, alwaysServable));
    expect(outcome.question_en).toBe(
      'Which municipality or province do you mean exactly, or do you want the figure for the Netherlands as a whole?',
    );
    expect(outcome.options_en).toEqual([
      'the Netherlands as a whole (national figure)',
      'a specific municipality or province — name it',
    ]);
    assertClarificationEnglishInvariants(outcome);
  });

  it('max_needs_regions: exact English', async () => {
    const top = failure('max_needs_regions', 0.9, []);
    const outcome = asClarification(await decide(context(), [top], config, alwaysServable));
    expect(outcome.question_en).toBe(
      'Which municipalities or provinces do you want to compare? Name at least two in your question.',
    );
    expect(outcome.options_en).toEqual([]);
    assertClarificationEnglishInvariants(outcome);
  });

  it('period_missing: WITH a checked range option, built from the same year parts (not a string translation)', async () => {
    const top = failure('period_missing', 0.9, ['2015 tot en met 2024']);
    const outcome = asClarification(await decide(context(), [top], config, alwaysServable));
    expect(outcome.question_nl).toBe('Voor welke periode wil je dit weten — bijvoorbeeld 2015 tot en met 2024?');
    expect(outcome.question_en).toBe('Which period do you want this for — for example 2015 to 2024?');
    expect(outcome.options_en).toEqual(['2015 to 2024']);
    assertClarificationEnglishInvariants(outcome);
  });

  it('period_missing: WITHOUT a range option, generic English', async () => {
    const top = failure('period_missing', 0.9, []);
    const outcome = asClarification(await decide(context(), [top], config, alwaysServable));
    expect(outcome.question_en).toBe('Which period do you want this for (for example a year or quarter)?');
    expect(outcome.options_en).toEqual([]);
    assertClarificationEnglishInvariants(outcome);
  });

  it('unknown_canonical_key: exact English', async () => {
    const top = failure('unknown_canonical_key', 0.9, []);
    const outcome = asClarification(await decide(context(), [top], config, alwaysServable));
    expect(outcome.question_en).toBe('Which topic from the official CBS figures do you mean exactly?');
    assertClarificationEnglishInvariants(outcome);
  });

  it('grain_unavailable: fixed grain labels translated via FIXED_OPTION_EN', async () => {
    const top = failure('grain_unavailable', 0.9, ['per jaar', 'per kwartaal']);
    const outcome = asClarification(await decide(context(), [top], config, alwaysServable));
    expect(outcome.question_en).toBe('Those figures are only available per year and per quarter — which period do you want them for?');
    expect(outcome.options_en).toEqual(['per year', 'per quarter']);
    assertClarificationEnglishInvariants(outcome);
  });

  it('other_source_available: names Eurostat, keeps the Dutch definition label verbatim in untranslated_en', async () => {
    const top: ResolutionFailure = {
      axis: 'region',
      reason: 'other_source_available',
      message: 'synthetic other_source_available',
      options: ['Toon de Eurostat-cijfers'],
      siblingDefinitionLabel: 'werkloosheidspercentage, geharmoniseerd',
      confidence: 0.9,
      reading: 'werkloosheid in Duitsland',
    };
    const outcome = asClarification(await decide(context(), [top], config, alwaysServable));
    // Like the Dutch original, this is a STATEMENT, not phrased as a
    // question — zero question marks on both sides (checked generically by
    // assertClarificationEnglishInvariants below too).
    expect(questionMarkCount(outcome.question_nl)).toBe(0);
    expect(outcome.question_en).toContain('Eurostat');
    expect(outcome.question_en).toContain('werkloosheidspercentage, geharmoniseerd');
    expect(outcome.untranslated_en).toEqual(['werkloosheidspercentage, geharmoniseerd']);
    expect(outcome.options_en).toEqual(['Show the Eurostat figures']);
    assertClarificationEnglishInvariants(outcome);
  });

  it('rule 3 confirm: the model reading stays verbatim and is listed in untranslated_en', async () => {
    const reading = 'de bevolking van Amsterdam in 2024';
    const top = candidate(intentOf('population_on_1_january', 2024), 0.5, reading);
    const outcome = asClarification(await decide(context(), [top], config, alwaysServable));
    expect(outcome.question_nl).toBe(`Bedoel je ${reading}?`);
    expect(outcome.question_en).toBe(`Did you mean: ${reading}?`);
    expect(outcome.options_en).toEqual([reading]);
    expect(outcome.untranslated_en).toEqual([reading]);
    assertClarificationEnglishInvariants(outcome);
  });

  it('rule 4: two plausible readings, both servable — both kept verbatim, English options index-aligned', async () => {
    const top = candidate(intentOf('cpi_yearly_inflation', 2024), 0.8, 'de inflatie in 2024');
    const runnerUp = candidate(intentOf('average_existing_home_sale_price', 2024), 0.5, 'de huizenprijs in 2024');
    const outcome = asClarification(await decide(context(), [top, runnerUp], config, alwaysServable));
    expect(outcome.question_nl).toBe('Bedoel je de inflatie in 2024 of de huizenprijs in 2024?');
    expect(outcome.question_en).toBe('Did you mean: de inflatie in 2024 or de huizenprijs in 2024?');
    expect(outcome.options_en).toEqual(['de inflatie in 2024', 'de huizenprijs in 2024']);
    expect(outcome.untranslated_en).toEqual(['de inflatie in 2024', 'de huizenprijs in 2024']);
    assertClarificationEnglishInvariants(outcome);
  });

  it('rule 4: solo confirm when only one of two readings survives the dry-run (rule-3-shaped)', async () => {
    const top = candidate(intentOf('cpi_yearly_inflation', 2024), 0.8, 'de inflatie in 2024');
    const runnerUp = candidate(intentOf('average_existing_home_sale_price', 2024), 0.5, 'de huizenprijs in 2024');
    const verdictFor: ServabilityCheck = async (intent) =>
      intent.target.kind === 'canonical' && intent.target.key === 'cpi_yearly_inflation'
        ? { servable: true }
        : { servable: false, kind: 'outside_loaded_slice', axes: null, availability: { yearRange: null, freshest: null } };
    const outcome = asClarification(await decide(context(), [top, runnerUp], config, verdictFor));
    expect(outcome.question_en).toBe('Did you mean: de inflatie in 2024?');
    expect(outcome.options_en).toEqual(['de inflatie in 2024']);
    expect(outcome.untranslated_en).toEqual(['de inflatie in 2024']);
    assertClarificationEnglishInvariants(outcome);
  });

  describe('buildUnmatchedClarification (B15 shape)', () => {
    it('with a nearest canonical key: the English measure label, term kept verbatim', () => {
      const outcome = asClarification(
        buildUnmatchedClarification(
          context({ unmatchedMeasureTerm: 'bijstand', nearestCanonicalKeys: ['unemployment_rate_seasonally_adjusted'] }),
        ),
      );
      const labelEn = englishMeasureLabel('unemployment_rate_seasonally_adjusted');
      expect(outcome.question_en).toContain('"bijstand"');
      expect(outcome.question_en).toContain(labelEn);
      expect(outcome.options_en).toEqual([labelEn]);
      expect(outcome.untranslated_en).toEqual(['bijstand']);
      assertClarificationEnglishInvariants(outcome);
    });

    it('with no nearest key: the fallback list of loaded topics, term kept verbatim', () => {
      const outcome = asClarification(
        buildUnmatchedClarification(context({ unmatchedMeasureTerm: 'gekke term', nearestCanonicalKeys: [] })),
      );
      const expectedOptionsEn = CANONICAL_MEASURES.slice(0, 3).map((m) => englishMeasureLabel(m.key));
      expect(outcome.question_en).toContain('"gekke term"');
      expect(outcome.options_en).toEqual(expectedOptionsEn);
      expect(outcome.untranslated_en).toEqual(['gekke term']);
      assertClarificationEnglishInvariants(outcome);
    });

    it('with NO unmatched term at all: the Dutch filler is translated, not left untranslated', () => {
      const outcome = asClarification(buildUnmatchedClarification(context({ unmatchedMeasureTerm: null })));
      expect(outcome.question_nl).toContain('"dit onderwerp"');
      expect(outcome.question_en).toContain('"this topic"');
      expect(outcome.untranslated_en ?? []).toEqual([]);
      assertClarificationEnglishInvariants(outcome);
    });
  });

  describe('echoUnservableClarification (#56 dry-run fallback) branches', () => {
    const noAvailability = { yearRange: null, freshest: null };
    const unservable = (
      kind: Extract<EchoServability, { servable: false }>['kind'],
      availability: Extract<EchoServability, { servable: false }>['availability'],
      axes: Extract<EchoServability, { servable: false }>['axes'] = null,
    ): EchoServability => ({ servable: false, kind, axes, availability });

    it('needs_clarification WITH a region axis: reading kept verbatim, fixed region options translated', async () => {
      const top = candidate(intentOf('population_on_1_january', 2024), 0.5, 'de bevolking in 2024');
      const verdict = unservable('needs_clarification', noAvailability, ['region']);
      const outcome = asClarification(await decide(context(), [top], config, async () => verdict));
      expect(outcome.question_nl).toBe(
        'Bedoel je de bevolking in 2024? Geef dan ook aan voor welke regio: heel Nederland, of een specifieke gemeente of provincie.',
      );
      expect(outcome.question_en).toBe(
        'Did you mean: de bevolking in 2024? Then also specify the region: the Netherlands as a whole, or a specific municipality or province.',
      );
      expect(outcome.options_en).toEqual([
        'the Netherlands as a whole (national figure)',
        'a specific municipality or province — name it',
      ]);
      expect(outcome.untranslated_en).toEqual(['de bevolking in 2024']);
      assertClarificationEnglishInvariants(outcome);
    });

    it('needs_clarification WITHOUT a region axis: reading kept verbatim, precision ask translated', async () => {
      const top = candidate(intentOf('cpi_yearly_inflation', 2024), 0.5, 'de inflatie in 2024');
      const verdict = unservable('needs_clarification', noAvailability, ['derivation']);
      const outcome = asClarification(await decide(context(), [top], config, async () => verdict));
      expect(outcome.question_nl).toBe('Bedoel je de inflatie in 2024? Kun je de vraag dan iets preciezer stellen?');
      expect(outcome.question_en).toBe(
        'Did you mean: de inflatie in 2024? Could you phrase the question a bit more precisely?',
      );
      expect(outcome.options_en).toEqual(['de inflatie in 2024']);
      expect(outcome.untranslated_en).toEqual(['de inflatie in 2024']);
      assertClarificationEnglishInvariants(outcome);
    });

    it('year-window fallback: built from the same fromYear/toYear as the Dutch, never a string translation', async () => {
      const top = candidate(intentOf('population_on_1_january', 1970), 0.5, 'alle gemeenten vanaf 1970');
      const verdict = unservable('outside_loaded_slice', { yearRange: { fromYear: 2019, toYear: 2026 }, freshest: null }, [
        'period',
      ]);
      const outcome = asClarification(await decide(context(), [top], config, async () => verdict));
      expect(outcome.question_nl).toContain('van 2019 tot en met 2026');
      expect(outcome.question_en).toContain('from 2019 to 2026');
      expect(outcome.options_en).toEqual(['2019 to 2026']);
      expect(outcome.untranslated_en ?? []).toEqual([]);
      assertClarificationEnglishInvariants(outcome);
    });

    it('freshest-period fallback: periodCodeToEn of the same code the Dutch renders', async () => {
      const top = candidate(intentOf('unemployment_rate_seasonally_adjusted', 2030), 0.5, 'werkloosheid in 2030');
      const verdict = unservable('freshness', { yearRange: null, freshest: { periodCode: '2026KW01', status: 'Voorlopig' } });
      const outcome = asClarification(await decide(context(), [top], config, async () => verdict));
      expect(outcome.question_nl).toContain('het eerste kwartaal van 2026');
      expect(outcome.question_en).toContain('the first quarter of 2026');
      expect(outcome.options_en).toEqual(['the first quarter of 2026']);
      assertClarificationEnglishInvariants(outcome);
    });

    it('generic fallback: no availability at all, option-less on both sides', async () => {
      const top = candidate(intentOf('cpi_yearly_inflation', 2024), 0.5, 'iets onduidelijks');
      const outcome = asClarification(
        await decide(context(), [top], config, async () => unservable('internal_inconsistency', noAvailability)),
      );
      expect(outcome.options_en).toEqual([]);
      assertClarificationEnglishInvariants(outcome);
    });
  });
});

describe('toClarificationResponse strips the English keys before storage (ADR 058 phase 2, #332, Task 3)', () => {
  const baseParse: Extract<ParseOutcome, { kind: 'clarification' }> = {
    kind: 'clarification',
    question: 'q',
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
    axes: ['measure'],
    question_nl: 'Bedoel je X?',
    question_en: 'Did you mean: X?',
    options: ['X'],
    options_en: ['X'],
    untranslated_en: ['X'],
    reason: 'test',
  };

  it('the stored parse deep-equals the same parse with the three English keys removed', () => {
    const { question_en, options_en, untranslated_en, ...strippedExpected } = baseParse;
    const response = toClarificationResponse({
      question: 'q',
      referenceDate: '2026-01-01',
      axes: ['measure'],
      questionNl: 'Bedoel je X?',
      options: ['X'],
      parse: baseParse,
    });
    expect(response.parse).toEqual(strippedExpected);
    expect(response.parse).not.toHaveProperty('question_en');
    expect(response.parse).not.toHaveProperty('options_en');
    expect(response.parse).not.toHaveProperty('untranslated_en');
  });

  it('a Dutch-only parse (no English keys at all) is untouched — the pre-Task-3 byte-identity pin', () => {
    const { question_en, options_en, untranslated_en, ...dutchOnly } = baseParse;
    const response = toClarificationResponse({
      question: 'q',
      referenceDate: '2026-01-01',
      axes: ['measure'],
      questionNl: 'Bedoel je X?',
      options: ['X'],
      parse: dutchOnly,
    });
    expect(response.parse).toEqual(dutchOnly);
  });
});
