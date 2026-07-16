// #125a (ADR 031): the unit-expansion derivation — eligibility (D1),
// exact integer-scaled arithmetic (the IEEE-754 trap), the refusal paths,
// and runQuery's pre-registration (D2). Pure tests plus the hermetic
// fixture-ingested db (ADR 009).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runQuery } from '../../src/query/index.ts';
import type { StructuredIntent } from '../../src/query/index.ts';
import { deriveUnitExpansion, parseFactorUnit } from '../../src/query/derivations.ts';
import { makeCell } from '../helpers/synthetic-results.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';

describe('parseFactorUnit — pure numeric factor units only (D1)', () => {
  it('accepts the CBS factor spellings', () => {
    expect(parseFactorUnit('x 1000')).toBe(1000); // 37789ksz (the live #111 answer)
    expect(parseFactorUnit('x 1 000')).toBe(1000); // 82235NED (B6)
    expect(parseFactorUnit('× 1.000')).toBe(1000);
    expect(parseFactorUnit('x 10 000')).toBe(10000);
    expect(parseFactorUnit('x 1 000 000')).toBe(1000000);
    expect(parseFactorUnit(' x 1000 ')).toBe(1000); // tolerates padding
    expect(parseFactorUnit('1 000')).toBe(1000); // the x-prefix is optional
  });

  it('rejects any unit that is not a pure factor', () => {
    expect(parseFactorUnit('1 000 euro')).toBeNull(); // B12 — out of v1 scope
    expect(parseFactorUnit('aantal per 1 000 inwoners')).toBeNull(); // a RATE
    expect(parseFactorUnit('2015=100')).toBeNull(); // index BASE, not a factor (#143 pin)
    expect(parseFactorUnit('2021 = 100')).toBeNull(); // spaced base variant (#143 pin)
    expect(parseFactorUnit('%')).toBeNull();
    expect(parseFactorUnit('aantal')).toBeNull();
    expect(parseFactorUnit('euro')).toBeNull();
    expect(parseFactorUnit('mln kWh')).toBeNull();
    expect(parseFactorUnit('x mln')).toBeNull();
    expect(parseFactorUnit('')).toBeNull();
  });

  it('rejects factors below 10 and malformed digit grouping', () => {
    expect(parseFactorUnit('x 5')).toBeNull(); // factor < 10
    expect(parseFactorUnit('x 1,5')).toBeNull(); // decimal comma — not a factor
    expect(parseFactorUnit('x 1.0000')).toBeNull(); // groups must be exactly 3 digits
    expect(parseFactorUnit('x 10.00')).toBeNull();
  });
});

