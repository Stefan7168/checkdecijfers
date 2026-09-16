// ADR 049: the 3D municipality DEMO's data — ALL OF IT IS FICTION.
// This module is the only producer of a number shown on /bevolking-3d-demo.
// It never reads a real statistic, never touches the database, never sees a
// municipality NAME (only its code and its polygon area), and is
// deterministic: the same boundary file yields the same fake numbers on
// every load. The numbers are deliberately NOT tuned to resemble real
// municipalities — a fake that looks right for a known city is more
// dangerous than one that looks off (principle (c), applied to a demo).
// Every record and the dataset carry `fictional: true`; the UI marks every
// element that shows one of these numbers with data-fictional (map3d.tsx).
export const DEMO_DATA_NOTICE = 'FICTIEVE TESTDATA' as const;
export const YEAR_START = 1995;
export const YEAR_END = 2025;
export const YEARS: readonly number[] = Array.from({ length: YEAR_END - YEAR_START + 1 }, (_, i) => YEAR_START + i);
const DEMO_SEED = 0x3dde0001;

export type MunicipalityType = 'city' | 'mid' | 'rural';

export interface FakeMunicipalityInput {
  code: string;
  name: string;
  areaKm2: number;
}
export interface FakeMunicipalityRecord {
  readonly fictional: true;
  readonly code: string;
  readonly name: string;
  readonly type: MunicipalityType;
  readonly population: readonly number[];
}
export interface FakeDataset {
  readonly fictional: true;
  readonly notice: typeof DEMO_DATA_NOTICE;
  readonly records: readonly FakeMunicipalityRecord[];
  readonly maxPopulation: number;
}

/** 32-bit FNV-1a — a stable, dependency-free string hash. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — a tiny seeded PRNG; enough for demo noise, never for anything else. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function typeFor(populationAtEnd: number): MunicipalityType {
  if (populationAtEnd >= 100_000) return 'city';
  if (populationAtEnd >= 30_000) return 'mid';
  return 'rural';
}

function fakeSeries(code: string, areaKm2: number): number[] {
  const rng = mulberry32(fnv1a(code) ^ DEMO_SEED);
  const density = Math.exp(4 + rng() * 4.2); // ≈ 55 … ≈ 3 600 per km², log-uniform
  let pop = Math.max(800, Math.round(Math.max(1, areaKm2) * density));
  const trend = -0.008 + rng() * 0.024; // −0.8 % … +1.6 % per year
  const series = [pop];
  for (let i = 1; i < YEARS.length; i++) {
    const noise = (rng() - 0.5) * 0.01;
    pop = Math.max(500, Math.round(pop * (1 + trend + noise)));
    series.push(pop);
  }
  return series;
}

export function buildFakeDataset(inputs: readonly FakeMunicipalityInput[]): FakeDataset {
  const records = inputs.map((m): FakeMunicipalityRecord => {
    const population = fakeSeries(m.code, m.areaKm2);
    return { fictional: true, code: m.code, name: m.name, type: typeFor(population[population.length - 1]!), population };
  });
  const maxPopulation = records.reduce((max, r) => Math.max(max, ...r.population), 0);
  return { fictional: true, notice: DEMO_DATA_NOTICE, records, maxPopulation };
}

export function yearIndex(year: number): number {
  return Math.min(YEARS.length - 1, Math.max(0, Math.round(year) - YEAR_START));
}
export function populationIn(record: FakeMunicipalityRecord, year: number): number {
  return record.population[yearIndex(year)]!;
}
/** Fraction: +0.12 = twelve percent more than at YEAR_START. */
export function growthSince(record: FakeMunicipalityRecord, year: number): number {
  const base = record.population[0]!;
  return base > 0 ? populationIn(record, year) / base - 1 : 0;
}
