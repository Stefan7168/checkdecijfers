// WP30c/E1 — EurostatFixtureSource against the actual committed fixture
// tree (tests/fixtures/eurostat/), the same specimens the conformance
// harness replays. These tests give more granular, direct assertions than
// the conformance harness's plain-language failure summaries.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EurostatFixtureSource,
  loadEurostatCatalogFixture,
  loadEurostatFixtureTree,
} from '../../src/eurostat-adapter/fixture-source.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/eurostat', import.meta.url));

describe('EurostatFixtureSource — replays the committed synthetic fixtures through the real parser', () => {
  const source = new EurostatFixtureSource(
    loadEurostatFixtureTree(FIXTURES_DIR),
    loadEurostatCatalogFixture(FIXTURES_DIR),
  );

  it('demo_pjan: annual, single unit, no flags', async () => {
    const schema = await source.fetchTableSchema('eurostat:demo_pjan');
    expect(schema.measures.map((m) => m.code)).toEqual(['demo_pjan|NR']);
    expect(schema.dimensions.find((d) => d.kind === 'TimeDimension')?.name).toBe('time');
    expect(schema.dimensions.find((d) => d.kind === 'GeoDimension')?.name).toBe('geo');

    const timeCodes = await source.fetchCodeList('eurostat:demo_pjan', 'time');
    expect(timeCodes.map((c) => c.code).sort()).toEqual(['2021JJ00', '2022JJ00', '2023JJ00']);
    expect(timeCodes.every((c) => c.status === 'Published')).toBe(true);

    const rows: unknown[] = [];
    for await (const page of source.fetchObservations('eurostat:demo_pjan')) rows.push(...page);
    expect(rows).toHaveLength(9);

    expect(await source.fetchObservationCount('eurostat:demo_pjan')).toBe(9);
  });

  it('namq_10_gdp: quarterly, a break flag on a real value, a null-reason flag on a null cell', async () => {
    const rows: Array<{ coordinates: Record<string, string>; value: number | null; valueAttribute: string }> = [];
    for await (const page of source.fetchObservations('eurostat:namq_10_gdp')) rows.push(...page);
    expect(rows).toHaveLength(6);

    const nullRow = rows.find((r) => r.value === null)!;
    expect(nullRow.valueAttribute).toBe(':');
    expect(nullRow.coordinates.geo).toBe('NL');
    expect(nullRow.coordinates.time).toBe('2023KW03');

    const breakRow = rows.find((r) => r.valueAttribute === 'b')!;
    expect(breakRow.value).not.toBeNull();
    expect(breakRow.coordinates.geo).toBe('DE');
    expect(breakRow.coordinates.time).toBe('2023KW02');
  });

  it('nrg_bal_c: the per-unit measure split (2 units -> 2 measures)', async () => {
    const schema = await source.fetchTableSchema('eurostat:nrg_bal_c');
    expect(schema.measures.map((m) => m.code).sort()).toEqual(['nrg_bal_c|GWH', 'nrg_bal_c|KTOE']);
  });

  it('fetchCatalog replays the synthetic Catalogue-API specimen', async () => {
    const entries = await source.fetchCatalog();
    expect(entries.map((e) => e.tableId).sort()).toEqual([
      'eurostat:demo_pjan',
      'eurostat:namq_10_gdp',
      'eurostat:nrg_bal_c',
    ]);
    expect(entries.every((e) => e.language === 'en')).toBe(true);
  });

  it('an unknown table id throws a descriptive error, not a silent empty result', async () => {
    await expect(source.fetchTableSchema('eurostat:does_not_exist')).rejects.toThrow(/no fixture registered/);
  });
});

describe('EurostatFixtureSource — the "synthetic" manifest field is REQUIRED, not just conventional', () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('loadEurostatFixtureTree refuses a table directory whose index.json omits "synthetic"', () => {
    dir = mkdtempSync(join(tmpdir(), 'eurostat-fixture-test-'));
    const tableDir = join(dir, 'some_table');
    mkdirSync(tableDir);
    writeFileSync(join(tableDir, 'dataset.json'), '{}');
    writeFileSync(join(tableDir, 'index.json'), JSON.stringify({ dataset: 'dataset.json' }));
    expect(() => loadEurostatFixtureTree(dir)).toThrow(/synthetic/);
  });

  it('loadEurostatCatalogFixture refuses a catalog fixture whose manifest omits "synthetic"', () => {
    dir = mkdtempSync(join(tmpdir(), 'eurostat-catalog-test-'));
    writeFileSync(join(dir, '_catalog.json'), JSON.stringify({ link: { item: [] } }));
    expect(() => loadEurostatCatalogFixture(dir)).toThrow(/synthetic/);
  });
});
