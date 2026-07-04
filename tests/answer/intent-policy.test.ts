// R7 threshold-policy unit tests — synthetic candidates, no LLM, no database.
// These prove the DECISION rules; the labelled-set regression over real model
// output lives in intent-parse.test.ts (replay fixtures, ADR 012).
import { describe, expect, it } from 'vitest';
import {
  buildUnmatchedClarification,
  decide,
  differingAxes,
  mergeResolutions,
  requestHash,
  stableStringify,
  validateRawParse,
  RawParseValidationError,
} from '../../src/answer/intent/index.ts';
import type {
  CandidateResolution,
  OutcomeContext,
  ParseOutcome,
  ParserConfig,
  RankedCandidate,
  RawParse,
  ResolutionFailure,
  ServabilityCheck,
} from '../../src/answer/intent/index.ts';
import type { EchoServability, StructuredIntent } from '../../src/query/index.ts';
import {
  findNumericTokens,
  normalizeForScan,
  numbersInText,
  periodCodeNumbers,
} from '../../src/answer/compose/format.ts';
import { CANONICAL_MEASURES } from '../../src/registry/defaults.ts';

const config: ParserConfig = { answerThreshold: 0.6, runnerUpThreshold: 0.35 };

/** Stub for tests that exercise the threshold rules themselves: every echo
 * suggestion counts as servable, which is exactly the pre-WP15 behavior the
 * original R7 pins prove. The #56 branch tests below pass real verdicts. */
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

