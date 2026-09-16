// WP30c/E1 — EurostatFixtureSource against the actual committed fixture
// tree (tests/fixtures/eurostat/), the same specimens the conformance
// harness replays. These tests give more granular, direct assertions than
// the conformance harness's plain-language failure summaries.
//
// Session 107 (2026-09-16, Constraint 0 resolved): demo_pjan/namq_10_gdp/
// nrg_bal_c stay the ORIGINAL hand-built ("synthetic": true) specimens —
// their real cell counts (742,730/8,191,372/21,300,267, per a live catalog
// capture) all exceed SYNC_CELL_THRESHOLD, too large to usefully commit as
// synchronous-happy-path fixtures. tipsbd30/migr_asyapp1mp and the whole
// catalog ARE real, captured specimens ("synthetic": false) — small,
// in-threshold real datasets found via that same live capture.
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

  it('fetchCatalog replays the REAL captured Catalogue-API table of contents (session 107)', async () => {
    const entries = await source.fetchCatalog();
    // The real catalog has 10,000+ entries — assert presence, not an exact
    // full list (unlike the per-table tests above, which still replay
    // small, exact, hand-built specimens).
    const tableIds = new Set(entries.map((e) => e.tableId));
    expect(tableIds.has('eurostat:demo_pjan')).toBe(true);
    expect(tableIds.has('eurostat:tipsbd30')).toBe(true);
    expect(tableIds.has('eurostat:migr_asyapp1mp')).toBe(true);
    expect(entries.length).toBeGreaterThan(1000);
    expect(entries.every((e) => e.language === 'en')).toBe(true);
    // No 'folder' rows leaked through — every entry is a real, independently
    // queryable leaf node.
    expect(entries.every((e) => e.datasetType === 'dataset' || e.datasetType === 'table')).toBe(true);
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
