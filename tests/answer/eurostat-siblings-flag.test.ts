// E2a step 5 (docs/superpowers/specs/2026-09-23-eurostat-e2a-country-answers-
// design.md §6 step 5): proves — through the REAL production code paths, not
// just the gate function in isolation (tests/sources/eurostat-siblings.test.ts)
// — that resolveCandidate's default, decide()'s offer-side gate, and the
// click trust boundary's default ALL react to `EUROSTAT_SIBLINGS_ENABLED`
// together, with NO `eurostatSiblings`/`clickValidation` override passed
// anywhere in this file. Uses a REAL reviewed sibling key
// (`eu_unemployment_rate_harmonised`, one of the three from
// EUROSTAT_SIBLINGS_REVIEWED) registered onto the existing synthetic
// Eurostat test table (tests/helpers/eurostat-test-table.ts's optional
// `canonicalKey`), so the map lookup is genuinely the production
// `unemployment_rate_seasonally_adjusted -> eu_unemployment_rate_harmonised`
// pair, not a made-up test key.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { decide, isResolutionFailure, resolveCandidate } from '../../src/answer/intent/index.ts';
import type {
  OutcomeContext,
  ParserConfig,
  PeriodSpec,
  RawCandidate,
  RawParse,
  ServabilityCheck,
} from '../../src/answer/intent/index.ts';
import { isClickTakeableIntent, validateClickOptions } from '../../src/answer/respond/validate-pending.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { insertEurostatTestTable } from '../helpers/eurostat-test-table.ts';
import type { Db } from '../../src/db/types.ts';

const UNEMPLOYMENT_KEY = 'unemployment_rate_seasonally_adjusted';
const REVIEWED_SIBLING_KEY = 'eu_unemployment_rate_harmonised'; // EUROSTAT_SIBLINGS_REVIEWED's real target

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
  // Registers the REAL reviewed key onto the synthetic table — the map
  // lookup this test exercises is genuinely production's
  // unemployment_rate_seasonally_adjusted -> eu_unemployment_rate_harmonised
  // pair, standing in only for the not-yet-registered real eurostat:une_rt_q.
  await insertEurostatTestTable(db, { canonicalKey: REVIEWED_SIBLING_KEY });
}, 300_000);