describe('deriveUnitExpansion — exact arithmetic (D1), refusals fail open', () => {
  const factorCell = (value: number | null, unit: string, decimals = 0) =>
    makeCell({ periodCode: '2023JJ00', periodLabel: '2023', value, unit, decimals });

  it('registers the EXACT expansion where float multiplication is inexact', () => {
    // The trap the ADR names: IEEE-754 multiplication is not always exact
    // (measured: 96 of the 9,999 one-decimal values below 1000 miss by ×1000).
    expect(16.1 * 1000).not.toBe(16100);
    const inexact = deriveUnitExpansion(factorCell(16.1, 'x 1000', 1));
    expect(inexact.ok && inexact.record.kind === 'unit_expansion' && inexact.record.value === 16100).toBe(true);
    // The live #111 answer's pair, exact end to end.
    const derived = deriveUnitExpansion(factorCell(390.2, 'x 1000', 1));
    expect(derived.ok).toBe(true);
    if (!derived.ok) throw new Error('unreachable');
    expect(derived.record.kind).toBe('unit_expansion');
    if (derived.record.kind !== 'unit_expansion') throw new Error('unreachable');
    expect(derived.record.value).toBe(390200); // exact, integer
    expect(derived.record.factor).toBe(1000);
    expect(derived.record.unit).toBe('aantal');
    expect(derived.record.explicit).toBe(false);
    expect(derived.record.sourceResultIds).toEqual([factorCell(390.2, 'x 1000', 1).resultId]);
  });

  it('expands the B6 shape (8204 × 1 000 = 8204000) and negative values exactly', () => {
    const b6 = deriveUnitExpansion(factorCell(8204, 'x 1 000'));
    expect(b6.ok && b6.record.kind === 'unit_expansion' && b6.record.value === 8204000).toBe(true);
    const negative = deriveUnitExpansion(factorCell(-24.5, 'x 1000', 1));
    expect(negative.ok && negative.record.kind === 'unit_expansion' && negative.record.value === -24500).toBe(true);
  });

  it('refuses every ineligible or inexact input', () => {
    // Not a pure factor unit.
    expect(deriveUnitExpansion(factorCell(57.6, '1 000 euro', 1)).ok).toBe(false);
    expect(deriveUnitExpansion(factorCell(12, 'aantal per 1 000 inwoners')).ok).toBe(false);
    // Null cell — nothing to expand.
    expect(deriveUnitExpansion(factorCell(null, 'x 1 000')).ok).toBe(false);
    // Value carries more precision than its declared decimals.
    expect(deriveUnitExpansion(factorCell(390.25, 'x 1000', 1)).ok).toBe(false);
    // Decimals outside the exact range.
    expect(deriveUnitExpansion(factorCell(1.2345678, 'x 1000', 7)).ok).toBe(false);
    // Expansion exceeds the safe-integer range.
    expect(deriveUnitExpansion(factorCell(9_007_199_254_740, 'x 1 000 000')).ok).toBe(false);
  });

  it('v1 registers integer expansions only', () => {
    // 0.05 × 10 = 0.5 — exact but not an integer; the guard refuses it.
    const fractional = deriveUnitExpansion(factorCell(0.05, 'x 10', 2));
    expect(fractional.ok).toBe(false);
    // Every CBS thousands-factor with <=3 decimals IS integer-valued: 0.123 × 1000 = 123.
    const thousandths = deriveUnitExpansion(factorCell(0.123, 'x 1000', 3));
    expect(thousandths.ok && thousandths.record.kind === 'unit_expansion' && thousandths.record.value === 123).toBe(true);
  });
});

describe('runQuery pre-registration (D2) — hermetic fixture db', () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createIngestedDb());
  }, 300_000);

  afterAll(async () => {
    await close();
  });

  function intent(partial: Partial<StructuredIntent> & Pick<StructuredIntent, 'target' | 'period'>): StructuredIntent {
    return { schemaVersion: 1, derivation: 'none', ...partial };
  }

  it('a factor-unit cell (B6, x 1 000) carries exactly one unit_expansion record', async () => {
    const outcome = await runQuery(
      db,
      intent({
        target: { kind: 'canonical', key: 'housing_stock_start_of_year' },
        period: { kind: 'codes', codes: ['2024JJ00'] },
      }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    const expansions = outcome.derivations.filter((d) => d.kind === 'unit_expansion');
    expect(expansions).toHaveLength(1);
    const record = expansions[0]!;
    if (record.kind !== 'unit_expansion') throw new Error('unreachable');
    expect(record.factor).toBe(1000);
    expect(record.value).toBe(8204000);
    expect(record.sourceResultIds).toEqual([outcome.cells[0]!.resultId]);
  });

  it('non-factor units (aantal, 1 000 euro) register no expansion', async () => {
    const cases: StructuredIntent[] = [
      intent({
        target: { kind: 'canonical', key: 'population_on_1_january' }, // aantal
        regions: ['NL01'],
        period: { kind: 'codes', codes: ['2024JJ00'] },
      }),
      intent({
        target: { kind: 'canonical', key: 'average_disposable_household_income' }, // 1 000 euro (B12)
        period: { kind: 'codes', codes: ['2023JJ00'] },
      }),
    ];
    for (const q of cases) {
      const outcome = await runQuery(db, q);
      if (!outcome.ok) throw new Error(`${JSON.stringify(q.target)}: query refused`);
      expect(outcome.derivations.filter((d) => d.kind === 'unit_expansion')).toHaveLength(0);
    }
  });

  it('a multi-period factor-unit series gets one record per cell', async () => {
    const outcome = await runQuery(
      db,
      intent({
        target: { kind: 'canonical', key: 'housing_stock_start_of_year' },
        period: { kind: 'codes', codes: ['2023JJ00', '2024JJ00'] },
      }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    const expansions = outcome.derivations.filter((d) => d.kind === 'unit_expansion');
    expect(expansions).toHaveLength(2);
    expect(new Set(expansions.flatMap((d) => d.sourceResultIds))).toEqual(new Set(outcome.cells.map((c) => c.resultId)));
  });
});
