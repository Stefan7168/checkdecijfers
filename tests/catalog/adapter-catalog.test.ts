// Catalog adapter parsing against REAL captured CBS wire data
// (tests/fixtures/cbs/_catalog.json), plus the loud-failure discipline
// (ADR 003 / docs/05: missing required fields throw, never silently drop).
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FixtureSource,
  loadCatalogFixture,
  loadFixtureDocs,
} from '../../src/cbs-adapter/fixture-source.ts';
import { parseCatalogPage } from '../../src/cbs-adapter/parse-v4.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));

describe('parseCatalogPage (real captured catalog wire data)', () => {
  it('parses the catalog fixture into entries with the exact wire fields', () => {
    const raw = loadCatalogFixture(FIXTURES_DIR);
    const { entries, nextLink } = parseCatalogPage(raw);

    expect(entries.length).toBeGreaterThan(20);
    expect(nextLink).toBeNull(); // bounded snapshot, no live paging link

    // Our registered house-price table, exact fields.
    const houses = entries.find((e) => e.tableId === '85773NED');
    expect(houses).toBeDefined();
    expect(houses?.title).toContain('koopwoningen');
    expect(houses?.status).toBe('Regulier');
    expect(houses?.datasetType).toBe('Numeric');
    expect(houses?.language).toBe('nl');
    expect(houses?.summary.length).toBeGreaterThan(0);
  });

  it('preserves table-id casing verbatim (quirk #1 — never normalized)', () => {
    const { entries } = parseCatalogPage(loadCatalogFixture(FIXTURES_DIR));
    const ids = entries.map((e) => e.tableId);
    // The fixture contains a lowercase-suffix id and uppercase-suffix ids.
    expect(ids).toContain('03759ned'); // lowercase 'ned'
    expect(ids).toContain('86141NED'); // uppercase 'NED'
  });

  it('every curated seed id (8 Phase-0 + coverage sprint) is present in the fixture', () => {
    const { entries } = parseCatalogPage(loadCatalogFixture(FIXTURES_DIR));
    const ids = new Set(entries.map((e) => e.tableId));
    for (const id of [
      '03759ned',
      '86141NED',
      '85224NED',
      '82235NED',
      '85773NED',
      '82242NED',
      '83932NED',
      '82610NED',
      '83693NED', // coverage sprint #1 (docs/11-coverage-table-set.md)
      '85770NED', // coverage sprint #3
      '85880NED', // coverage sprint #2
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('tolerates a missing Description (summary defaults to empty), keeps other optional fields null when absent', () => {
    const raw = {
      value: [{ Identifier: '99999NED', Title: 'Test zonder omschrijving' }],
    };
    const { entries } = parseCatalogPage(raw);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      tableId: '99999NED',
      title: 'Test zonder omschrijving',
      summary: '',
      status: null,
      datasetType: null,
      language: null,
      modified: null,
    });
  });

  it('throws loudly on a row missing Identifier or Title', () => {
    expect(() => parseCatalogPage({ value: [{ Title: 'geen id' }] })).toThrow(/Identifier/);
    expect(() => parseCatalogPage({ value: [{ Identifier: '1' }] })).toThrow(/Title/);
  });

  it('throws loudly when the response has no value array', () => {
    expect(() => parseCatalogPage({})).toThrow(/missing a 'value' array/);
    expect(() => parseCatalogPage({ value: 'nope' })).toThrow(/not an array/);
  });

  it('parses @odata.nextLink when present', () => {
    const { nextLink } = parseCatalogPage({
      value: [{ Identifier: '1', Title: 'x' }],
      '@odata.nextLink': 'https://example/next',
    });
    expect(nextLink).toBe('https://example/next');
  });
});

describe('FixtureSource.fetchCatalog', () => {
  it('replays the captured catalog through the real parse code', async () => {
    const source = new FixtureSource({}, loadCatalogFixture(FIXTURES_DIR));
    const entries = await source.fetchCatalog();
    expect(entries.some((e) => e.tableId === '85773NED')).toBe(true);
  });

  it('throws a descriptive error when no catalog fixture was provided', async () => {
    // A per-table docs object with no catalog second arg.
    const source = new FixtureSource(await loadFixtureDocs(`${FIXTURES_DIR}/85773NED`));
    await expect(source.fetchCatalog()).rejects.toThrow(/no captured catalog fixture/);
  });

  it('loadCatalogFixture returns null when the file is absent', () => {
    expect(loadCatalogFixture('/nonexistent/dir')).toBeNull();
  });
});
