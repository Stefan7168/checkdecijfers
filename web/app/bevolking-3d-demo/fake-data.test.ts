import { describe, expect, it } from 'vitest';
import { buildFakeDataset, DEMO_DATA_NOTICE, fnv1a, growthSince, mulberry32, populationIn, typeFor, YEAR_END, YEAR_START, YEARS } from './fake-data.ts';

const inputs = Array.from({ length: 300 }, (_, i) => ({ code: `GM${String(i + 1).padStart(4, '0')}`, name: `Plaats ${i + 1}`, areaKm2: 5 + ((i * 37) % 400) }));

describe('fake-data — fictional, deterministic, name-blind (ADR 049)', () => {
  it('spans 1995–2025 inclusive', () => {
    expect(YEAR_START).toBe(1995);
    expect(YEAR_END).toBe(2025);
    expect(YEARS).toHaveLength(31);
    expect(YEARS[0]).toBe(1995);
    expect(YEARS[30]).toBe(2025);
  });
  it('is deterministic: the same inputs yield byte-identical output on every call', () => {
    expect(buildFakeDataset(inputs)).toEqual(buildFakeDataset(inputs));
  });
  it('is name-blind: only the code and the area drive the numbers', () => {
    const a = buildFakeDataset([{ code: 'GM0363', name: 'Een naam', areaKm2: 219 }]);
    const b = buildFakeDataset([{ code: 'GM0363', name: 'Een heel andere naam', areaKm2: 219 }]);
    expect(a.records[0]!.population).toEqual(b.records[0]!.population);
  });
  it('different codes give different series', () => {
    const d = buildFakeDataset([{ code: 'GM0001', name: 'x', areaKm2: 50 }, { code: 'GM0002', name: 'x', areaKm2: 50 }]);
    expect(d.records[0]!.population).not.toEqual(d.records[1]!.population);
  });
  it('every record and the dataset itself are marked fictional, with the fixed notice', () => {
    const d = buildFakeDataset(inputs);
    expect(d.fictional).toBe(true);
    expect(d.notice).toBe(DEMO_DATA_NOTICE);
    expect(DEMO_DATA_NOTICE).toBe('FICTIEVE TESTDATA');
    for (const r of d.records) expect(r.fictional).toBe(true);
  });
  it('shapes: 31 integer values ≥ 500 per record; growth over the whole range stays plausible-looking but is never tuned to a real place', () => {
    const d = buildFakeDataset(inputs);
    expect(d.records).toHaveLength(300);
    for (const r of d.records) {
      expect(r.population).toHaveLength(31);
      for (const p of r.population) {
        expect(Number.isInteger(p)).toBe(true);
        expect(p).toBeGreaterThanOrEqual(500);
      }
      const g = growthSince(r, YEAR_END);
      expect(g).toBeGreaterThan(-0.4);
      expect(g).toBeLessThan(0.75);
      expect(growthSince(r, YEAR_START)).toBe(0);
      expect(populationIn(r, YEAR_START)).toBe(r.population[0]);
      expect(populationIn(r, 9999)).toBe(r.population[30]);
    }
    expect(d.maxPopulation).toBe(Math.max(...d.records.flatMap((r) => [...r.population])));
  });
  it('types follow the end-year population thresholds', () => {
    expect(typeFor(100_000)).toBe('city');
    expect(typeFor(99_999)).toBe('mid');
    expect(typeFor(30_000)).toBe('mid');
    expect(typeFor(29_999)).toBe('rural');
  });
  it('the primitives are stable (hash and PRNG pinned so the demo numbers never drift silently)', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    const r = mulberry32(1);
    const first = r();
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(1);
    expect(mulberry32(1)()).toBe(first);
  });
});
