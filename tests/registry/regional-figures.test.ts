import { describe, expect, it } from 'vitest';
import { CANONICAL_MEASURES } from '../../src/registry/defaults.ts';
import { REGIONAL_KEYS } from '../../src/answer/intent/prompt.ts';
import { SEED_TABLES } from '../../src/ingestion/registry-seed.ts';

const EXPECTED: Record<string, string> = {
  population_density: 'M000100',
  average_woz_value: 'M003039',
  owner_occupied_homes_share: '1014800',
  highly_educated_share: '2018790',
  passenger_cars_per_1000_residents: 'A018943_2',
  distance_to_train_station: 'X092783',
  population_growth_per_1000: 'M000101_3',
  average_household_size: 'M000114',
  single_person_households_share: '1050015_2',
  business_establishments: 'M000200_2',
  benefit_recipients_total: 'X033647',
  distance_to_large_supermarket: 'D000025',
};

describe('ADR 061 Part 2 — the 12 regional figures', () => {
  it('each key maps to its 70072ned code, has no dims, and is regional', () => {
    for (const [key, code] of Object.entries(EXPECTED)) {
      const m = CANONICAL_MEASURES.find((c) => c.key === key);
      expect(m, key).toBeDefined();
      expect(m!.tableId).toBe('70072ned');
      expect(m!.measure).toBe(code);
      expect(m!.dims).toEqual({});
      expect(REGIONAL_KEYS.has(key), key).toBe(true);
    }
  });

  it('serves exactly the seed allow-list — no figure the period-note map was not reviewed for', () => {
    const seed = SEED_TABLES.find((t) => t.id === '70072ned');
    expect([...Object.values(EXPECTED)].sort()).toEqual([...(seed?.slice?.measures ?? [])].sort());
  });

  it('carries the meaning traps in the Dutch definition labels', () => {
    const label = (k: string) => CANONICAL_MEASURES.find((c) => c.key === k)!.definitionLabel;
    expect(label('benefit_recipients_total')).toMatch(/AOW/);
    expect(label('average_woz_value')).toMatch(/niet de verkoopprijs/);
    expect(label('distance_to_train_station')).toMatch(/over de weg/);
    expect(label('business_establishments')).toMatch(/1 januari/);
  });
});
