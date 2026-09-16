import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { buildAlternateReading } from '../../src/chart/alternate-reading.ts';
import { runQuery } from '../../src/query/index.ts';
import type { StructuredIntent, ValidatedResult } from '../../src/query/index.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';

describe('buildAlternateReading', () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => ({ db, close } = await createIngestedDb()));
  afterAll(async () => close());

  it('merges the alternate dims over the PRIMARY cell\'s own resolved dims, not a bare replace', async () => {
    // unemployment_rate_seasonally_adjusted's own real alternate (defaults.ts): swaps the SAME
    // dims key (SeizoenEnWerkdagcorrectie) to the raw reading — a same-key case where merge and
    // replace happen to agree, kept here because it is the ONE case curated.ts's existing test
    // already pins, so this proves the refactor in Step 3 preserves it byte-for-byte.
    const primaryIntent: StructuredIntent = {
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'unemployment_rate_seasonally_adjusted' },
      period: { kind: 'range', from: '2023KW04', to: '2025KW04' },
      derivation: 'series',
    };
    const primaryOutcome = await runQuery(db, primaryIntent);
    if (!primaryOutcome.ok) throw new Error(`fixture setup refused: ${primaryOutcome.refusal.kind}`);
    const primary: ValidatedResult = primaryOutcome;

    const outcome = await buildAlternateReading(db, primary, primaryIntent, {
      dims: { SeizoenEnWerkdagcorrectie: 'A042501' },
      label: 'oorspronkelijke, ongecorrigeerde cijfers',
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.label).toBe('oorspronkelijke, ongecorrigeerde cijfers');
      expect(outcome.result.spec.attribution.tableId).toBe(primary.attribution.tableId);
      // A real different reading, not an accidental copy of the primary's own value.
      expect(outcome.result.spec).not.toEqual(primary);
    }
  });

  it('a measure-only alternate keeps the primary\'s own dims untouched (the real bug a literal replace would hit)', async () => {
    // cpi_yearly_inflation's real alternate (defaults.ts): { measure: 'M000215', label: '...' } —
    // no `dims` key at all. Its primary's own dims is `{}` here, so this test alone would pass
    // even with the OLD literal-replace behavior; it exists to pin the merged-dims CONTRACT
    // (verified correct against the richer retail-turnover/faillissementen entries by inspection
    // during design — not re-fixtured here to keep this task's DB setup to the two canonical keys
    // already used elsewhere in this test file).
    const primaryIntent: StructuredIntent = {
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'cpi_yearly_inflation' },
      period: { kind: 'range', from: '2020JJ00', to: '2024JJ00' },
      derivation: 'series',
    };
    const primaryOutcome = await runQuery(db, primaryIntent);
    if (!primaryOutcome.ok) throw new Error(`fixture setup refused: ${primaryOutcome.refusal.kind}`);
    const primary: ValidatedResult = primaryOutcome;

    const outcome = await buildAlternateReading(db, primary, primaryIntent, {
      measure: 'M000215',
      label: 'CPI indexniveau (2025=100), geen mutatiepercentage',
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.result.spec.attribution.tableId).toBe(primary.attribution.tableId);
  });

  it('a measure-only alternate over a primary with NON-EMPTY dims keeps those dims — the case that actually distinguishes merge from replace', async () => {
    // supermarket_turnover_yoy (defaults.ts): primary dims = { BedrijfstakkenBranchesSBI2008: '371700' }.
    // Table 85828NED's OWN row-level default coordinates (src/registry/defaults.ts's TABLES entry,
    // read by src/query/resolve.ts as `table.defaultCoordinates`, merged UNDER explicitDims for an
    // `explicit` target) are `{ BedrijfstakkenBranchesSBI2008: '371600' }` — the retail_turnover_yoy
    // reading, not this one. That is exactly why retail_turnover_yoy itself (dims '371600') would be
    // a FALSE-POSITIVE fixture here: a literal `dims: alt.dims` replace on a measure-only alternate
    // sends `explicitDims = {}`, and resolve.ts's `{ ...table.defaultCoordinates, ...explicitDims }`
    // would then silently refill '371600' from the table default — coincidentally matching retail's
    // own primary dims, so a retail-based test would pass under EITHER merge or replace and prove
    // nothing (verified empirically while writing this test: a literal-replace build still resolved
    // retail's dims correctly, purely by that coincidence). supermarket_turnover_yoy's dims ('371700')
    // differ from the table default ('371600'), so it is the fixture that actually distinguishes: a
    // literal replace would silently swap the branch to '371700' -> '371600' — a genuinely DIFFERENT,
    // wrong branch, not just an empty object — while the real merge keeps '371700'.
    const primaryIntent: StructuredIntent = {
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'supermarket_turnover_yoy' },
      period: { kind: 'range', from: '2023MM01', to: '2024MM12' },
      derivation: 'series',
    };
    const primaryOutcome = await runQuery(db, primaryIntent);
    if (!primaryOutcome.ok) throw new Error(`fixture setup refused: ${primaryOutcome.refusal.kind}`);
    const primary: ValidatedResult = primaryOutcome;
    expect(primary.cells[0]!.dims).toEqual({ BedrijfstakkenBranchesSBI2008: '371700' });

    // A042501_1 (the indexNIVEAU measure) is a real measure on this same table — used elsewhere in
    // the registry as retail_turnover_yoy's own measure-only alternate — applied here with NO `dims`
    // key, exactly the shape that distinguishes merge from replace.
    const outcome = await buildAlternateReading(db, primary, primaryIntent, {
      measure: 'A042501_1',
      label: 'het indexNIVEAU (2021 = 100), geen mutatiepercentage',
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      // The primary's own dims must have survived a measure-only alternate —
      // a literal `dims: alt.dims` replace would silently swap this to the
      // table's OWN default branch ('371600') instead.
      expect(outcome.result.spec.dims).toEqual({ BedrijfstakkenBranchesSBI2008: '371700' });
    }
  });

  it('degrades to { ok: false } on a refusal, never throws, and names the refusal kind', async () => {
    const primaryIntent: StructuredIntent = {
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'unemployment_rate_seasonally_adjusted' },
      period: { kind: 'range', from: '2023KW04', to: '2025KW04' },
      derivation: 'series',
    };
    const primaryOutcome = await runQuery(db, primaryIntent);
    if (!primaryOutcome.ok) throw new Error(`fixture setup refused: ${primaryOutcome.refusal.kind}`);
    const primary: ValidatedResult = primaryOutcome;

    const outcome = await buildAlternateReading(db, primary, primaryIntent, {
      measure: 'M999999_does_not_exist',
      label: 'onbestaande maat',
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain('refused');
  });
});
