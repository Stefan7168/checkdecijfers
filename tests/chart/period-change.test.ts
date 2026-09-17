// ADR 052 (DRAFT — not owner-approved): buildPeriodChangeReading /
// isPeriodChangeEligible. Mirrors tests/chart/alternate-reading.test.ts's
// structure (a real ingested fixture DB for the happy-path/shape cases, hand-
// built ResultCell fixtures for the arithmetic-safety refusals already
// covered independently in tests/query/query.test.ts's
// derivePeriodChangeSeries block — this file's job is proving the CHART-SPEC
// wiring around that already-tested derivation, not re-proving its math).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { buildAlternateReading } from '../../src/chart/alternate-reading.ts';
import {
  buildPeriodChangeReading,
  composeAlternatePeriodChangeLabel,
  isPeriodChangeEligible,
} from '../../src/chart/period-change.ts';
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

  it('builds a real, complete chart spec over a genuine multi-year (JJ grain) home-price series', async () => {
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
    // Owner-delegated decision (ADR 052 revision): the label/definition name
    // the grain-specific previous period, not a generic "vorige periode".
    expect(result.result.label).toBe('Procentuele verandering t.o.v. vorig jaar');
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
    expect(spec.definitionLine).toContain('procentuele verandering t.o.v. vorig jaar');
    // The synthetic cells never leak a real CBS measure code as their own.
    expect(spec.series[0]!.points[0]!.resultId).toContain('#period_change');
  });

  it('labels a QUARTERLY (KW grain) series "t.o.v. vorig kwartaal"', async () => {
    const intent: StructuredIntent = {
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'average_existing_home_sale_price' },
      period: { kind: 'range', from: '2023KW01', to: '2024KW04' },
      derivation: 'series',
    };
    const outcome = await runQuery(db, intent);
    if (!outcome.ok) throw new Error(`fixture setup refused: ${outcome.refusal.kind}`);
    expect(outcome.cells[0]!.grain).toBe('KW');

    const result = buildPeriodChangeReading(outcome);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.result.label).toBe('Procentuele verandering t.o.v. vorig kwartaal');
    expect(result.result.spec.definitionLine).toContain('procentuele verandering t.o.v. vorig kwartaal');
    expect(result.result.spec.series[0]!.points).toHaveLength(outcome.cells.length - 1);
  });

  it('labels a MONTHLY (MM grain) series "t.o.v. vorige maand"', async () => {
    const intent: StructuredIntent = {
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'bankruptcies_businesses' },
      period: { kind: 'range', from: '2024MM01', to: '2024MM06' },
      derivation: 'series',
    };
    const outcome = await runQuery(db, intent);
    if (!outcome.ok) throw new Error(`fixture setup refused: ${outcome.refusal.kind}`);
    expect(outcome.cells[0]!.grain).toBe('MM');

    const result = buildPeriodChangeReading(outcome);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.result.label).toBe('Procentuele verandering t.o.v. vorige maand');
    expect(result.result.spec.definitionLine).toContain('procentuele verandering t.o.v. vorige maand');
    expect(result.result.spec.series[0]!.points).toHaveLength(outcome.cells.length - 1);
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

// #254(a), ADR 052 session 110 addendum: a registry ALTERNATE (not the
// canonical primary) can now also be marked periodChangeEligible — proven
// here at the same chart-module level tests/chart/alternate-reading.test.ts
// already uses, exercising the SAME two functions src/answer/respond/
// respond.ts composes (buildAlternateReading -> buildPeriodChangeReading on
// the alternate's own ValidatedResult), without needing a new LLM-recorded
// intent fixture (average_disposable_household_income has no committed
// multi-period benchmark question — see ADR 012's fixture-invalidation
// caveat this task was warned to respect).
describe('period-change reading for a registry ALTERNATE (#254(a), ADR 052 session 110 addendum)', () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => ({ db, close } = await createIngestedDb()));
  afterAll(async () => close());

  it("average_disposable_household_income's three registered alternates all carry periodChangeEligible through attribution, and each yields a real %-change reading of its OWN data", async () => {
    const intent: StructuredIntent = {
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'average_disposable_household_income' },
      period: { kind: 'range', from: '2019JJ00', to: '2024JJ00' },
      derivation: 'series',
    };
    const primary = await runQuery(db, intent);
    if (!primary.ok) throw new Error(`fixture setup refused: ${primary.refusal.kind}`);
    expect(primary.shape).toBe('series');

    const alternates = primary.attribution.alternates ?? [];
    expect(alternates).toHaveLength(3);
    for (const alt of alternates) expect(alt.periodChangeEligible, alt.label).toBe(true);

    // Mirrors respond.ts's own loop: re-query the alternate, then transform
    // ITS OWN result through buildPeriodChangeReading — never a third query.
    for (const alt of alternates) {
      const altOutcome = await buildAlternateReading(db, primary, intent, alt);
      expect(altOutcome.ok, alt.label).toBe(true);
      if (!altOutcome.ok) throw new Error('unreachable');
      // The alternate's own resolved data is a genuine, independent series —
      // not just a reference back to the primary's cells.
      expect(altOutcome.result.validated.shape).toBe('series');

      const pct = buildPeriodChangeReading(altOutcome.result.validated);
      expect(pct.ok, alt.label).toBe(true);
      if (!pct.ok) throw new Error('unreachable');
      expect(pct.result.spec.unit).toBe('%');
      expect(pct.result.spec.series[0]!.points).toHaveLength(altOutcome.result.validated.cells.length - 1);
      for (const point of pct.result.spec.series[0]!.points) {
        expect(point.value, alt.label).not.toBeNull();
        expect(Number.isFinite(point.value!), alt.label).toBe(true);
      }
      // The composed dropdown label reuses the SAME grain-specific phrase
      // the primary's own period-change entry gets — never a re-derived or
      // drifted wording.
      expect(composeAlternatePeriodChangeLabel(alt.label, pct.result.label)).toBe(
        `${alt.label} — procentuele verandering t.o.v. vorig jaar`,
      );
    }
  });

  it('a measure whose registry alternate lacks the marker (bankruptcies_businesses) never carries periodChangeEligible on that alternate', async () => {
    const intent: StructuredIntent = {
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'bankruptcies_businesses' },
      period: { kind: 'range', from: '2024MM01', to: '2024MM06' },
      derivation: 'series',
    };
    const primary = await runQuery(db, intent);
    if (!primary.ok) throw new Error(`fixture setup refused: ${primary.refusal.kind}`);

    const alternates = primary.attribution.alternates ?? [];
    expect(alternates.length).toBeGreaterThan(0);
    for (const alt of alternates) expect(alt.periodChangeEligible, alt.label).toBeUndefined();
  });
});
