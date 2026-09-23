// Eurostat E2a Task 2 (docs/superpowers/specs/2026-09-23-eurostat-e2a-
// country-answers-design.md §3/§4.3/§4.4): the `other_source_available`
// clarification chip. Hermetic: the real CBS ingest fixtures
// (createIngestedDb(), same as intent-resolve.test.ts) PLUS Task 1's shared
// hand-inserted Eurostat table (tests/helpers/eurostat-test-table.ts).
//
// `activeEurostatSiblings()` is EMPTY in production (dark unless env
// `EUROSTAT_SIBLINGS_ENABLED` is exactly '1' — E2a step 6) — every test here
// injects `eurostatSiblings` via resolveCandidate's options so production
// behaviour is never touched by this suite. (Flag-gating itself is covered by
// tests/sources/eurostat-siblings.test.ts and
// tests/answer/eurostat-siblings-flag.test.ts.)
//
// Reason-shape note (R3, checked empirically before writing these tests,
// recorded in the Task 2 report): `unemployment_rate_seasonally_adjusted`
// (85224NED) has NO GeoDimension (confirmed against
// tests/fixtures/cbs/85224NED/dimensions.json) — CBS publishes it
// nationally only. Per src/answer/intent/prompt.ts:190 ("'land' for
// Nederland; otherwise 'onbekend'"), the parser tags a foreign country name
// like "Duitsland" as kind 'onbekend', never 'land' — 'land' is reserved for
// Nederland itself. With that REALISTIC kind, resolveRegions's
// `!geo.geoDimension` branch already treats a non-Nederland name as a
// sub-national mismatch and fails as `region_on_national_measure` (verified
// live: a synthetic probe against the real hermetic DB before any change in
// this task). `population_on_1_january` (has a real GM/PV/LD/NL geo
// dimension) is used for the `region_unknown` variants, mirroring the
// existing "Atlantis" pin in intent-resolve.test.ts.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { decide, isResolutionFailure, resolveCandidate } from '../../src/answer/intent/index.ts';
import type {
  OutcomeContext,
  ParserConfig,
  PeriodSpec,
  RawCandidate,
  RawParse,
  RegionTerm,
  ResolutionFailure,
  ServabilityCheck,
} from '../../src/answer/intent/index.ts';
import type { EchoServability } from '../../src/query/index.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { EUROSTAT_TEST_CANONICAL_KEY, insertEurostatTestTable } from '../helpers/eurostat-test-table.ts';
import type { Db } from '../../src/db/types.ts';

const UNEMPLOYMENT_KEY = 'unemployment_rate_seasonally_adjusted';
const POPULATION_KEY = 'population_on_1_january';
const UNEMPLOYMENT_SIBLING = { [UNEMPLOYMENT_KEY]: EUROSTAT_TEST_CANONICAL_KEY };
const POPULATION_SIBLING = { [POPULATION_KEY]: EUROSTAT_TEST_CANONICAL_KEY };
const SIBLING_DEFINITION_LABEL = 'geharmoniseerde werkloosheid (Eurostat, synthetisch testcijfer)';

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
  await insertEurostatTestTable(db);
}, 300_000);

