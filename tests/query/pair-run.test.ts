// Two-measure scatter (spec 2026-09-27), Task 1: runPairQuery against the real
// hermetic ingest (ADR 009). Both fixtures carry 2024JJ00 for all 12 provinces
// and for the gemeenten of PV26, and the two tables disagree on which gemeenten
// exist (region-set.ts header: PV26 has 54 in 03759ned, 42 in 83625NED).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runPairQuery, runQuery, SCATTER_MIN_PAIRS } from '../../src/query/index.ts';
import type { RegionScope, StructuredIntent } from '../../src/query/index.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';

let db: Db;
let close: () => Promise<void>;

function pair(regionSet: RegionScope, period = '2024JJ00'): StructuredIntent {
  return {
    schemaVersion: 1,
    target: { kind: 'canonical', key: 'average_home_sale_price_by_gemeente' },
    regionSet,
    period: { kind: 'codes', codes: [period] },
    derivation: 'none',
    pairWith: { kind: 'canonical', key: 'population_on_1_january' },
  };
}

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

describe('runPairQuery', () => {
  it('pairs all 12 provinces: y = home price (83625NED), x = population (03759ned)', async () => {
    const outcome = await runPairQuery(db, pair({ kind: 'all_provincies' }));
    if (!outcome.ok) throw new Error(`${outcome.refusal.kind}: ${outcome.refusal.message}`);
    expect(outcome.result.attribution.tableId).toBe('83625NED');
    expect(outcome.pairedResult.attribution.tableId).toBe('03759ned');
    expect(outcome.pairing.pairs).toHaveLength(12);
    expect(outcome.pairing.complete).toBe(true);
    // A later audit writer must record the FULL two-measure question, not the
    // y leg's own one-measure intent (legIntents strips pairWith off before
    // either leg runs) — so outcome.intent keeps pairWith, outcome.result.intent
    // (the y leg's own echoed intent, ValidatedResult.intent) does not.
    expect(outcome.intent.pairWith).toEqual({ kind: 'canonical', key: 'population_on_1_january' });
    expect('pairWith' in outcome.result.intent).toBe(false);
    for (const p of outcome.pairing.pairs) {
      expect(p.y.regionCode).toBe(p.regionCode);
      expect(p.x.regionCode).toBe(p.regionCode);
      expect(p.y.value).not.toBeNull();
      expect(p.x.value).not.toBeNull();
    }
  });

  it('gemeenten in PV26: every member of either roster is accounted for exactly once', async () => {
    const outcome = await runPairQuery(db, pair({ kind: 'gemeenten_in_provincie', parent: 'PV26' }));
    if (!outcome.ok) throw new Error(`${outcome.refusal.kind}: ${outcome.refusal.message}`);
    const { pairs, leftOut, notApplicable } = outcome.pairing;
    expect(pairs.length).toBeGreaterThanOrEqual(SCATTER_MIN_PAIRS);
    const accounted = [...pairs.map((p) => p.regionCode), ...leftOut.map((r) => r.regionCode), ...notApplicable];
    expect(new Set(accounted).size).toBe(accounted.length);
    const rosterCodes = new Set<string>();
    for (const leg of [outcome.result, outcome.pairedResult]) {
      for (const c of leg.cells) rosterCodes.add(c.regionCode!);
      for (const code of [...leg.regionSet!.notApplicable, ...leg.regionSet!.withheld, ...leg.regionSet!.missing]) rosterCodes.add(code);
    }
    expect(new Set(accounted)).toEqual(rosterCodes);
    for (const r of leftOut) expect(r.y.state === 'value' && r.x.state === 'value').toBe(false);

    // Label-gate (spec D7): PV26's two tables disagree on roster (54 vs 42
    // gemeenten, per this file's header comment), so this pairing is the real
    // fixture case that pins the gate against genuine roster incompleteness —
    // not the synthetic all-complete provinces case above. Single conditional
    // expectation keyed on the MEASURED pairing.complete value, since which
    // branch the real fixture takes is itself the thing being pinned.
    const { buildScatterSpec } = await import('../../src/chart/index.ts');
    const spec = buildScatterSpec(outcome.result, outcome.pairedResult);
    if (outcome.pairing.complete) {
      expect(spec.labelled.length).toBeGreaterThan(0);
    } else {
      expect(spec.labelled).toEqual([]);
    }
  });

  it('refuses when a leg refuses — a period only one table has', async () => {
    // 03759ned carries 2026JJ00, 83625NED stops at 2025JJ00.
    const outcome = await runPairQuery(db, pair({ kind: 'all_provincies' }, '2026JJ00'));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.intent.pairWith).toEqual({ kind: 'canonical', key: 'population_on_1_january' });
  });

  it('refuses a structurally invalid pair intent without querying', async () => {
    const outcome = await runPairQuery(db, { ...pair({ kind: 'all_provincies' }), derivation: 'max' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.refusal.kind).toBe('invalid_intent');
  });

  it('the provinces pair builds a valid ScatterSpec with 12 points, x on a linear scale', async () => {
    const { buildScatterSpec, scatterSpecSchema } = await import('../../src/chart/index.ts');
    const outcome = await runPairQuery(db, pair({ kind: 'all_provincies' }));
    if (!outcome.ok) throw new Error(outcome.refusal.message);
    const spec = buildScatterSpec(outcome.result, outcome.pairedResult);
    expect(scatterSpecSchema.safeParse(spec).success).toBe(true);
    expect(spec.points).toHaveLength(12);
    expect(spec.labelled.length).toBeGreaterThan(0);
    // Province populations run from ~400k (Zeeland/Flevoland) to ~3.8M (Zuid-Holland): < 100x → linear.
    expect(spec.x.defaultScale).toBe('linear');
  });
});

describe('runQuery never answers a paired intent', () => {
  it('refuses invalid_intent instead of silently answering one measure', async () => {
    const outcome = await runQuery(db, pair({ kind: 'all_provincies' }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.refusal.kind).toBe('invalid_intent');
  });
});
