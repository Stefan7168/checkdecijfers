// #253 Task 1 — region-class ROSTER resolution, hermetic against the
// fixture-ingested database (ADR 009).
//
// The roster is CBS's own `DimensionGroupId` (dimension_labels.dimension_group,
// parsed by src/cbs-adapter/parse-v4.ts and written by src/ingestion/pipeline.ts
// since migration 001) — never a hardcoded list, never a code-prefix scan.
// Principle (c): a group that comes back empty REFUSES; it never falls back to
// a guess. R5: class membership is a CBS fact this layer reads, not a
// computation it invents.
//
// Every count below was verified against the committed fixtures
// (tests/fixtures/cbs/{03759ned,83625NED}/codes-RegioS.json) before being
// written here — the per-table difference (PV26 has 54 gemeenten in 03759ned
// and 42 in 83625NED) is exactly why the roster must be per table.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveRegionSet } from '../../src/query/region-set.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';

let db: Db;
let close: () => Promise<void>;

/** 03759ned's registered geo slice (src/ingestion/registry-seed.ts): NL, PV and
 * GM prefixes only — landsdelen (LD…) are deliberately NOT ingested. */
const POPULATION_PREFIXES = ['NL', 'PV', 'GM'];

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

describe('resolveRegionSet — the roster comes from CBS dimension groups', () => {
  it('all_provincies on 03759ned is exactly the 12 PV codes', async () => {
    const outcome = await resolveRegionSet(db, '03759ned', 'RegioS', { kind: 'all_provincies' }, POPULATION_PREFIXES);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.codes).toHaveLength(12);
    expect([...outcome.codes].sort()).toEqual([
      'PV20', 'PV21', 'PV22', 'PV23', 'PV24', 'PV25',
      'PV26', 'PV27', 'PV28', 'PV29', 'PV30', 'PV31',
    ]);
    expect(outcome.excludedBySlice).toEqual([]);
  });

  it('all_landsdelen finds the 4 LD codes in the label table but refuses: they are outside the loaded slice', async () => {
    // The labels exist (ingestion writes every CBS code, sliced or not) — so
    // this must refuse as "outside the slice we loaded", never as "CBS has no
    // landsdelen" (docs/05: the two are different refusals).
    const labels = await db.query(
      `select code from dimension_labels
        where table_id = '03759ned' and dimension = 'RegioS' and dimension_group = 'LD'`,
    );
    expect(labels.rows).toHaveLength(4);

    const outcome = await resolveRegionSet(db, '03759ned', 'RegioS', { kind: 'all_landsdelen' }, POPULATION_PREFIXES);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.reason).toBe('outside_slice');
    expect(outcome.detail).toContain('LD');
  });

  it('gemeenten_in_provincie is per TABLE, not a global list: PV26 has 54 gemeenten in 03759ned and 42 in 83625NED', async () => {
    const population = await resolveRegionSet(
      db, '03759ned', 'RegioS', { kind: 'gemeenten_in_provincie', parent: 'PV26' }, POPULATION_PREFIXES,
    );
    expect(population.ok).toBe(true);
    if (!population.ok) throw new Error('unreachable');
    expect(population.codes).toHaveLength(54);
    expect(population.codes.every((c) => c.startsWith('GM'))).toBe(true);

    // 83625NED is registered without a slice — no prefixes to filter on.
    const homePrices = await resolveRegionSet(
      db, '83625NED', 'RegioS', { kind: 'gemeenten_in_provincie', parent: 'PV26' }, null,
    );
    expect(homePrices.ok).toBe(true);
    if (!homePrices.ok) throw new Error('unreachable');
    expect(homePrices.codes).toHaveLength(42);
  });

  it('all_gemeenten unions the GM<pv> groups — GM0997 ("Centraal persoonsregister", group OVERIG) is NOT a gemeente', async () => {
    const outcome = await resolveRegionSet(db, '03759ned', 'RegioS', { kind: 'all_gemeenten' }, POPULATION_PREFIXES);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    // 834 = the sum of the twelve GMPV<nn> groups in the fixture. GM0997 is
    // the 835th GM-prefixed code and is deliberately absent: it sits in group
    // OVERIG, which is precisely why the roster selects on the GROUP and not
    // on the 'GM' code prefix.
    expect(outcome.codes).toHaveLength(834);
    expect(outcome.codes).not.toContain('GM0997');
    const present = await db.query(
      `select dimension_group from dimension_labels
        where table_id = '03759ned' and dimension = 'RegioS' and code = 'GM0997'`,
    );
    expect(present.rows[0]?.dimension_group).toBe('OVERIG');
  });

  it('an unknown parent province refuses — it never falls back to a GM-prefix scan', async () => {
    const outcome = await resolveRegionSet(
      db, '03759ned', 'RegioS', { kind: 'gemeenten_in_provincie', parent: 'PV99' }, POPULATION_PREFIXES,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.reason).toBe('empty_roster');
    expect(outcome.detail).toContain('PV99');
  });

  // LAST in this file, deliberately: it mutates this suite's private database
  // (every createIngestedDb caller gets its own PGlite — tests/helpers/
  // fixture-snapshot.ts) to prove the "verified, never assumed" guard on the
  // composed 'GM' + <pv code> group name.
  it('a GM<pv> group that comes back empty refuses — for the province itself AND for all_gemeenten', async () => {
    await db.query(
      `update dimension_labels set dimension_group = 'MOVED'
        where table_id = '03759ned' and dimension = 'RegioS' and dimension_group = 'GMPV24'`,
    );

    const province = await resolveRegionSet(
      db, '03759ned', 'RegioS', { kind: 'gemeenten_in_provincie', parent: 'PV24' }, POPULATION_PREFIXES,
    );
    expect(province.ok).toBe(false);
    if (province.ok) throw new Error('unreachable');
    expect(province.reason).toBe('empty_roster');
    expect(province.detail).toContain('GMPV24');

    // "Alle gemeenten" is the union over every province, so one unverifiable
    // province makes the WHOLE roster unverifiable — it must not quietly
    // answer for eleven provinces and call that "alle gemeenten".
    const all = await resolveRegionSet(db, '03759ned', 'RegioS', { kind: 'all_gemeenten' }, POPULATION_PREFIXES);
    expect(all.ok).toBe(false);
    if (all.ok) throw new Error('unreachable');
    expect(all.reason).toBe('empty_roster');
  });
});