function context(raw?: Partial<RawParse>): OutcomeContext {
  return {
    question: 'synthetische vraag',
    raw: {
      version: 3,
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

describe('R7 threshold policy (docs/05 R7, ADR 012)', () => {
  it('confident single reading above the threshold answers', async () => {
    const outcome = await decide(context(), [candidate(intentOf('cpi_yearly_inflation', 2024), 0.95)], config, alwaysServable);
    expect(outcome.kind).toBe('intent');
    if (outcome.kind !== 'intent') throw new Error('unreachable');
    expect(outcome.confidence).toBe(0.95);
    expect(outcome.ranked).toHaveLength(1);
  });

  it('top candidate below answerThreshold clarifies — never a best guess', async () => {
    const outcome = await decide(context(), [candidate(intentOf('cpi_yearly_inflation', 2024), 0.45)], config, alwaysServable);
    expect(outcome.kind).toBe('clarification');
  });

  it('two materially different readings above runnerUpThreshold clarify with both as options', async () => {
    const a = candidate(intentOf('population_on_1_january', 2024, ['GM0344']), 0.8, 'gemeente Utrecht');
    const b = candidate(intentOf('population_on_1_january', 2024, ['PV26']), 0.5, 'provincie Utrecht');
    const outcome = await decide(context(), [a, b], config, alwaysServable);
    expect(outcome.kind).toBe('clarification');
    if (outcome.kind !== 'clarification') throw new Error('unreachable');
    expect(outcome.axes).toEqual(['region']);
    expect(outcome.options).toEqual(['gemeente Utrecht', 'provincie Utrecht']);
    expect(outcome.question_nl.match(/\?/g)).toHaveLength(1);
  });

  it('a weak second reading below runnerUpThreshold does not block the answer', async () => {
    const a = candidate(intentOf('cpi_yearly_inflation', 2024), 0.9);
    const b = candidate(intentOf('average_existing_home_sale_price', 2024), 0.2);
    const outcome = await decide(context(), [a, b], config, alwaysServable);
    expect(outcome.kind).toBe('intent');
  });

  it('identical resolved intents merge into agreement, not ambiguity — without mutating inputs', async () => {
    const a = candidate(intentOf('cpi_yearly_inflation', 2024), 0.7, 'lezing A');
    const b = candidate(intentOf('cpi_yearly_inflation', 2024), 0.9, 'lezing B');
    const merged = mergeResolutions([a, b]);
    expect(merged).toHaveLength(1);
    const winner = merged[0]!;
    if (!('intent' in winner)) throw new Error('unreachable');
    expect(winner.confidence).toBe(0.9);
    expect(winner.reading).toBe('lezing B');
    // The inputs stay untouched (pure merge) — otherwise the decide()
    // assertion below would be vacuous (review finding, 2026-07-03).
    expect(a.confidence).toBe(0.7);
    expect(a.reading).toBe('lezing A');
    const outcome = await decide(context(), [a, b], config, alwaysServable);
    expect(outcome.kind).toBe('intent');
    if (outcome.kind !== 'intent') throw new Error('unreachable');
    expect(outcome.confidence).toBe(0.9);
    expect(outcome.ranked[0]!.reading).toBe('lezing B');
  });

  it('pins the comparator semantics at the exact threshold boundaries', async () => {
    // Documented rule 3: clarify strictly BELOW answerThreshold — a top
    // reading exactly AT the threshold answers. A refactor flipping < to <=
    // (or >= to > below) must fail here, not silently invert production
    // behavior at the calibrated 0.9/0.35 values (review finding, 2026-07-03).
    const atAnswer = await decide(context(), [candidate(intentOf('cpi_yearly_inflation', 2024), config.answerThreshold)], config, alwaysServable);
    expect(atAnswer.kind).toBe('intent');
    const justBelowAnswer = await decide(context(), [candidate(intentOf('cpi_yearly_inflation', 2024), config.answerThreshold - 1e-9)], config, alwaysServable);
    expect(justBelowAnswer.kind).toBe('clarification');
    // Documented rule 4: a runner-up exactly AT runnerUpThreshold counts as
    // plausible ambiguity (>=, inclusive).
    const atRunnerUp = await decide(
      context(),
      [
        candidate(intentOf('cpi_yearly_inflation', 2024), 0.95),
        candidate(intentOf('average_existing_home_sale_price', 2024), config.runnerUpThreshold),
      ],
      config,
      alwaysServable,
    );
    expect(atRunnerUp.kind).toBe('clarification');
  });

  it('a failed TOP reading exits to clarification — no silent fall-through to a weaker reading', async () => {
    const top = failure('region_ambiguous', 0.9, ['Utrecht (gemeente)', 'Utrecht (PV)']);
    const lower = candidate(intentOf('population_on_1_january', 2024, ['NL01']), 0.5);
    const outcome = await decide(context(), [top, lower], config, alwaysServable);
    expect(outcome.kind).toBe('clarification');
    if (outcome.kind !== 'clarification') throw new Error('unreachable');
    expect(outcome.axes).toEqual(['region']);
    expect(outcome.options).toEqual(['Utrecht (gemeente)', 'Utrecht (PV)']);
  });

  it('a plausible FAILED runner-up still counts as ambiguity', async () => {
    const top = candidate(intentOf('population_on_1_january', 2024, ['NL01']), 0.8);
    const runnerUp = failure('region_ambiguous', 0.5);
    const outcome = await decide(context(), [top, runnerUp], config, alwaysServable);
    expect(outcome.kind).toBe('clarification');
  });

  it('every clarification template asks exactly one compact question', async () => {
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
    ];
    for (const reason of reasons) {
      const outcome = await decide(context(), [failure(reason, 0.9, ['optie A', 'optie B'])], config, alwaysServable);
      expect(outcome.kind).toBe('clarification');
      if (outcome.kind !== 'clarification') throw new Error('unreachable');
      expect(outcome.question_nl.match(/\?/g), `reason ${reason}`).toHaveLength(1);
    }
  });

  it('the #97a max templates name the REAL gap — full-string pins (WP22)', async () => {
    // Hardcoded literals, never derived from policy.ts (punch-a-hole honesty).
    const needsRegions = await decide(context(), [failure('max_needs_regions', 0.9)], config, alwaysServable);
    if (needsRegions.kind !== 'clarification') throw new Error('unreachable');
    expect(needsRegions.question_nl).toBe(
      'Welke gemeentes of provincies wil je met elkaar vergelijken? Noem er minstens twee in je vraag.',
    );
    expect(needsRegions.axes).toEqual(['region']);

    // WITH a checked range option (the resolver's gap-free loaded window):
    const nationalWithOption = await decide(
      context(),
      [failure('max_on_national_measure', 0.9, ['2015 tot en met 2025'])],
      config,
      alwaysServable,
    );
    if (nationalWithOption.kind !== 'clarification') throw new Error('unreachable');
    expect(nationalWithOption.question_nl).toBe(
      'Deze cijfers zijn er alleen voor heel Nederland, dus regio\u2019s vergelijken kan hier niet \u2014 ' +
        'en de periode met de hoogste of laagste waarde opzoeken kan ik nog niet. ' +
        'Wil je in plaats daarvan het verloop zien, bijvoorbeeld van 2015 tot en met 2025?',
    );
    expect(nationalWithOption.axes).toEqual(['derivation']);
    expect(nationalWithOption.options).toEqual(['2015 tot en met 2025']);

    // WITHOUT one (no clean window): generic, still names the real gap,
    // never a grain the measure may not have (adversarial-review catch).
    const national = await decide(context(), [failure('max_on_national_measure', 0.9)], config, alwaysServable);
    if (national.kind !== 'clarification') throw new Error('unreachable');
    expect(national.question_nl).toBe(
      'Deze cijfers zijn er alleen voor heel Nederland, dus regio\u2019s vergelijken kan hier niet \u2014 ' +
        'en de periode met de hoogste of laagste waarde opzoeken kan ik nog niet. ' +
        'Wil je in plaats daarvan het verloop over een periode zien?',
    );
    expect(national.axes).toEqual(['derivation']);
    expect(national.question_nl).not.toContain('per maand');
    // Neither template may ever ask the misleading gemeente-of-provincie
    // question — the exact live-observed #97 failure.
    for (const outcome of [needsRegions, national]) {
      expect(outcome.question_nl).not.toContain('Welke gemeente of provincie bedoel je');
    }
  });

  it('period_missing WITH a range option names it in the question (open-range shape, validation pass 2026-07-04)', async () => {
    const outcome = await decide(context(), [failure('period_missing', 0.9, ['2015 tot en met 2025'])], config, alwaysServable);
    expect(outcome.kind).toBe('clarification');
    if (outcome.kind !== 'clarification') throw new Error('unreachable');
    expect(outcome.question_nl).toBe('Voor welke periode wil je dit weten — bijvoorbeeld 2015 tot en met 2025?');
    expect(outcome.options).toEqual(['2015 tot en met 2025']);
    expect(outcome.axes).toEqual(['period']);
  });

  it('unmatched measure term clarifies on ALL axes at once with loaded-topic options (B15 shape)', async () => {
    const outcome = buildUnmatchedClarification(
      context({ unmatchedMeasureTerm: 'bijstand', nearestCanonicalKeys: ['unemployment_rate_seasonally_adjusted'] }),
    );
    expect(outcome.kind).toBe('clarification');
    if (outcome.kind !== 'clarification') throw new Error('unreachable');
    expect(outcome.axes).toEqual(['measure', 'region', 'period']);
    expect(outcome.question_nl.match(/\?/g)).toHaveLength(1);
    expect(outcome.question_nl).toContain('bijstand');
    expect(outcome.options).toEqual(['werkloosheidspercentage, seizoengecorrigeerd']);
  });

  it('differingAxes names the user-facing shape of the ambiguity', async () => {
    const a = candidate(intentOf('cpi_yearly_inflation', 2024), 0.8);
    const b = candidate(intentOf('cpi_yearly_inflation', 2023), 0.5);
    expect(differingAxes(a, b)).toEqual(['period']);
    const c = candidate(intentOf('average_existing_home_sale_price', 2024), 0.5);
    expect(differingAxes(a, c)).toEqual(['measure']);
  });
});

describe('#56 echo-suggestion servability (WP15, ADR 021 decision 4)', () => {
  const noAvailability = { yearRange: null, freshest: null };
  const unservable = (
    kind: Extract<EchoServability, { servable: false }>['kind'],
    availability: Extract<EchoServability, { servable: false }>['availability'],
    axes: Extract<EchoServability, { servable: false }>['axes'] = null,
  ): EchoServability => ({ servable: false, kind, axes, availability });

  it('a servable low-confidence echo is offered exactly as before', async () => {
    const top = candidate(intentOf('cpi_yearly_inflation', 2024), 0.45, 'de inflatie in 2024');
    const outcome = await decide(context(), [top], config, alwaysServable);
    expect(outcome.kind).toBe('clarification');
    if (outcome.kind !== 'clarification') throw new Error('unreachable');
    expect(outcome.question_nl).toBe('Bedoel je de inflatie in 2024?');
    expect(outcome.options).toEqual(['de inflatie in 2024']);
  });

  it('servability is consulted only on the rule-3 echo path — never on confident answers or two-option ambiguity', async () => {
    let calls = 0;
    const counting: ServabilityCheck = async () => {
      calls += 1;
      return { servable: true };
    };
    await decide(context(), [candidate(intentOf('cpi_yearly_inflation', 2024), 0.95)], config, counting);
    expect(calls).toBe(0);
    await decide(
      context(),
      [
        candidate(intentOf('cpi_yearly_inflation', 2024), 0.8),
        candidate(intentOf('average_existing_home_sale_price', 2024), 0.5),
      ],
      config,
      counting,
    );
    expect(calls).toBe(0);
    await decide(context(), [candidate(intentOf('cpi_yearly_inflation', 2024), 0.45)], config, counting);
    expect(calls).toBe(1);
  });

  it('an unservable echo names the loaded year window instead of the unservable suggestion (V22/V23 shape)', async () => {
    const top = candidate(intentOf('population_on_1_january', 1970), 0.5, 'alle gemeenten vanaf 1970');
    const verdict = unservable('outside_loaded_slice', { yearRange: { fromYear: 2019, toYear: 2026 }, freshest: null }, ['period']);
    const outcome = await decide(context(), [top], config, async () => verdict);
    expect(outcome.kind).toBe('clarification');
    if (outcome.kind !== 'clarification') throw new Error('unreachable');
    expect(outcome.question_nl).toContain('van 2019 tot en met 2026');
    expect(outcome.question_nl.match(/\?/g)).toHaveLength(1);
    expect(outcome.options).toEqual(['2019 tot en met 2026']);
    // The unservable reading is NOT offered as an option (docs/05: options
    // must be concrete and actually available).
    expect(outcome.options).not.toContain('alle gemeenten vanaf 1970');
    expect(outcome.axes).toEqual(['period']);
  });

  it('without a year window the fallback names the freshest loaded period (Dutch rendering, R11 offer discipline)', async () => {
    const top = candidate(intentOf('unemployment_rate_seasonally_adjusted', 2030), 0.5, 'werkloosheid in 2030');
    const verdict = unservable('freshness', { yearRange: null, freshest: { periodCode: '2026KW01', status: 'Voorlopig' } });
    const outcome = await decide(context(), [top], config, async () => verdict);
    expect(outcome.kind).toBe('clarification');
    if (outcome.kind !== 'clarification') throw new Error('unreachable');
    expect(outcome.question_nl).toContain('het eerste kwartaal van 2026');
    expect(outcome.options).toEqual(['het eerste kwartaal van 2026']);
    expect(outcome.axes).toEqual(['period']);
  });

  it('a needs_clarification verdict confirms the reading AND asks the missing region in the same single round', async () => {
    const top = candidate(intentOf('population_on_1_january', 2024), 0.5, 'de bevolking in 2024');
    const verdict = unservable('needs_clarification', noAvailability, ['region']);
    const outcome = await decide(context(), [top], config, async () => verdict);
    expect(outcome.kind).toBe('clarification');
    if (outcome.kind !== 'clarification') throw new Error('unreachable');
    expect(outcome.question_nl).toContain('Bedoel je de bevolking in 2024?');
    expect(outcome.question_nl).toContain('regio');
    expect(outcome.axes).toEqual(['measure', 'region']);
    expect(outcome.options).toEqual([
      'heel Nederland (landelijk cijfer)',
      'een specifieke gemeente of provincie — noem de naam',
    ]);
  });

  it('with no honest availability at all the fallback is a generic, option-less clarification', async () => {
    const top = candidate(intentOf('cpi_yearly_inflation', 2024), 0.5, 'iets onduidelijks');
    const outcome = await decide(context(), [top], config, async () => unservable('internal_inconsistency', noAvailability));
    expect(outcome.kind).toBe('clarification');
    if (outcome.kind !== 'clarification') throw new Error('unreachable');
    expect(outcome.options).toEqual([]);
    expect(outcome.question_nl.match(/\?/g)).toHaveLength(1);
    // The doubtful reading is not echoed as if it were available.
    expect(outcome.options).not.toContain('iets onduidelijks');
  });

  it('a needs_clarification verdict WITHOUT a region axis confirms the reading and asks for precision (the non-region branch)', async () => {
    // Review finding, 2026-07-04: this branch was never exercised.
    const top = candidate(intentOf('cpi_yearly_inflation', 2024), 0.5, 'de inflatie in 2024');
    const verdict = unservable('needs_clarification', noAvailability, ['derivation']);
    const outcome = await decide(context(), [top], config, async () => verdict);
    expect(outcome.kind).toBe('clarification');
    if (outcome.kind !== 'clarification') throw new Error('unreachable');
    expect(outcome.question_nl).toBe('Bedoel je de inflatie in 2024? Kun je de vraag dan iets preciezer stellen?');
    expect(outcome.axes).toEqual(['measure', 'derivation']);
    expect(outcome.options).toEqual(['de inflatie in 2024']);
  });
});

describe('no-numbers belt-check over every policy-built clarification text (principle c; review finding 2026-07-04)', () => {
  // The compose-side R1/R3 validator never sees clarification text (it exits
  // the pipeline before compose), so this scan is the ONLY automated defense
  // against a future edit interpolating an unbacked value into question_nl —
  // the review's executing skeptic proved a fabricated "(intern id 48213)"
  // survived the entire pre-existing suite. Whitelists are built ONLY from
  // the structured inputs each builder legitimately cites (readings, offered
  // options, availability years/periods) — exactly the respond-refusals.test
  // discipline applied to policy.ts.
  function whitelistFrom(sources: { labels?: string[]; periodCodes?: string[] }): Set<number> {
    const numbers = new Set<number>();
    for (const label of sources.labels ?? []) {
      for (const n of numbersInText(label)) numbers.add(n);
    }
    for (const code of sources.periodCodes ?? []) {
      for (const n of periodCodeNumbers(code)) numbers.add(n);
    }
    return numbers;
  }

  function assertNoUnbackedNumbers(outcome: ParseOutcome, whitelist: Set<number>, label: string): void {
    if (outcome.kind !== 'clarification') throw new Error(`${label}: expected a clarification`);
    for (const text of [outcome.question_nl, ...outcome.options]) {
      for (const token of findNumericTokens(normalizeForScan(text))) {
        expect(
          whitelist.has(token.value),
          `${label}: unbacked number '${token.token}' (${token.value}) in ${JSON.stringify(text)}`,
        ).toBe(true);
      }
    }
  }

  it('every clarification-producing branch of decide() carries only input-backed numbers', async () => {
    const reading = 'de bevolking van Amsterdam in 2024';
    // The fallback templates legitimately cite the registry's definition
    // label ("bevolking op 1 januari" — its '1' is registry-sourced, not a
    // cell value), so the label joins the whitelist exactly as
    // respond-refusals.test.ts's fullLabelWhitelist does.
    const definitionLabel = CANONICAL_MEASURES.find((m) => m.key === 'population_on_1_january')!.definitionLabel;
    const top = () => candidate(intentOf('population_on_1_january', 2024), 0.5, reading);
    const cases: { label: string; outcome: ParseOutcome; whitelist: Set<number> }[] = [];

    // Rule 3, servable echo.
    cases.push({
      label: 'servable echo',
      outcome: await decide(context(), [top()], config, async () => ({ servable: true })),
      whitelist: whitelistFrom({ labels: [reading] }),
    });
    // #56 fallback: year window.
    cases.push({
      label: 'unservable year-window fallback',
      outcome: await decide(context(), [top()], config, async () => ({
        servable: false,
        kind: 'outside_loaded_slice',
        axes: ['period'],
        availability: { yearRange: { fromYear: 2019, toYear: 2026 }, freshest: null },
      })),
      whitelist: whitelistFrom({ labels: [reading, definitionLabel], periodCodes: ['2019JJ00', '2026JJ00'] }),
    });
    // #56 fallback: freshest period.
    cases.push({
      label: 'unservable freshest fallback',
      outcome: await decide(context(), [top()], config, async () => ({
        servable: false,
        kind: 'freshness',
        axes: ['period'],
        availability: { yearRange: null, freshest: { periodCode: '2026KW01', status: 'Voorlopig' } },
      })),
      whitelist: whitelistFrom({ labels: [reading, definitionLabel], periodCodes: ['2026KW01'] }),
    });
    // #56 fallback: needs_clarification, region and non-region branches.
    for (const axes of [['region'], ['derivation']] as const) {
      cases.push({
        label: `needs_clarification ${axes[0]}`,
        outcome: await decide(context(), [top()], config, async () => ({
          servable: false,
          kind: 'needs_clarification',
          axes: [...axes],
          availability: { yearRange: null, freshest: null },
        })),
        whitelist: whitelistFrom({ labels: [reading] }),
      });
    }
    // #56 fallback: generic, no availability.
    cases.push({
      label: 'unservable generic fallback',
      outcome: await decide(context(), [top()], config, async () => ({
        servable: false,
        kind: 'internal_inconsistency',
        axes: null,
        availability: { yearRange: null, freshest: null },
      })),
      whitelist: whitelistFrom({ labels: [reading, definitionLabel] }),
    });
    // Rule 2: every resolution-failure template, with numbered options.
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
    ];
    for (const reason of reasons) {
      const options = ['2019 tot en met 2026', 'per kwartaal'];
      cases.push({
        label: `failure ${reason}`,
        outcome: await decide(context(), [failure(reason, 0.9, options)], config, async () => ({ servable: true })),
        whitelist: whitelistFrom({ labels: options }),
      });
    }
    // Unmatched-measure clarification (registry definition labels).
    const unmatchedOutcome = buildUnmatchedClarification(
      context({ unmatchedMeasureTerm: 'bijstand', nearestCanonicalKeys: ['unemployment_rate_seasonally_adjusted'] }),
    );
    cases.push({
      label: 'unmatched measure',
      outcome: unmatchedOutcome,
      whitelist: whitelistFrom({
        labels: unmatchedOutcome.kind === 'clarification' ? unmatchedOutcome.options : [],
      }),
    });

    for (const c of cases) assertNoUnbackedNumbers(c.outcome, c.whitelist, c.label);
  });
});

describe('raw-parse schema validation at the call site (R7)', () => {
  const valid = {
    version: 3,
    kind: 'data_query',
    candidates: [
      {
        canonicalKey: 'cpi_yearly_inflation',
        regions: null,
        period: { kind: 'year', year: 2024 },
        derivation: 'none',
        confidence: 0.9,
        reading: 'inflatie in 2024',
      },
    ],
    unmatchedMeasureTerm: null,
    nearestCanonicalKeys: [],
    note: null,
  };

  it('accepts a valid parse', async () => {
    expect(validateRawParse(JSON.stringify(valid)).kind).toBe('data_query');
  });

  it('rejects non-JSON output', async () => {
    expect(() => validateRawParse('sorry, geen JSON')).toThrow(RawParseValidationError);
  });

  it('rejects a canonical key outside the registry vocabulary', async () => {
    const bad = structuredClone(valid);
    bad.candidates[0]!.canonicalKey = 'made_up_measure';
    expect(() => validateRawParse(JSON.stringify(bad))).toThrow(RawParseValidationError);
  });

  it('rejects unknown fields (strict objects — no smuggled content)', async () => {
    const bad = { ...structuredClone(valid), extra: 'field' };
    expect(() => validateRawParse(JSON.stringify(bad))).toThrow(RawParseValidationError);
  });

  it('rejects the stale version-1 and version-2 contracts — an old fixture or model output must fail loudly', async () => {
    for (const version of [1, 2]) {
      const stale = { ...structuredClone(valid), version };
      expect(() => validateRawParse(JSON.stringify(stale))).toThrow(RawParseValidationError);
    }
  });

  it('accepts the WP14 open-range period kinds (since / last_n / now_vs_ago)', async () => {
    for (const period of [
      { kind: 'since', year: 2015, quarter: null, month: null },
      { kind: 'since', year: 2020, quarter: null, month: 3 },
      { kind: 'last_n', unit: 'year', n: 5 },
      { kind: 'now_vs_ago', unit: 'year', amount: 5 },
    ]) {
      const parse = structuredClone(valid);
      parse.candidates[0]!.period = period as never;
      expect(validateRawParse(JSON.stringify(parse)).candidates[0]!.period).toEqual(period);
    }
  });

  it('rejects a since without its nullable refinement fields — nullable, never optional (structured outputs)', async () => {
    const bad = structuredClone(valid);
    bad.candidates[0]!.period = { kind: 'since', year: 2015 } as never;
    expect(() => validateRawParse(JSON.stringify(bad))).toThrow(RawParseValidationError);
  });

  it('accepts the #77 date_range kind, day-precise and month-only (ADR 023)', async () => {
    for (const period of [
      { kind: 'date_range', from: { year: 2022, month: 1, day: 1 }, to: { year: 2022, month: 12, day: 31 }, toInclusive: true },
      { kind: 'date_range', from: { year: 2020, month: 3, day: null }, to: { year: 2021, month: 6, day: null }, toInclusive: false },
    ]) {
      const parse = structuredClone(valid);
      parse.candidates[0]!.period = period as never;
      expect(validateRawParse(JSON.stringify(parse)).candidates[0]!.period).toEqual(period);
    }
  });

  it('rejects a date_range missing toInclusive or a day field — nullable, never optional', async () => {
    for (const period of [
      { kind: 'date_range', from: { year: 2022, month: 1, day: 1 }, to: { year: 2022, month: 12, day: 31 } },
      { kind: 'date_range', from: { year: 2022, month: 1 }, to: { year: 2022, month: 12, day: 31 }, toInclusive: true },
    ]) {
      const bad = structuredClone(valid);
      bad.candidates[0]!.period = period as never;
      expect(() => validateRawParse(JSON.stringify(bad))).toThrow(RawParseValidationError);
    }
  });
});

describe('fixture request hashing (ADR 012 replay integrity)', () => {
  it('is insensitive to key order but sensitive to content', async () => {
    const requestA = { model: 'm', maxTokens: 1, temperature: 0, system: 's', question: 'q', jsonSchema: { a: 1, b: 2 } };
    const requestB = { jsonSchema: { b: 2, a: 1 }, question: 'q', system: 's', temperature: 0, maxTokens: 1, model: 'm' };
    expect(requestHash(requestA)).toBe(requestHash(requestB));
    expect(requestHash({ ...requestA, question: 'anders' })).not.toBe(requestHash(requestA));
    expect(stableStringify({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
  });
});