afterAll(async () => {
  await close();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function raw(
  canonicalKey: string,
  period: PeriodSpec,
  regions: RegionTerm[] | null,
  derivation: RawCandidate['derivation'] = 'none',
): RawCandidate {
  return { canonicalKey, regions, period, derivation, confidence: 0.9, reading: 'test' };
}

const YEAR_2021: PeriodSpec = { kind: 'year', year: 2021 };
const YEAR_2024: PeriodSpec = { kind: 'year', year: 2024 };

describe('Eurostat sibling check (other_source_available)', () => {
  it('1. "werkloosheid" (national CBS measure) + Duitsland: fails as other_source_available, never a resolved answer', async () => {
    const candidate = raw(UNEMPLOYMENT_KEY, YEAR_2021, [{ name: 'Duitsland', kind: 'onbekend' }]);
    const result = await resolveCandidate(db, candidate, '2021-06-15', { eurostatSiblings: UNEMPLOYMENT_SIBLING });
    expect(isResolutionFailure(result)).toBe(true);
    if (!isResolutionFailure(result)) throw new Error('unreachable');
    expect(result.reason).toBe('other_source_available');
    expect(result.axis).toBe('region');
    expect(result.options).toEqual(['Toon de Eurostat-cijfers']);
    expect(result.siblingDefinitionLabel).toBe(SIBLING_DEFINITION_LABEL);
    expect(result.optionIntents).toHaveLength(1);
    const optionIntent = result.optionIntents?.[0];
    expect(optionIntent).not.toBeNull();
    expect(optionIntent?.target).toEqual({ kind: 'canonical', key: EUROSTAT_TEST_CANONICAL_KEY });
    expect(optionIntent?.regions).toEqual(['DE']);
  });

  it('2. Nederland + Duitsland: other_source_available, both regions resolved from Eurostat (one source per answer)', async () => {
    const candidate = raw(UNEMPLOYMENT_KEY, YEAR_2021, [
      { name: 'Nederland', kind: 'land' },
      { name: 'Duitsland', kind: 'onbekend' },
    ]);
    const result = await resolveCandidate(db, candidate, '2021-06-15', { eurostatSiblings: UNEMPLOYMENT_SIBLING });
    expect(isResolutionFailure(result)).toBe(true);
    if (!isResolutionFailure(result)) throw new Error('unreachable');
    expect(result.reason).toBe('other_source_available');
    expect(result.optionIntents?.[0]?.regions).toEqual(['NL', 'DE']);
  });

  it('3. Duitsland + Japan: region_unknown unchanged (a partially-resolvable list never answers half)', async () => {
    const candidate = raw(POPULATION_KEY, YEAR_2024, [
      { name: 'Duitsland', kind: 'onbekend' },
      { name: 'Japan', kind: 'onbekend' },
    ]);
    const result = await resolveCandidate(db, candidate, '2024-06-15', { eurostatSiblings: POPULATION_SIBLING });
    expect(isResolutionFailure(result)).toBe(true);
    if (!isResolutionFailure(result)) throw new Error('unreachable');
    expect(result.reason).toBe('region_unknown');
    expect(result.optionIntents).toBeUndefined();
  });

  it('4. Duitsland with an EMPTY sibling map: region_unknown unchanged (dark in production)', async () => {
    const candidate = raw(POPULATION_KEY, YEAR_2024, [{ name: 'Duitsland', kind: 'onbekend' }]);
    const result = await resolveCandidate(db, candidate, '2024-06-15', { eurostatSiblings: {} });
    expect(isResolutionFailure(result)).toBe(true);
    if (!isResolutionFailure(result)) throw new Error('unreachable');
    expect(result.reason).toBe('region_unknown');
  });

  it('5. Amsterdam (CBS-resolvable): normal CBS resolution, sibling never consulted', async () => {
    const candidate = raw(POPULATION_KEY, YEAR_2024, [{ name: 'Amsterdam', kind: 'gemeente' }]);
    const result = await resolveCandidate(db, candidate, '2024-06-15', { eurostatSiblings: POPULATION_SIBLING });
    expect(isResolutionFailure(result)).toBe(false);
    if (isResolutionFailure(result)) throw new Error('unreachable');
    expect(result.intent.regions).toEqual(['GM0363']);
    expect(result.intent.target).toEqual({ kind: 'canonical', key: POPULATION_KEY });
  });

  it('6. A measure with no sibling entry + Duitsland: region_unknown (default activeEurostatSiblings() is empty)', async () => {
    vi.stubEnv('EUROSTAT_SIBLINGS_ENABLED', '');
    const candidate = raw(POPULATION_KEY, YEAR_2024, [{ name: 'Duitsland', kind: 'onbekend' }]);
    // No eurostatSiblings passed: defaults to activeEurostatSiblings(), which
    // is empty with the flag explicitly unset — population_on_1_january has
    // no entry there either way (it's not one of the three reviewed pairs).
    const result = await resolveCandidate(db, candidate, '2024-06-15');
    expect(isResolutionFailure(result)).toBe(true);
    if (!isResolutionFailure(result)) throw new Error('unreachable');
    expect(result.reason).toBe('region_unknown');
  });

  it('7. Sibling key present in the map but missing from canonical_measures: region_unknown, no crash', async () => {
    const candidate = raw(POPULATION_KEY, YEAR_2024, [{ name: 'Duitsland', kind: 'onbekend' }]);
    const result = await resolveCandidate(db, candidate, '2024-06-15', {
      eurostatSiblings: { [POPULATION_KEY]: 'does_not_exist_canonical_key' },
    });
    expect(isResolutionFailure(result)).toBe(true);
    if (!isResolutionFailure(result)) throw new Error('unreachable');
    expect(result.reason).toBe('region_unknown');
  });

  describe('8. through the policy layer (clarificationFromFailure via decide())', () => {
    const config: ParserConfig = { answerThreshold: 0.9, runnerUpThreshold: 0.35 };
    const servable: ServabilityCheck = async () => ({ servable: true });
    const notServable: ServabilityCheck = async () => ({
      servable: false,
      kind: 'no_data',
      axes: null,
      availability: { yearRange: null, freshest: null },
    });

    function context(question: string, failure: ResolutionFailure): OutcomeContext {
      const raw: RawParse = {
        version: 3,
        kind: 'data_query',
        candidates: [
          {
            canonicalKey: UNEMPLOYMENT_KEY,
            regions: [{ name: 'Duitsland', kind: 'onbekend' }],
            period: YEAR_2021,
            derivation: 'none',
            confidence: failure.confidence,
            reading: failure.reading,
          },
        ],
        unmatchedMeasureTerm: null,
        nearestCanonicalKeys: [],
        note: null,
      };
      return { question, raw, model: 'test', usage: { inputTokens: 0, outputTokens: 0 } };
    }

    async function siblingFailure(): Promise<ResolutionFailure> {
      const candidate = raw(UNEMPLOYMENT_KEY, YEAR_2021, [{ name: 'Duitsland', kind: 'onbekend' }]);
      const result = await resolveCandidate(db, candidate, '2021-06-15', { eurostatSiblings: UNEMPLOYMENT_SIBLING });
      if (!isResolutionFailure(result)) throw new Error('expected a resolution failure');
      return result;
    }

    // The CBS clarification the sibling check replaced — what the reader
    // gets whenever the Eurostat chip cannot be offered (fix wave I6).
    // unemployment_rate_seasonally_adjusted is national-only, so a foreign
    // place fails as region_on_national_measure (R3).
    const CBS_FALLBACK_QUESTION =
      'Die cijfers heb ik alleen voor heel Nederland, niet per gemeente of buurt — wil je het landelijke cijfer?';

    it('servable: question names the source + the one caveat, exactly one chip labelled "Toon de Eurostat-cijfers"', async () => {
      const failure = await siblingFailure();
      const outcome = await decide(
        context('Hoe hoog is de werkloosheid in Duitsland?', failure),
        [failure],
        config,
        servable,
        undefined,
        true,
        // The same injected pair the resolver got, for the offer-side click
        // trust-boundary gate (fix wave C1) — without it the production map
        // (empty) would make the chip untakeable, and it is not offered.
        { eurostatSiblings: UNEMPLOYMENT_SIBLING },
      );
      expect(outcome.kind).toBe('clarification');
      if (outcome.kind !== 'clarification') throw new Error('unreachable');
      expect(outcome.question_nl).toBe(
        `Voor dit antwoord gebruiken we Eurostat: ${SIBLING_DEFINITION_LABEL}. ` +
          'Eurostat hanteert één definitie voor alle landen; die kan afwijken van de CBS-definitie.',
      );
      expect(outcome.options).toEqual(['Toon de Eurostat-cijfers']);
      expect(outcome.clickOptions).toHaveLength(1);
      expect(outcome.clickOptions?.[0]?.label).toBe('Toon de Eurostat-cijfers');
      expect(outcome.clickOptions?.[0]?.intent.regions).toEqual(['DE']);
    });

    // Fix wave I6: a Eurostat question with no chip is a dead end (a typed
    // reply merges back to the CBS key and ends still-ambiguous), so every
    // no-chip case renders the ORIGINAL CBS clarification instead — byte-
    // identical to what the reader would have got with no sibling pair.
    async function expectCbsFallback(outcomePromise: ReturnType<typeof decide>): Promise<void> {
      const outcome = await outcomePromise;
      expect(outcome.kind).toBe('clarification');
      if (outcome.kind !== 'clarification') throw new Error('unreachable');
      expect(outcome.clickOptions).toBeUndefined();
      expect(outcome.question_nl).toBe(CBS_FALLBACK_QUESTION);
      expect(outcome.question_nl).not.toContain('Eurostat');
      expect(outcome.options).not.toContain('Toon de Eurostat-cijfers');
      expect(outcome.axes).toEqual(['region']);
    }

    it('not servable (offer-time dry-run refuses): no chip, and the original CBS clarification instead of dead Eurostat text', async () => {
      const failure = await siblingFailure();
      expect(failure.fallback?.reason).toBe('region_on_national_measure');
      await expectCbsFallback(
        decide(context('Hoe hoog is de werkloosheid in Duitsland?', failure), [failure], config, notServable, undefined, true, {
          eurostatSiblings: UNEMPLOYMENT_SIBLING,
        }),
      );
    });

    it('click options disabled (the rollback state): the original CBS clarification', async () => {
      const failure = await siblingFailure();
      await expectCbsFallback(
        decide(context('Hoe hoog is de werkloosheid in Duitsland?', failure), [failure], config, servable, undefined, false, {
          eurostatSiblings: UNEMPLOYMENT_SIBLING,
        }),
      );
    });

    it('chip not click-takeable (trust-boundary gate: sibling key unknown to the click validator): no chip, the original CBS clarification', async () => {
      const failure = await siblingFailure();
      // No clickValidation passed → the production sibling map (empty), under
      // which the click trust boundary would strip this chip — so it is never
      // offered (C1 defence in depth), and I6 falls back.
      await expectCbsFallback(
        decide(context('Hoe hoog is de werkloosheid in Duitsland?', failure), [failure], config, servable, undefined, true),
      );
    });
  });
});

// Fix round 1 (reviewer finding #2, controller ruling R5, 2026-09-23): the
// `!geo.geoDimension` branch in resolveRegions used to let a `kind: 'land'`
// term skip the sub-national mismatch check UNCONDITIONALLY, regardless of
// its name — so "Duitsland" tagged 'land' on a national-only CBS measure
// silently resolved as the Dutch national figure instead of failing
// honestly. The model tagging a foreign country as 'land' is plausible
// (prompt.ts's "'land' for Nederland" guidance is not something this code
// can enforce upstream), so this was a live principle-(c) risk once Eurostat
// awareness exists. Fixed to judge purely on the NAME (the pre-existing
// Nederland regex), never the kind.
describe('kind:\'land\' on a national-only measure judges the NAME, not the kind (fix round 1)', () => {
  it('(a) Duitsland tagged "land", no sibling: region_on_national_measure (was: silent national answer)', async () => {
    const candidate = raw(UNEMPLOYMENT_KEY, YEAR_2021, [{ name: 'Duitsland', kind: 'land' }]);
    const result = await resolveCandidate(db, candidate, '2021-06-15');
    expect(isResolutionFailure(result)).toBe(true);
    if (!isResolutionFailure(result)) throw new Error('unreachable');
    expect(result.reason).toBe('region_on_national_measure');
  });

  it('(b) Duitsland tagged "land", sibling registered: other_source_available', async () => {
    const candidate = raw(UNEMPLOYMENT_KEY, YEAR_2021, [{ name: 'Duitsland', kind: 'land' }]);
    const result = await resolveCandidate(db, candidate, '2021-06-15', { eurostatSiblings: UNEMPLOYMENT_SIBLING });
    expect(isResolutionFailure(result)).toBe(true);
    if (!isResolutionFailure(result)) throw new Error('unreachable');
    expect(result.reason).toBe('other_source_available');
    expect(result.optionIntents?.[0]?.regions).toEqual(['DE']);
  });

  // unemployment_rate_seasonally_adjusted publishes no yearly grain (its JJ
  // cells are CBS reason "Impossible" — see src/registry/defaults.ts's note
  // on this key), so these two use {kind:'latest'} rather than YEAR_2021 —
  // the region axis is what's under test, not the period axis.
  const LATEST: PeriodSpec = { kind: 'latest' };

  it('(c) Nederland tagged "land" still resolves nationally, byte-identical', async () => {
    const candidate = raw(UNEMPLOYMENT_KEY, LATEST, [{ name: 'Nederland', kind: 'land' }]);
    const result = await resolveCandidate(db, candidate, '2021-06-15', { eurostatSiblings: UNEMPLOYMENT_SIBLING });
    expect(isResolutionFailure(result)).toBe(false);
    if (isResolutionFailure(result)) throw new Error('unreachable');
    expect(result.intent.target).toEqual({ kind: 'canonical', key: UNEMPLOYMENT_KEY });
    expect(result.intent.regions).toBeUndefined();
  });

  it('(c\') "heel Nederland" tagged "land" also still resolves nationally', async () => {
    const candidate = raw(UNEMPLOYMENT_KEY, LATEST, [{ name: 'heel Nederland', kind: 'land' }]);
    const result = await resolveCandidate(db, candidate, '2021-06-15');
    expect(isResolutionFailure(result)).toBe(false);
  });
});
