// #267 (ADR 054 task 9): the parser's region-CLASS classification
// (raw-parse v4 `regionScope`) → StructuredIntent.regionSet, hermetic against
// the fixture-ingested database. No LLM anywhere: this pins the deterministic
// half — what code does with each classification the model can emit — and
// the two places the class must survive a turn boundary (the conversation
// context and the policy's region-axis comparison).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isResolutionFailure, resolveCandidate } from '../../src/answer/intent/index.ts';
import type { PeriodSpec, RawCandidate, RegionScopeKind, RegionTerm } from '../../src/answer/intent/types.ts';
import { differingAxes } from '../../src/answer/intent/policy.ts';
import { buildConversationContext, validateConversationContext } from '../../src/answer/context/index.ts';
import { runQuery } from '../../src/query/index.ts';
import type { StructuredIntent } from '../../src/query/index.ts';
import type { ComposedResponse } from '../../src/answer/respond/types.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';

const REFERENCE_DATE = '2026-08-15';
const POPULATION = 'population_on_1_january';
const HOUSE_PRICE = 'average_home_sale_price_by_gemeente';
const UNEMPLOYMENT = 'unemployment_rate_seasonally_adjusted';

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

function raw(
  canonicalKey: string,
  period: PeriodSpec,
  regionScope: RegionScopeKind | null,
  regions: RegionTerm[] | null = null,
  derivation: RawCandidate['derivation'] = 'none',
): RawCandidate {
  return { canonicalKey, regions, regionScope, period, derivation, confidence: 0.9, reading: 'test' };
}

async function resolved(candidate: RawCandidate) {
  const result = await resolveCandidate(db, candidate, REFERENCE_DATE);
  if (isResolutionFailure(result)) {
    throw new Error(`expected resolution, got failure: ${result.reason} (${result.message})`);
  }
  return result.intent;
}

async function failed(candidate: RawCandidate) {
  const result = await resolveCandidate(db, candidate, REFERENCE_DATE);
  if (!isResolutionFailure(result)) {
    throw new Error(`expected failure, got intent ${JSON.stringify(result.intent)}`);
  }
  return result;
}

const Y2025: PeriodSpec = { kind: 'year', year: 2025 };
const Y2024: PeriodSpec = { kind: 'year', year: 2024 };

describe('regionScope → StructuredIntent.regionSet (the model names a class, code builds it)', () => {
  it('all_provincies becomes a class intent with no region list — and the query layer answers it as a region set', async () => {
    const intent = await resolved(raw(POPULATION, Y2025, 'all_provincies'));
    expect(intent.regionSet).toEqual({ kind: 'all_provincies' });
    expect('regions' in intent).toBe(false);
    expect(intent.period).toEqual({ kind: 'codes', codes: ['2025JJ00'] });

    const result = await runQuery(db, intent);
    if (!result.ok) throw new Error(`expected a result, got ${result.refusal.kind}: ${result.refusal.message}`);
    expect(result.shape).toBe('region_set');
  });

  it('gemeenten_in_provincie resolves its one place AS the provincie — "Utrecht" is not gemeente-vs-provincie ambiguous here', async () => {
    const intent = await resolved(raw(HOUSE_PRICE, Y2024, 'gemeenten_in_provincie', [{ name: 'Utrecht', kind: 'onbekend' }], 'max'));
    expect(intent.regionSet).toEqual({ kind: 'gemeenten_in_provincie', parent: 'PV26' });
    expect('regions' in intent).toBe(false);
    // A class IS the comparison set: no max_needs_regions clarification.
    expect(intent.derivation).toBe('max');
  });

  it('the class overrides a gemeente kind the model attached to the parent', async () => {
    const intent = await resolved(raw(HOUSE_PRICE, Y2024, 'gemeenten_in_provincie', [{ name: 'Groningen', kind: 'gemeente' }]));
    expect(intent.regionSet).toEqual({ kind: 'gemeenten_in_provincie', parent: 'PV20' });
  });

  it('"de gemeenten in Nederland" is every gemeente', async () => {
    const intent = await resolved(raw(POPULATION, Y2024, 'gemeenten_in_provincie', [{ name: 'Nederland', kind: 'land' }]));
    expect(intent.regionSet).toEqual({ kind: 'all_gemeenten' });
  });

  it('gemeenten_in_provincie without a province, or with several places, asks instead of guessing (principle c)', async () => {
    const none = await failed(raw(HOUSE_PRICE, Y2024, 'gemeenten_in_provincie'));
    expect(none.axis).toBe('region');
    expect(none.reason).toBe('region_unknown');
    expect(none.options.length).toBeGreaterThan(0);

    const two = await failed(
      raw(HOUSE_PRICE, Y2024, 'gemeenten_in_provincie', [
        { name: 'Utrecht', kind: 'provincie' },
        { name: 'Gelderland', kind: 'provincie' },
      ]),
    );
    expect(two.reason).toBe('region_unknown');
    expect(two.message).toMatch(/names 2 places/);
  });

  it('an unknown province fails like any unknown place', async () => {
    const failure = await failed(raw(HOUSE_PRICE, Y2024, 'gemeenten_in_provincie', [{ name: 'Atlantis', kind: 'onbekend' }]));
    expect(failure.reason).toBe('region_unknown');
  });

  it('places the user NAMED win over a class the model attached', async () => {
    const intent = await resolved(raw(POPULATION, Y2024, 'all_provincies', [{ name: 'Amsterdam', kind: 'gemeente' }]));
    expect(intent.regions).toEqual(['GM0363']);
    expect('regionSet' in intent).toBe(false);
  });

  it('"Nederland" next to a class is not a named place — the class stands', async () => {
    const intent = await resolved(raw(POPULATION, Y2025, 'all_provincies', [{ name: 'Nederland', kind: 'land' }]));
    expect(intent.regionSet).toEqual({ kind: 'all_provincies' });
    expect('regions' in intent).toBe(false);
  });

  it('a class on a national-only measure reaches the query layer, which refuses it as region_scope_on_national_measure — never a relabelled national figure', async () => {
    const quarter: PeriodSpec = { kind: 'quarter', year: 2025, quarter: 2 };
    for (const [scope, regions, expected] of [
      ['all_provincies', null, { kind: 'all_provincies' }],
      // A province cannot be resolved on a table with no regions at all; the
      // refusal does not depend on which class was asked.
      ['gemeenten_in_provincie', [{ name: 'Utrecht', kind: 'provincie' }], { kind: 'all_gemeenten' }],
    ] as const) {
      const intent = await resolved(raw(UNEMPLOYMENT, quarter, scope, regions ? [...regions] : null));
      expect(intent.regionSet).toEqual(expected);
      const result = await runQuery(db, intent);
      if (result.ok) throw new Error('expected a refusal');
      expect(result.refusal.kind).toBe('invalid_intent');
      expect(result.refusal.subReason).toBe('region_scope_on_national_measure');
    }
  });

  it('no class (null or absent) keeps the pre-v4 path byte-for-byte: "meeste" without regions still asks for them', async () => {
    for (const candidate of [
      raw(POPULATION, Y2024, null, null, 'max'),
      { canonicalKey: POPULATION, regions: null, period: Y2024, derivation: 'max', confidence: 0.9, reading: 'test' } as RawCandidate,
    ]) {
      const failure = await failed(candidate);
      expect(failure.reason).toBe('max_needs_regions');
    }
  });
});

