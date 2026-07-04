// #56 servability dry-run (WP15, ADR 021 decision 4) — hermetic against the
// fixture-ingested PGlite database (ADR 009). The load-bearing claims:
// (1) a servable intent yields EXACTLY {servable:true} — no cells, no values
//     can cross the return boundary (the structural no-numbers guarantee the
//     echo-clarification builders rely on);
// (2) the V22/V23 shape (a range starting before the loaded slice) is
//     unservable and names the honest, gap-free loaded year window;
// (3) refusals without their own freshness payload fall back to the
//     grain-agnostic canonical freshest — period + status only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { echoServability } from '../../src/query/index.ts';
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

function intent(partial: Partial<StructuredIntent> & Pick<StructuredIntent, 'target' | 'period'>): StructuredIntent {
  return { schemaVersion: 1, derivation: 'none', ...partial };
}

const population = (extra: Partial<StructuredIntent> = {}): StructuredIntent =>
  intent({
    target: { kind: 'canonical', key: 'population_on_1_january' },
    regions: ['GM0363'],
    period: { kind: 'codes', codes: ['2024JJ00'] },
    ...extra,
  });

describe('echoServability (#56, ADR 021 decision 4)', () => {
  it('a servable intent returns EXACTLY {servable: true} — no cells, no values, nothing else', async () => {
    const verdict = await echoServability(db, population());
    // toEqual (not a partial match) IS the point: any extra key would be a
    // channel through which a value could reach a clarification builder.
    expect(verdict).toEqual({ servable: true });
  });

  it('V22/V23 shape: a range starting before the loaded slice is unservable and names the gap-free loaded year window', async () => {
    const verdict = await echoServability(
      db,
      population({ period: { kind: 'range', from: '1970JJ00', to: '2024JJ00' }, derivation: 'series' }),
    );
    expect(verdict.servable).toBe(false);
    if (verdict.servable) throw new Error('unreachable');
    expect(verdict.kind).toBe('outside_loaded_slice');
    expect(verdict.availability.yearRange).toEqual({ fromYear: 2019, toYear: 2026 });
  });

  it('a period beyond the freshest published year is unservable with the freshness offer (period + status only)', async () => {
    const verdict = await echoServability(db, population({ period: { kind: 'codes', codes: ['2030JJ00'] } }));
    expect(verdict.servable).toBe(false);
    if (verdict.servable) throw new Error('unreachable');
    expect(verdict.kind).toBe('freshness');
    expect(verdict.availability.freshest).not.toBeNull();
    expect(verdict.availability.freshest!.periodCode).toMatch(/^\d{4}JJ00$/);
    // The whole verdict serializes without any value-like field.
    expect(JSON.stringify(verdict)).not.toMatch(/"value"/);
  });

  it('an intent missing its region on a geo table is unservable as needs_clarification, axes named', async () => {
    const verdict = await echoServability(db, population({ regions: undefined }));
    expect(verdict.servable).toBe(false);
    if (verdict.servable) throw new Error('unreachable');
    expect(verdict.kind).toBe('needs_clarification');
    expect(verdict.axes).toContain('region');
  });

  it('a grain the canonical coordinate never publishes (unemployment per year) falls back to the grain-agnostic canonical freshest', async () => {
    const verdict = await echoServability(
      db,
      intent({
        target: { kind: 'canonical', key: 'unemployment_rate_seasonally_adjusted' },
        period: { kind: 'codes', codes: ['2024JJ00'] },
      }),
    );
    expect(verdict.servable).toBe(false);
    if (verdict.servable) throw new Error('unreachable');
    // No yearly series exists at the canonical (seasonally-adjusted)
    // coordinate: no year window may be promised …
    expect(verdict.availability.yearRange).toBeNull();
    // … but the grain-agnostic freshest (a quarter) IS an honest offer.
    expect(verdict.availability.freshest).not.toBeNull();
    expect(verdict.availability.freshest!.periodCode).toMatch(/^\d{4}KW\d{2}$/);
  });
});
