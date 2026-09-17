// ADR 055 Task 1 — the CONDITIONAL one-varying-axis gate.
//
// Session 110 (UX-audit pass-3 row 13) relaxes ADR 011's "one varying axis per
// question" rule for exactly one case: 2..REGION_SERIES_MAX_REGIONS EXPLICITLY
// NAMED regions over a period range, one line per region. Everything else that
// used to hit that refusal still hits it, with the same `invalid_intent` kind
// and the same `multi_region_multi_period` sub-reason — which is what this file
// pins from both sides: what now resolves, and what deliberately still does not.
//
// Hermetic against the fixture-ingested PGlite database (ADR 009).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveIntent, REGION_SERIES_MAX_CELLS, REGION_SERIES_MAX_REGIONS } from '../../src/query/index.ts';
import type { QueryRefusal, StructuredIntent } from '../../src/query/index.ts';
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

/** The 12 provincie codes of 03759ned, in roster order — a handy source of
 * "more named regions than the cap allows". */
const PROVINCIES = ['PV20', 'PV21', 'PV22', 'PV23', 'PV24', 'PV25', 'PV26', 'PV27', 'PV28', 'PV29', 'PV30', 'PV31'];

async function refusalFor(intent: StructuredIntent): Promise<QueryRefusal['refusal']> {
  const outcome = await resolveIntent(db, intent);
  expect(outcome.ok, 'expected a refusal, got a resolved query').toBe(false);
  if (outcome.ok) throw new Error('unreachable');
  return outcome.refusal;
}