function classIntent(regionSet: StructuredIntent['regionSet'], key = POPULATION): StructuredIntent {
  return {
    schemaVersion: 1,
    target: { kind: 'canonical', key },
    ...(regionSet ? { regionSet } : {}),
    period: { kind: 'codes', codes: ['2024JJ00'] },
    derivation: 'none',
  };
}
function answerWith(intent: StructuredIntent): ComposedResponse {
  return { kind: 'answer', result: { intent } } as unknown as ComposedResponse;
}

describe('the region class survives a turn boundary (conversation context)', () => {
  it('builds the class into the context, with the parent provincie as its one region term', async () => {
    const all = await buildConversationContext(db, answerWith(classIntent({ kind: 'all_provincies' })));
    expect(all).toEqual({
      version: 1,
      topicKey: POPULATION,
      regions: null,
      regionScope: 'all_provincies',
      period: { kind: 'year', year: 2024 },
      derivation: 'none',
    });

    const inUtrecht = await buildConversationContext(
      db,
      answerWith(classIntent({ kind: 'gemeenten_in_provincie', parent: 'PV26' }, HOUSE_PRICE)),
    );
    expect(inUtrecht?.regionScope).toBe('gemeenten_in_provincie');
    expect(inUtrecht?.regions).toEqual([{ name: 'Utrecht', kind: 'provincie' }]);

    // Round-trips through the untrusted-client validator unchanged.
    expect(await validateConversationContext(db, all)).toEqual(all);
    expect(await validateConversationContext(db, inUtrecht)).toEqual(inUtrecht);
  });

  it('a context without a class keeps its exact pre-#267 shape (present-only)', async () => {
    const context = await buildConversationContext(
      db,
      answerWith({ ...classIntent(undefined), regions: ['GM0363'] }),
    );
    expect(context).not.toBeNull();
    expect('regionScope' in context!).toBe(false);
  });

  it('a forged class/regions combination drops the whole context (fail closed)', async () => {
    const base = { version: 1, topicKey: POPULATION, period: { kind: 'year', year: 2024 }, derivation: 'none' };
    const forged = [
      { ...base, regionScope: 'all_provincies', regions: [{ name: 'Amsterdam', kind: 'gemeente' }] },
      { ...base, regionScope: 'gemeenten_in_provincie', regions: null },
      { ...base, regionScope: 'gemeenten_in_provincie', regions: [{ name: 'Amsterdam', kind: 'gemeente' }] },
      {
        ...base,
        regionScope: 'gemeenten_in_provincie',
        regions: [
          { name: 'Utrecht', kind: 'provincie' },
          { name: 'Gelderland', kind: 'provincie' },
        ],
      },
      { ...base, regionScope: 'alle_wijken', regions: null },
    ];
    for (const context of forged) {
      expect(await validateConversationContext(db, context)).toBeNull();
    }
  });
});

describe('policy: a class is part of the region axis', () => {
  it('two readings that differ only in class differ on the REGION axis, never merge as agreement', () => {
    const ranked = (intent: StructuredIntent) => ({ intent, confidence: 0.8, reading: 'r', impliedRecency: false });
    const national = { ...classIntent(undefined), regions: ['NL01'] };
    const perProvince = classIntent({ kind: 'all_provincies' });
    expect(differingAxes(ranked(national), ranked(perProvince))).toEqual(['region']);
    expect(differingAxes(ranked(classIntent({ kind: 'all_provincies' })), ranked(classIntent({ kind: 'all_gemeenten' })))).toEqual(['region']);
  });
});
