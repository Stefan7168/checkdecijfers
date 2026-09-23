// E2a final-review fix wave (I2/I3 → ruling R8): a Eurostat break-in-series
// flag ANYWHERE inside the compared window refuses every cross-period
// comparison — not only a break on a cell that happens to be in the result.
// A non-contiguous selection (an explicit year list; now_vs_ago) leaves the
// years in between out of `cells`, so run.ts reads the window from
// `observations` itself. Flags are parsed as COMBINED letters ('bp' is a
// break too; 'Published' — which contains a 'b' — is not).
//
// Hermetic (PGlite), no LLM: runQuery only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import { EUROSTAT_TEST_CANONICAL_KEY, insertEurostatTestTable } from '../helpers/eurostat-test-table.ts';
import { INTENT_SCHEMA_VERSION, runQuery } from '../../src/query/index.ts';
import type { QueryOutcome, StructuredIntent } from '../../src/query/index.ts';

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  // 2019–2022. 2021 is the flagged year for three regions; NL is the control.
  //   DE 2021 'b'  — a plain break
  //   BE 2021 'bp' — break + provisional, one combined flag string
  //   NL 2021 'p'  — provisional only: never a break
  //   EU27_2020    — every year 'Published' (contains a 'b'): never a break
  await insertEurostatTestTable(db, {
    years: [2019, 2020, 2021, 2022],
    statusOverrides: { 'DE|2021': 'b', 'BE|2021': 'bp', 'NL|2021': 'p' },
  });
});

afterAll(async () => {
  await close();
});

function intent(region: string, codes: string[], derivation: StructuredIntent['derivation']): StructuredIntent {
  return {
    schemaVersion: INTENT_SCHEMA_VERSION,
    target: { kind: 'canonical', key: EUROSTAT_TEST_CANONICAL_KEY },
    regions: [region],
    period: { kind: 'codes', codes },
    derivation,
  };
}

/** 2020 and 2022 only — 2021 (the flagged year) is NOT in the result. */
const GAP = ['2020JJ00', '2022JJ00'];

function derivationKinds(outcome: QueryOutcome): string[] {
  if (!outcome.ok) throw new Error(`expected a result, got a refusal: ${outcome.refusal.message}`);
  return outcome.derivations.map((d) => d.kind);
}

describe('Eurostat break-in-series across the whole compared window (ruling R8)', () => {
  it("a 'b' on a gap year NOT in the result: no direction / first_last is registered for the 2020–2022 comparison", async () => {
    const outcome = await runQuery(db, intent('DE', GAP, 'none'));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // The flagged year really is absent from the result — the cell-level
    // check alone could not have seen it.
    expect(outcome.cells.map((c) => c.periodCode)).toEqual(GAP);
    expect(outcome.cells.every((c) => c.status === 'Published')).toBe(true);
    expect(derivationKinds(outcome)).not.toContain('first_last');
    expect(derivationKinds(outcome)).not.toContain('direction');
  });

  it("a 'b' on a gap year NOT in the result refuses an explicit difference", async () => {
    const outcome = await runQuery(db, intent('DE', GAP, 'difference'));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusal.kind).toBe('derivation_failed');
    expect(outcome.refusal.message).toContain('break in series');
    expect(outcome.refusal.message).toContain('2021JJ00');
  });

  it("a combined 'bp' flag is a break: difference refuses, first_last is not registered", async () => {
    const difference = await runQuery(db, intent('BE', GAP, 'difference'));
    expect(difference.ok).toBe(false);
    if (!difference.ok) expect(difference.refusal.message).toContain('break in series');
    expect(derivationKinds(await runQuery(db, intent('BE', GAP, 'none')))).not.toContain('first_last');
  });

  it("'Published' (which contains a 'b') and a plain 'p' flag are not breaks: first_last, direction and difference all stand", async () => {
    for (const region of ['EU27_2020', 'NL']) {
      const kinds = derivationKinds(await runQuery(db, intent(region, GAP, 'none')));
      expect(kinds).toContain('first_last');
      expect(kinds).toContain('direction');
      expect(derivationKinds(await runQuery(db, intent(region, GAP, 'difference')))).toContain('difference');
    }
  });

  it('a break flagged ON the first compared period marks the boundary before the window: not a break inside it', async () => {
    const kinds = derivationKinds(await runQuery(db, intent('DE', ['2021JJ00', '2022JJ00'], 'none')));
    expect(kinds).toContain('first_last');
    expect(kinds).toContain('direction');
  });

  it('a window that ends before the break is unaffected', async () => {
    const kinds = derivationKinds(await runQuery(db, intent('DE', ['2019JJ00', '2020JJ00'], 'none')));
    expect(kinds).toContain('first_last');
  });

  it('a contiguous series across the break still refuses at the cell level too (the break cell is in the result)', async () => {
    const outcome = await runQuery(db, intent('DE', ['2020JJ00', '2021JJ00', '2022JJ00'], 'none'));
    expect(derivationKinds(outcome)).not.toContain('first_last');
    expect(derivationKinds(outcome)).not.toContain('direction');
  });
});