afterAll(async () => {
  await close();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const YEAR_2021: PeriodSpec = { kind: 'year', year: 2021 };

function candidate(): RawCandidate {
  return {
    canonicalKey: UNEMPLOYMENT_KEY,
    regions: [{ name: 'Duitsland', kind: 'onbekend' }],
    period: YEAR_2021,
    derivation: 'none',
    confidence: 0.9,
    reading: 'test',
  };
}

describe('resolveCandidate default (no eurostatSiblings override) follows EUROSTAT_SIBLINGS_ENABLED', () => {
  it('flag unset: dark — region_on_national_measure, exactly as before step 5', async () => {
    const result = await resolveCandidate(db, candidate(), '2021-06-15');
    expect(isResolutionFailure(result)).toBe(true);
    if (!isResolutionFailure(result)) throw new Error('unreachable');
    expect(result.reason).toBe('region_on_national_measure');
  });

  it('flag = "1": the reviewed pair is active — other_source_available, resolved against the REAL sibling key', async () => {
    vi.stubEnv('EUROSTAT_SIBLINGS_ENABLED', '1');
    const result = await resolveCandidate(db, candidate(), '2021-06-15');
    expect(isResolutionFailure(result)).toBe(true);
    if (!isResolutionFailure(result)) throw new Error('unreachable');
    expect(result.reason).toBe('other_source_available');
    expect(result.optionIntents).toHaveLength(1);
    expect(result.optionIntents?.[0]?.target).toEqual({ kind: 'canonical', key: REVIEWED_SIBLING_KEY });
    expect(result.optionIntents?.[0]?.regions).toEqual(['DE']);
  });

  it('flag = "0" (not the exact string "1"): still dark', async () => {
    vi.stubEnv('EUROSTAT_SIBLINGS_ENABLED', '0');
    const result = await resolveCandidate(db, candidate(), '2021-06-15');
    expect(isResolutionFailure(result)).toBe(true);
    if (!isResolutionFailure(result)) throw new Error('unreachable');
    expect(result.reason).toBe('region_on_national_measure');
  });
});

describe('the offer-side gate (decide()) and the click trust boundary agree with the resolver — no override passed to either', () => {
  const config: ParserConfig = { answerThreshold: 0.9, runnerUpThreshold: 0.35 };
  const servable: ServabilityCheck = async () => ({ servable: true });

  function context(): OutcomeContext {
    const raw: RawParse = {
      version: 3,
      kind: 'data_query',
      candidates: [
        {
          canonicalKey: UNEMPLOYMENT_KEY,
          regions: [{ name: 'Duitsland', kind: 'onbekend' }],
          period: YEAR_2021,
          derivation: 'none',
          confidence: 0.9,
          reading: 'test',
        },
      ],
      unmatchedMeasureTerm: null,
      nearestCanonicalKeys: [],
      note: null,
    };
    return { question: 'Hoe hoog is de werkloosheid in Duitsland?', raw, model: 'test', usage: { inputTokens: 0, outputTokens: 0 } };
  }

  it('flag unset: decide() offers no Eurostat chip (falls back to the plain CBS clarification)', async () => {
    const failure = await resolveCandidate(db, candidate(), '2021-06-15');
    if (!isResolutionFailure(failure)) throw new Error('expected a failure');
    expect(failure.reason).toBe('region_on_national_measure'); // no sibling offered at all

    const outcome = await decide(context(), [failure], config, servable, undefined, true);
    expect(outcome.kind).toBe('clarification');
    if (outcome.kind !== 'clarification') throw new Error('unreachable');
    expect(outcome.clickOptions).toBeUndefined();
    expect(outcome.question_nl).not.toContain('Eurostat');
  });

  it('flag = "1": decide() offers exactly one takeable Eurostat chip, with NO clickValidation override passed', async () => {
    vi.stubEnv('EUROSTAT_SIBLINGS_ENABLED', '1');
    const failure = await resolveCandidate(db, candidate(), '2021-06-15');
    if (!isResolutionFailure(failure)) throw new Error('expected a failure');
    expect(failure.reason).toBe('other_source_available');

    const outcome = await decide(context(), [failure], config, servable, undefined, true);
    expect(outcome.kind).toBe('clarification');
    if (outcome.kind !== 'clarification') throw new Error('unreachable');
    expect(outcome.clickOptions).toHaveLength(1);
    expect(outcome.clickOptions?.[0]?.label).toBe('Toon de Eurostat-cijfers');
    expect(outcome.clickOptions?.[0]?.intent.target).toEqual({ kind: 'canonical', key: REVIEWED_SIBLING_KEY });

    // The click trust boundary (validate-pending.ts), consulted with NO
    // override, must accept the SAME intent decide() just offered — proving
    // the offer-side gate and the click trust boundary genuinely share one
    // map (activeEurostatSiblings()), not two copies that happen to agree
    // today.
    const offeredIntent = outcome.clickOptions![0]!.intent;
    expect(isClickTakeableIntent(offeredIntent)).toBe(true);
    const validated = validateClickOptions([outcome.clickOptions![0]!]);
    expect(validated).toHaveLength(1);
  });

  it('flag unset again (rollback): the click trust boundary reverts to rejecting the sibling key, byte-identical to before step 5', async () => {
    // Build the intent shape a stale client-held chip from a flag-on turn
    // would replay after the owner rolls the flag back off.
    const staleIntent = {
      schemaVersion: 1 as const,
      target: { kind: 'canonical' as const, key: REVIEWED_SIBLING_KEY },
      regions: ['DE'],
      period: { kind: 'codes' as const, codes: ['2021JJ00'] },
      derivation: 'none' as const,
    };
    expect(isClickTakeableIntent(staleIntent)).toBe(false);
    expect(validateClickOptions([{ id: 'opt-1', label: 'Toon de Eurostat-cijfers', intent: staleIntent, impliedRecency: false }])).toEqual(
      [],
    );
  });
});
