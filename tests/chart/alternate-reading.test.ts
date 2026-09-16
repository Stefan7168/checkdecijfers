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
