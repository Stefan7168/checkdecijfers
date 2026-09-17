// #253 Task 2 — the resolver branch for StructuredIntent.regionSet: a region
// CLASS resolves to the table's real roster, or refuses with the same typed
// taxonomy every other axis uses (docs/05's failure table).
//
// What this file deliberately PINS as unchanged: ADR 011's one-varying-axis
// rule. A region set is "several regions", so several regions AND several
// periods still refuses — this feature does not relax that.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveIntent } from '../../src/query/index.ts';
import type { StructuredIntent } from '../../src/query/index.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

function population(extra: Partial<StructuredIntent>): StructuredIntent {
  return {
    schemaVersion: 1,
    target: { kind: 'canonical', key: 'population_on_1_january' },
    period: { kind: 'codes', codes: ['2025JJ00'] },
    derivation: 'none',
    ...extra,
  };
}

describe('resolveIntent — regionSet (the region-class axis)', () => {
  it('regions and regionSet are mutually exclusive', async () => {
    const outcome = await resolveIntent(
      db,
      population({ regions: ['GM0363'], regionSet: { kind: 'all_provincies' } }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.refusal.kind).toBe('invalid_intent');
    expect(outcome.refusal.axis).toBe('region');
  });

  it('a region class on a table with no geo dimension refuses on the region axis', async () => {
    const outcome = await resolveIntent(db, {
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'unemployment_rate_seasonally_adjusted' },
      period: { kind: 'codes', codes: ['2024KW04'] },
      derivation: 'none',
      regionSet: { kind: 'all_provincies' },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.refusal.kind).toBe('invalid_intent');
    expect(outcome.refusal.axis).toBe('region');
    expect(outcome.refusal.message).toContain('no regional dimension');
  });

  it('a region class plus several periods still hits the one-varying-axis rule (ADR 011, unchanged)', async () => {
    const outcome = await resolveIntent(
      db,
      population({
        regionSet: { kind: 'all_provincies' },
        period: { kind: 'range', from: '2023JJ00', to: '2025JJ00' },
      }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.refusal.kind).toBe('invalid_intent');
    expect(outcome.refusal.message).toContain('one varying axis per question');
    // Row 13 (session 110, ADR 054 addendum): a region CLASS counts as
    // "several regions" for this rule too, so it gets the same honest
    // sub-reason as an explicit multi-region ask — not the generic internal
    // wording that pages the owner.
    expect(outcome.refusal.subReason).toBe('multi_region_multi_period');
  });

  it('"alle landsdelen" refuses as outside the loaded slice — not as "CBS does not publish it"', async () => {
    const outcome = await resolveIntent(db, population({ regionSet: { kind: 'all_landsdelen' } }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.refusal.kind).toBe('outside_loaded_slice');
    expect(outcome.refusal.axis).toBe('region');
  });

  it('"alle provincies" resolves to the 12 real codes with their labels', async () => {
    const outcome = await resolveIntent(db, population({ regionSet: { kind: 'all_provincies' } }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    const { resolved } = outcome;
    expect(resolved.regionCodes).toHaveLength(12);
    expect(resolved.regionCodes.every((c) => c.startsWith('PV'))).toBe(true);
    for (const code of resolved.regionCodes) {
      expect(resolved.regionLabels[code]).toBeTruthy();
    }
    expect(resolved.regionLabels['PV26']).toBe('Utrecht (PV)');
    expect(resolved.regionSet).not.toBeNull();
    expect(resolved.regionSet!.scope).toEqual({ kind: 'all_provincies' });
    expect(resolved.regionSet!.excludedBySlice).toEqual([]);
    // The intent is echoed unchanged: the CLASS is what we ran, and the codes
    // it stands for are re-derivable from the registry at audit time (R8).
    expect(resolved.intent.regionSet).toEqual({ kind: 'all_provincies' });
    expect(resolved.intent.regions).toBeUndefined();
  });

  it('"gemeenten in Utrecht" resolves to that province\'s 54 gemeenten on the population table', async () => {
    const outcome = await resolveIntent(
      db,
      population({ regionSet: { kind: 'gemeenten_in_provincie', parent: 'PV26' } }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.resolved.regionCodes).toHaveLength(54);
  });

  it('an unverifiable roster (unknown parent province) refuses as a data gap, never as a guess', async () => {
    const outcome = await resolveIntent(
      db,
      population({ regionSet: { kind: 'gemeenten_in_provincie', parent: 'PV99' } }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.refusal.kind).toBe('no_data');
    expect(outcome.refusal.axis).toBe('region');
  });

  it('derivation "max" is accepted with a region class (the roster size is a data question, checked after the fetch)', async () => {
    const outcome = await resolveIntent(
      db,
      population({ regionSet: { kind: 'all_provincies' }, derivation: 'max' }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.resolved.derivation).toBe('max');
  });

  it('derivation "max" without any region set or region list still refuses (unchanged arity rule)', async () => {
    const outcome = await resolveIntent(db, population({ derivation: 'max', regions: ['GM0363'] }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.refusal.kind).toBe('invalid_intent');
    expect(outcome.refusal.axis).toBe('derivation');
  });
});
