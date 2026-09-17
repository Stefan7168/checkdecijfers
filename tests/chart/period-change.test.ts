// ADR 052 (DRAFT — not owner-approved): buildPeriodChangeReading /
// isPeriodChangeEligible. Mirrors tests/chart/alternate-reading.test.ts's
// structure (a real ingested fixture DB for the happy-path/shape cases, hand-
// built ResultCell fixtures for the arithmetic-safety refusals already
// covered independently in tests/query/query.test.ts's
// derivePeriodChangeSeries block — this file's job is proving the CHART-SPEC
// wiring around that already-tested derivation, not re-proving its math).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { buildPeriodChangeReading, isPeriodChangeEligible } from '../../src/chart/period-change.ts';
import { runQuery } from '../../src/query/index.ts';
import type { ResultCell, StructuredIntent, ValidatedResult } from '../../src/query/index.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';

describe('isPeriodChangeEligible (ADR 052 D3 — a hand-curated allowlist, not a heuristic)', () => {
  it('is true for the curated level measures', () => {
    expect(isPeriodChangeEligible('population_on_1_january')).toBe(true);
    expect(isPeriodChangeEligible('average_existing_home_sale_price')).toBe(true);
    expect(isPeriodChangeEligible('bankruptcies_businesses')).toBe(true);
    expect(isPeriodChangeEligible('housing_stock_start_of_year')).toBe(true);
    expect(isPeriodChangeEligible('solar_electricity_production')).toBe(true);
    expect(isPeriodChangeEligible('average_disposable_household_income')).toBe(true);
    expect(isPeriodChangeEligible('average_home_sale_price_by_gemeente')).toBe(true);
  });

  it('is false for measures already expressed as a %-change/mutation, a rate, or a zero-crossing index', () => {
    expect(isPeriodChangeEligible('cpi_yearly_inflation')).toBe(false);
    expect(isPeriodChangeEligible('gdp_growth_yoy_volume')).toBe(false);
    expect(isPeriodChangeEligible('unemployment_rate_seasonally_adjusted')).toBe(false);
    expect(isPeriodChangeEligible('consumer_confidence_seasonally_adjusted')).toBe(false);
  });

  it('is false for an unknown key — never a guessed default', () => {
    expect(isPeriodChangeEligible('does_not_exist')).toBe(false);
  });
});

describe('buildPeriodChangeReading', () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => ({ db, close } = await createIngestedDb()));
  afterAll(async () => close());

  it('builds a real, complete chart spec over a genuine multi-year home-price series', async () => {
    const intent: StructuredIntent = {
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'average_existing_home_sale_price' },
      period: { kind: 'range', from: '2019JJ00', to: '2024JJ00' },
      derivation: 'series',
    };
    const outcome = await runQuery(db, intent);
    if (!outcome.ok) throw new Error(`fixture setup refused: ${outcome.refusal.kind}`);
    const primary: ValidatedResult = outcome;
    expect(primary.shape).toBe('series');

    const result = buildPeriodChangeReading(primary);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.result.label).toBe('Procentuele verandering t.o.v. vorige periode');
    const spec = result.result.spec;
    expect(spec.unit).toBe('%');
    expect(spec.series).toHaveLength(1);
    // One fewer point than the primary — the first period has no "previous".
    expect(spec.series[0]!.points).toHaveLength(primary.cells.length - 1);
    // Every point traces to a real, non-null formatted percentage.
    for (const point of spec.series[0]!.points) {
      expect(point.value).not.toBeNull();
      expect(point.formattedValue).not.toBeNull();
    }
    // Attribution carries the same source table, extended definition label.
    expect(spec.attribution.tableId).toBe(primary.attribution.tableId);
    expect(spec.definitionLine).toContain('procentuele verandering t.o.v. vorige periode');
    // The synthetic cells never leak a real CBS measure code as their own.
    expect(spec.series[0]!.points[0]!.resultId).toContain('#period_change');
  });

  it('refuses a "single" shape (one period, no series to compute a trend over)', async () => {
    const intent: StructuredIntent = {
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'average_existing_home_sale_price' },
      period: { kind: 'codes', codes: ['2024JJ00'] },
      derivation: 'none',
    };
    const outcome = await runQuery(db, intent);
    if (!outcome.ok) throw new Error(`fixture setup refused: ${outcome.refusal.kind}`);
    expect(outcome.shape).toBe('single');

    const result = buildPeriodChangeReading(outcome);
    expect(result.ok).toBe(false);
  });

  it('refuses a "derived" shape (an explicit max ranking — no time axis at all)', async () => {
    const intent: StructuredIntent = {
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'population_on_1_january' },
      regions: ['GM0363', 'GM0599', 'GM0518', 'GM0344'],
      period: { kind: 'codes', codes: ['2025JJ00'] },
      derivation: 'max',
    };
    const outcome = await runQuery(db, intent);
    if (!outcome.ok) throw new Error(`fixture setup refused: ${outcome.refusal.kind}`);
    expect(outcome.shape).toBe('derived');

    const result = buildPeriodChangeReading(outcome);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toContain('shape');
  });

  it('refuses a "comparison" shape (several regions, one period, no derivation — a bar chart, no time axis)', async () => {
    const intent: StructuredIntent = {
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'population_on_1_january' },
      regions: ['GM0363', 'GM0599'],
      period: { kind: 'codes', codes: ['2024JJ00'] },
      derivation: 'none',
    };
    const outcome = await runQuery(db, intent);
    if (!outcome.ok) throw new Error(`fixture setup refused: ${outcome.refusal.kind}`);
    expect(outcome.shape).toBe('comparison');

    const result = buildPeriodChangeReading(outcome);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toContain('shape');
  });

  it('degrades to { ok: false }, never throws, when the underlying derivation refuses (e.g. a null-valued source cell)', () => {
    // A hand-built synthetic primary — proves the wiring around
    // derivePeriodChangeSeries degrades cleanly, independent of any real
    // fixture happening to contain a gap.
    function cellAt(periodCode: string, value: number | null): ResultCell {
      return {
        resultId: `t:m:-:${periodCode}:-`,
        tableId: 't', measure: 'm', measureTitle: 'm', regionCode: null,
        regionLabel: null, periodCode, periodLabel: periodCode, grain: 'JJ',
        dims: {}, dimLabels: {}, value, unit: 'aantal', decimals: 0,
        status: 'Definitief', provisional: false, valueAttribute: value === null ? 'Impossible' : 'None',
        batchId: 1,
      };
    }
    const primary: ValidatedResult = {
      ok: true,
      schemaVersion: 1,
      shape: 'series',
      cells: [cellAt('2019JJ00', 100), cellAt('2020JJ00', null), cellAt('2021JJ00', 120)],
      derivations: [],
      attribution: {
        tableId: 't', tableTitle: 'test', tableVersion: 1, syncedAt: '2024-01-01T00:00:00.000Z',
        coveredPeriods: { from: '2019JJ00', to: '2021JJ00' }, license: 'CC BY 4.0',
        definitionLabel: null, definitionText: null, periodSemantics: null,
      },
      intent: { schemaVersion: 1, target: { kind: 'explicit', tableId: 't', measure: 'm' }, period: { kind: 'range', from: '2019JJ00', to: '2021JJ00' }, derivation: 'series' },
    };

    const result = buildPeriodChangeReading(primary);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toContain('refused');
  });
});
