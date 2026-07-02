// Parse-layer tests against REAL captured CBS wire data (tests/fixtures/cbs/),
// no database involved. Exercises src/cbs-adapter/fixture-source.ts, which
// replays the raw v4 responses through the same parsing code the live adapter
// uses (docs/cbs-adapter/types.ts header comment).
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { FixtureSource, loadFixtureDocs, type FixtureDocs } from '../../src/cbs-adapter/fixture-source.ts';
import { ODataV4Source } from '../../src/cbs-adapter/odata-v4.ts';
import { PHASE0_TABLES } from '../../src/ingestion/registry-seed.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));

function fixturePath(tableId: string): string {
  return `${FIXTURES_DIR}/${tableId}`;
}

describe('adapter parsing (real captured wire data)', () => {
  it('parseDimensions of 03759ned fixture yields 5 dimensions with correct kinds', async () => {
    const docs = await loadFixtureDocs(fixturePath('03759ned'));
    const source = new FixtureSource(docs);
    const schema = await source.fetchTableSchema('03759ned');

    expect(schema.dimensions).toHaveLength(5);
    const byName = Object.fromEntries(schema.dimensions.map((d) => [d.name, d.kind]));
    expect(byName.RegioS).toBe('GeoDimension');
    expect(byName.Perioden).toBe('TimeDimension');
    expect(byName.Geslacht).toBe('Dimension');
    expect(byName.Leeftijd).toBe('Dimension');
    expect(byName.BurgerlijkeStaat).toBe('Dimension');
  });

  it('parseMeasures of 82235NED gives D002936 unit "x 1 000" decimals 0', async () => {
    const docs = await loadFixtureDocs(fixturePath('82235NED'));
    const source = new FixtureSource(docs);
    const schema = await source.fetchTableSchema('82235NED');

    const measure = schema.measures.find((m) => m.code === 'D002936');
    expect(measure).toBeDefined();
    expect(measure?.unit).toBe('x 1 000');
    expect(measure?.decimals).toBe(0);
  });

  it('parseCodes of 82235NED codes-Perioden has 2024JJ00 with status, codes trimmed', async () => {
    const docs = await loadFixtureDocs(fixturePath('82235NED'));
    const source = new FixtureSource(docs);
    const codes = await source.fetchCodeList('82235NED', 'Perioden');

    const code2024 = codes.find((c) => c.code === '2024JJ00');
    expect(code2024).toBeDefined();
    expect(code2024?.status).toBe('Definitief');
    // every stored code is trimmed (catalog quirk #2)
    for (const c of codes) {
      expect(c.code).toBe(c.code.trim());
    }
  });

  it('parseObservationsPage of 82235NED page 1 finds D002936/1921JJ00 = 1442, no nextLink', async () => {
    const docs = await loadFixtureDocs(fixturePath('82235NED'));
    const source = new FixtureSource(docs);

    const pages: ReturnType<typeof source.fetchObservations> extends AsyncIterable<infer R>
      ? R[]
      : never = [];
    for await (const page of source.fetchObservations('82235NED')) {
      pages.push(page as never);
    }
    const rows = pages.flat();
    const target = rows.find((r) => r.measure === 'D002936' && r.coordinates.Perioden === '1921JJ00');
    expect(target).toBeDefined();
    expect(target?.value).toBe(1442);
  });

  it('FixtureSource end-to-end: fetchObservations of 03759ned with the seed slice yields only in-slice rows', async () => {
    const docs = await loadFixtureDocs(fixturePath('03759ned'));
    const table = PHASE0_TABLES.find((t) => t.id === '03759ned');
    if (!table?.slice) throw new Error('expected 03759ned to carry a registered slice');

    // Inject a synthetic out-of-slice row into the raw observations page so we
    // can prove the source filters client-side too, not just trusts the fixture.
    const mutatedDocs = structuredClone(docs);
    const obsPage = mutatedDocs.observationPages[0] as { value: Record<string, unknown>[] };
    const inSliceTemplate = obsPage.value.find(
      (r) => typeof r.RegioS === 'string' && (r.RegioS as string).startsWith('NL'),
    ) as Record<string, unknown>;
    obsPage.value.push({
      ...inSliceTemplate,
      Id: -1,
      RegioS: 'BU00000001', // buurt-level code: out of the NL/PV/GM slice
      Perioden: '2019JJ00',
    });
    obsPage.value.push({
      ...inSliceTemplate,
      Id: -2,
      RegioS: 'NL01',
      Perioden: '2010JJ00', // below the periodFloor
    });

    const source = new FixtureSource(mutatedDocs);
    const rows: { coordinates: Record<string, string> }[] = [];
    for await (const page of source.fetchObservations('03759ned', table.slice)) {
      rows.push(...page);
    }

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const regio = row.coordinates.RegioS;
      expect(regio.startsWith('NL') || regio.startsWith('PV') || regio.startsWith('GM')).toBe(
        true,
      );
      expect(row.coordinates.Perioden >= '2019JJ00').toBe(true);
    }
    // the injected out-of-slice rows must not survive
    expect(rows.some((r) => r.coordinates.RegioS === 'BU00000001')).toBe(false);
    expect(rows.some((r) => r.coordinates.Perioden === '2010JJ00')).toBe(false);
  });

  it('sliceToFilter: the seed 03759ned slice produces the exact expected $filter string', async () => {
    const { sliceToFilter } = await import('../../src/cbs-adapter/fixture-source.ts');
    const table = PHASE0_TABLES.find((t) => t.id === '03759ned');
    if (!table?.slice) throw new Error('expected 03759ned to carry a registered slice');

    const index = await import(`${fixturePath('03759ned')}/index.json`, {
      with: { type: 'json' },
    });
    const expected = (index.default as { sliceFilter: string }).sliceFilter;

    expect(sliceToFilter(table.slice)).toBe(expected);
  });

  it('FixtureSource: a two-page docs object yields both pages in order with no gaps/duplicates vs the single-page original', async () => {
    const docs = await loadFixtureDocs(fixturePath('82235NED'));
    const singlePage = docs.observationPages[0] as { value: Record<string, unknown>[] };
    const rowsFull = singlePage.value;
    expect(rowsFull.length).toBeGreaterThan(1);

    const splitAt = Math.floor(rowsFull.length / 2);
    const page1 = { value: rowsFull.slice(0, splitAt) };
    const page2 = { value: rowsFull.slice(splitAt) };
    const twoPageDocs: FixtureDocs = {
      ...docs,
      observationPages: [page1, page2],
    };

    const singleSource = new FixtureSource(docs);
    const twoPageSource = new FixtureSource(twoPageDocs);

    const singlePages: unknown[][] = [];
    for await (const page of singleSource.fetchObservations('82235NED')) {
      singlePages.push(page as unknown[]);
    }
    expect(singlePages).toHaveLength(1);
    const originalRows = singlePages[0]!;

    const twoPages: unknown[][] = [];
    for await (const page of twoPageSource.fetchObservations('82235NED')) {
      twoPages.push(page as unknown[]);
    }
    expect(twoPages).toHaveLength(2);
    expect(twoPages[0]!.length).toBe(splitAt);
    expect(twoPages[1]!.length).toBe(rowsFull.length - splitAt);

    // Pages yielded in order and their concatenation matches the original
    // single-page result exactly — no gaps, no duplicates.
    const concatenated = twoPages.flat();
    expect(concatenated).toEqual(originalRows);
  });

  it('ODataV4Source: follows @odata.nextLink across two pages, then stops', async () => {
    const dimensionsResponse = {
      value: [{ Identifier: 'Perioden', Title: 'Perioden', Kind: 'TimeDimension' }],
    };
    const nextLinkUrl = 'https://datasets.cbs.nl/odata/v1/CBS/TESTTABLE/Observations?%24skip=2';
    const page1Response = {
      value: [
        { Id: 0, Measure: 'M1', ValueAttribute: 'None', Value: 1, StringValue: null, Perioden: '2020JJ00' },
        { Id: 1, Measure: 'M1', ValueAttribute: 'None', Value: 2, StringValue: null, Perioden: '2021JJ00' },
      ],
      '@odata.nextLink': nextLinkUrl,
    };
    const page2Response = {
      value: [
        { Id: 2, Measure: 'M1', ValueAttribute: 'None', Value: 3, StringValue: null, Perioden: '2022JJ00' },
      ],
    };

    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      requestedUrls.push(url);
      let body: unknown;
      if (url.endsWith('/Dimensions')) body = dimensionsResponse;
      else if (url === nextLinkUrl) body = page2Response;
      else if (url.includes('/Observations')) body = page1Response;
      else throw new Error(`unexpected hermetic-stub request: ${url}`);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => body,
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const source = new ODataV4Source();
      const pages: unknown[][] = [];
      for await (const page of source.fetchObservations('TESTTABLE')) {
        pages.push(page as unknown[]);
      }

      expect(pages).toHaveLength(2);
      expect(pages[0]).toHaveLength(2);
      expect(pages[1]).toHaveLength(1);
      expect((pages[0]![0] as { value: number }).value).toBe(1);
      expect((pages[1]![0] as { value: number }).value).toBe(3);

      const nextLinkRequests = requestedUrls.filter((u) => u === nextLinkUrl);
      expect(nextLinkRequests).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
