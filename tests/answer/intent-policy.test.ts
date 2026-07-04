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
  ParserConfig,
  RankedCandidate,
  RawParse,
  ResolutionFailure,
} from '../../src/answer/intent/index.ts';
import type { StructuredIntent } from '../../src/query/index.ts';

const config: ParserConfig = { answerThreshold: 0.6, runnerUpThreshold: 0.35 };

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
  return {
    axis: reason.startsWith('region') ? 'region' : reason.startsWith('period') || reason === 'grain_unavailable' ? 'period' : 'measure',
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
      version: 1,
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
  it('confident single reading above the threshold answers', () => {
    const outcome = decide(context(), [candidate(intentOf('cpi_yearly_inflation', 2024), 0.95)], config);
    expect(outcome.kind).toBe('intent');
    if (outcome.kind !== 'intent') throw new Error('unreachable');
    expect(outcome.confidence).toBe(0.95);
    expect(outcome.ranked).toHaveLength(1);
  });

  it('top candidate below answerThreshold clarifies — never a best guess', () => {
    const outcome = decide(context(), [candidate(intentOf('cpi_yearly_inflation', 2024), 0.45)], config);
    expect(outcome.kind).toBe('clarification');
  });

  it('two materially different readings above runnerUpThreshold clarify with both as options', () => {
    const a = candidate(intentOf('population_on_1_january', 2024, ['GM0344']), 0.8, 'gemeente Utrecht');
    const b = candidate(intentOf('population_on_1_january', 2024, ['PV26']), 0.5, 'provincie Utrecht');
    const outcome = decide(context(), [a, b], config);
    expect(outcome.kind).toBe('clarification');
    if (outcome.kind !== 'clarification') throw new Error('unreachable');
    expect(outcome.axes).toEqual(['region']);
    expect(outcome.options).toEqual(['gemeente Utrecht', 'provincie Utrecht']);
    expect(outcome.question_nl.match(/\?/g)).toHaveLength(1);
  });

  it('a weak second reading below runnerUpThreshold does not block the answer', () => {
    const a = candidate(intentOf('cpi_yearly_inflation', 2024), 0.9);
    const b = candidate(intentOf('average_existing_home_sale_price', 2024), 0.2);
    const outcome = decide(context(), [a, b], config);
    expect(outcome.kind).toBe('intent');
  });

  it('identical resolved intents merge into agreement, not ambiguity — without mutating inputs', () => {
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
    const outcome = decide(context(), [a, b], config);
    expect(outcome.kind).toBe('intent');
    if (outcome.kind !== 'intent') throw new Error('unreachable');
    expect(outcome.confidence).toBe(0.9);
    expect(outcome.ranked[0]!.reading).toBe('lezing B');
  });

  it('pins the comparator semantics at the exact threshold boundaries', () => {
    // Documented rule 3: clarify strictly BELOW answerThreshold — a top
    // reading exactly AT the threshold answers. A refactor flipping < to <=
    // (or >= to > below) must fail here, not silently invert production
    // behavior at the calibrated 0.9/0.35 values (review finding, 2026-07-03).
    const atAnswer = decide(context(), [candidate(intentOf('cpi_yearly_inflation', 2024), config.answerThreshold)], config);
    expect(atAnswer.kind).toBe('intent');
    const justBelowAnswer = decide(context(), [candidate(intentOf('cpi_yearly_inflation', 2024), config.answerThreshold - 1e-9)], config);
    expect(justBelowAnswer.kind).toBe('clarification');
    // Documented rule 4: a runner-up exactly AT runnerUpThreshold counts as
    // plausible ambiguity (>=, inclusive).
    const atRunnerUp = decide(
      context(),
      [
        candidate(intentOf('cpi_yearly_inflation', 2024), 0.95),
        candidate(intentOf('average_existing_home_sale_price', 2024), config.runnerUpThreshold),
      ],
      config,
    );
    expect(atRunnerUp.kind).toBe('clarification');
  });

  it('a failed TOP reading exits to clarification — no silent fall-through to a weaker reading', () => {
    const top = failure('region_ambiguous', 0.9, ['Utrecht (gemeente)', 'Utrecht (PV)']);
    const lower = candidate(intentOf('population_on_1_january', 2024, ['NL01']), 0.5);
    const outcome = decide(context(), [top, lower], config);
    expect(outcome.kind).toBe('clarification');
    if (outcome.kind !== 'clarification') throw new Error('unreachable');
    expect(outcome.axes).toEqual(['region']);
    expect(outcome.options).toEqual(['Utrecht (gemeente)', 'Utrecht (PV)']);
  });

  it('a plausible FAILED runner-up still counts as ambiguity', () => {
    const top = candidate(intentOf('population_on_1_january', 2024, ['NL01']), 0.8);
    const runnerUp = failure('region_ambiguous', 0.5);
    const outcome = decide(context(), [top, runnerUp], config);
    expect(outcome.kind).toBe('clarification');
  });

  it('every clarification template asks exactly one compact question', () => {
    const reasons: ResolutionFailure['reason'][] = [
      'region_ambiguous',
      'region_unknown',
      'region_on_national_measure',
      'grain_unavailable',
      'period_missing',
      'period_invalid',
      'unknown_canonical_key',
    ];
    for (const reason of reasons) {
      const outcome = decide(context(), [failure(reason, 0.9, ['optie A', 'optie B'])], config);
      expect(outcome.kind).toBe('clarification');
      if (outcome.kind !== 'clarification') throw new Error('unreachable');
      expect(outcome.question_nl.match(/\?/g), `reason ${reason}`).toHaveLength(1);
    }
  });

  it('period_missing WITH a range option names it in the question (open-range shape, validation pass 2026-07-04)', () => {
    const outcome = decide(context(), [failure('period_missing', 0.9, ['2015 tot en met 2025'])], config);
    expect(outcome.kind).toBe('clarification');
    if (outcome.kind !== 'clarification') throw new Error('unreachable');
    expect(outcome.question_nl).toBe('Voor welke periode wil je dit weten — bijvoorbeeld 2015 tot en met 2025?');
    expect(outcome.options).toEqual(['2015 tot en met 2025']);
    expect(outcome.axes).toEqual(['period']);
  });

  it('unmatched measure term clarifies on ALL axes at once with loaded-topic options (B15 shape)', () => {
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

  it('differingAxes names the user-facing shape of the ambiguity', () => {
    const a = candidate(intentOf('cpi_yearly_inflation', 2024), 0.8);
    const b = candidate(intentOf('cpi_yearly_inflation', 2023), 0.5);
    expect(differingAxes(a, b)).toEqual(['period']);
    const c = candidate(intentOf('average_existing_home_sale_price', 2024), 0.5);
    expect(differingAxes(a, c)).toEqual(['measure']);
  });
});

describe('raw-parse schema validation at the call site (R7)', () => {
  const valid = {
    version: 1,
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

  it('accepts a valid parse', () => {
    expect(validateRawParse(JSON.stringify(valid)).kind).toBe('data_query');
  });

  it('rejects non-JSON output', () => {
    expect(() => validateRawParse('sorry, geen JSON')).toThrow(RawParseValidationError);
  });

  it('rejects a canonical key outside the registry vocabulary', () => {
    const bad = structuredClone(valid);
    bad.candidates[0]!.canonicalKey = 'made_up_measure';
    expect(() => validateRawParse(JSON.stringify(bad))).toThrow(RawParseValidationError);
  });

  it('rejects unknown fields (strict objects — no smuggled content)', () => {
    const bad = { ...structuredClone(valid), extra: 'field' };
    expect(() => validateRawParse(JSON.stringify(bad))).toThrow(RawParseValidationError);
  });
});

describe('fixture request hashing (ADR 012 replay integrity)', () => {
  it('is insensitive to key order but sensitive to content', () => {
    const requestA = { model: 'm', maxTokens: 1, temperature: 0, system: 's', question: 'q', jsonSchema: { a: 1, b: 2 } };
    const requestB = { jsonSchema: { b: 2, a: 1 }, question: 'q', system: 's', temperature: 0, maxTokens: 1, model: 'm' };
    expect(requestHash(requestA)).toBe(requestHash(requestB));
    expect(requestHash({ ...requestA, question: 'anders' })).not.toBe(requestHash(requestA));
    expect(stableStringify({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
  });
});