describe('ADR 055 — a multi-region series RESOLVES', () => {
  it('2 named regions over a 5-year range resolve, in the intent\'s own region order, both labelled', async () => {
    const outcome = await resolveIntent(
      db,
      population({
        regions: ['GM0363', 'GM0599'],
        period: { kind: 'range', from: '2020JJ00', to: '2024JJ00' },
      }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error(`unexpected refusal: ${outcome.refusal.message}`);
    const { resolved } = outcome;
    // Intent order, never re-sorted: the chart's series order is this order
    // (R6 — the chart is a verbatim projection of the result).
    expect(resolved.regionCodes).toEqual(['GM0363', 'GM0599']);
    expect(resolved.periodCodes).toEqual(['2020JJ00', '2021JJ00', '2022JJ00', '2023JJ00', '2024JJ00']);
    expect(resolved.regionLabels['GM0363']).toBeTruthy();
    expect(resolved.regionLabels['GM0599']).toBeTruthy();
    expect(resolved.regionSet).toBeNull();
    // INTENT_SCHEMA_VERSION is untouched: the shape is derived from fields the
    // contract already had, so the echoed intent is the caller's own object.
    expect(resolved.intent.schemaVersion).toBe(1);
  });

  it(`the reverse region order resolves in ITS order too — nothing here sorts`, async () => {
    const outcome = await resolveIntent(
      db,
      population({
        regions: ['GM0599', 'GM0363'],
        period: { kind: 'range', from: '2022JJ00', to: '2024JJ00' },
      }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.resolved.regionCodes).toEqual(['GM0599', 'GM0363']);
  });

  it(`exactly ${REGION_SERIES_MAX_REGIONS} regions is inside the cap`, async () => {
    const outcome = await resolveIntent(
      db,
      population({
        regions: PROVINCIES.slice(0, REGION_SERIES_MAX_REGIONS),
        period: { kind: 'range', from: '2021JJ00', to: '2024JJ00' },
      }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.resolved.regionCodes).toHaveLength(REGION_SERIES_MAX_REGIONS);
  });

  it('an explicit `series` derivation over several named regions resolves too', async () => {
    const outcome = await resolveIntent(
      db,
      population({
        regions: ['GM0363', 'GM0599'],
        period: { kind: 'range', from: '2020JJ00', to: '2024JJ00' },
        derivation: 'series',
      }),
    );
    expect(outcome.ok).toBe(true);
  });
});

describe('ADR 055 — what still REFUSES, with the unchanged sub-reason', () => {
  it(`more than ${REGION_SERIES_MAX_REGIONS} named regions refuses — a named region is never silently dropped to fit`, async () => {
    const refusal = await refusalFor(
      population({
        regions: PROVINCIES.slice(0, REGION_SERIES_MAX_REGIONS + 1),
        period: { kind: 'range', from: '2023JJ00', to: '2024JJ00' },
      }),
    );
    expect(refusal.kind).toBe('invalid_intent');
    expect(refusal.subReason).toBe('multi_region_multi_period');
    expect(refusal.message).toContain('one varying axis per question');
    expect(refusal.message).toContain(String(REGION_SERIES_MAX_REGIONS));
  });

  it('a region CLASS over a range still refuses — ADR 054\'s axis is untouched by this relaxation', async () => {
    const refusal = await refusalFor(
      population({
        regionSet: { kind: 'all_provincies' },
        period: { kind: 'range', from: '2020JJ00', to: '2024JJ00' },
      }),
    );
    expect(refusal.kind).toBe('invalid_intent');
    expect(refusal.subReason).toBe('multi_region_multi_period');
    expect(refusal.message).toContain('one varying axis per question');
  });

  it(`a cross-product over ${REGION_SERIES_MAX_CELLS} cells refuses rather than storing an envelope nobody can read back`, async () => {
    // 6 regions x 120 quarters = 720 cells. Structural: this refusal fires
    // before any registry read, so the KW grain on a yearly measure never
    // matters here.
    const refusal = await refusalFor(
      population({
        regions: PROVINCIES.slice(0, REGION_SERIES_MAX_REGIONS),
        period: { kind: 'range', from: '1995KW01', to: '2024KW04' },
      }),
    );
    expect(refusal.kind).toBe('invalid_intent');
    expect(refusal.subReason).toBe('multi_region_multi_period');
    expect(refusal.message).toContain(String(REGION_SERIES_MAX_CELLS));
  });

  it('several named regions on a table with NO geo dimension refuses on the region axis, exactly as one region would', async () => {
    const refusal = await refusalFor({
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'unemployment_rate_seasonally_adjusted' },
      regions: ['GM0363', 'GM0599'],
      period: { kind: 'range', from: '2024KW01', to: '2024KW04' },
      derivation: 'none',
    });
    expect(refusal.kind).toBe('invalid_intent');
    expect(refusal.axis).toBe('region');
    expect(refusal.message).toContain('no regional dimension');
    // Not the scope limit: the table simply has no place axis at all.
    expect(refusal.subReason).toBeUndefined();
  });

  it('a `difference` derivation over several regions keeps its OWN, more specific arity refusal', async () => {
    const refusal = await refusalFor(
      population({
        regions: ['GM0363', 'GM0599'],
        period: { kind: 'range', from: '2023JJ00', to: '2024JJ00' },
        derivation: 'difference',
      }),
    );
    expect(refusal.kind).toBe('invalid_intent');
    expect(refusal.axis).toBe('derivation');
    expect(refusal.message).toContain('difference');
    expect(refusal.subReason).toBeUndefined();
  });

  it('a `max` derivation over several regions AND several periods keeps its own arity refusal too', async () => {
    const refusal = await refusalFor(
      population({
        regions: ['GM0363', 'GM0599'],
        period: { kind: 'range', from: '2023JJ00', to: '2024JJ00' },
        derivation: 'max',
      }),
    );
    expect(refusal.kind).toBe('invalid_intent');
    expect(refusal.axis).toBe('derivation');
    expect(refusal.message).toContain('max');
    expect(refusal.subReason).toBeUndefined();
  });

  it('regions and regionSet together are still mutually exclusive, whatever the period', async () => {
    const refusal = await refusalFor(
      population({
        regions: ['GM0363'],
        regionSet: { kind: 'all_provincies' },
        period: { kind: 'range', from: '2023JJ00', to: '2024JJ00' },
      }),
    );
    expect(refusal.kind).toBe('invalid_intent');
    expect(refusal.axis).toBe('region');
  });
});

describe('ADR 055 — the neighbouring shapes are byte-identical to today', () => {
  it('one region over a range still resolves exactly as before', async () => {
    const outcome = await resolveIntent(
      db,
      population({ regions: ['GM0363'], period: { kind: 'range', from: '2020JJ00', to: '2024JJ00' }, derivation: 'series' }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.resolved.regionCodes).toEqual(['GM0363']);
    expect(outcome.resolved.periodCodes).toHaveLength(5);
  });

  it('several regions at ONE period still resolve exactly as before', async () => {
    const outcome = await resolveIntent(db, population({ regions: ['GM0363', 'GM0599', 'GM0518'] }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.resolved.regionCodes).toEqual(['GM0363', 'GM0599', 'GM0518']);
    expect(outcome.resolved.periodCodes).toEqual(['2025JJ00']);
  });
});
