// Parse-layer tests against REAL captured CBS wire data (tests/fixtures/cbs/),
// no database involved. Exercises src/cbs-adapter/fixture-source.ts, which
// replays the raw v4 responses through the same parsing code the live adapter
// uses (docs/cbs-adapter/types.ts header comment).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { CbsObservationRow, CbsTableSchema } from '../../src/cbs-adapter/types.ts';
import { FixtureSource, loadFixtureDocs, type FixtureDocs } from '../../src/cbs-adapter/fixture-source.ts';
import { ODataV4Source } from '../../src/cbs-adapter/odata-v4.ts';
import { parseMeasureGroups, parseMeasures } from '../../src/cbs-adapter/parse-v4.ts';
import { PHASE0_TABLES } from '../../src/ingestion/registry-seed.ts';
import { computeFingerprint } from '../../src/ingestion/fingerprint.ts';
import { unitsFromMeasures } from '../../src/ingestion/pipeline.ts';

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

  // Breadth step 3, Task 1: every dimension carries CBS's own 'Title' verbatim.
  it('parseDimensions of 03759ned fixture fills title from CBS Title (BurgerlijkeStaat -> "Burgerlijke staat")', async () => {
    const docs = await loadFixtureDocs(fixturePath('03759ned'));
    const source = new FixtureSource(docs);
    const schema = await source.fetchTableSchema('03759ned');

    const burgerlijkeStaat = schema.dimensions.find((d) => d.name === 'BurgerlijkeStaat');
    expect(burgerlijkeStaat?.title).toBe('Burgerlijke staat');
    // every dimension in this fixture carries a non-empty CBS Title.
    for (const d of schema.dimensions) {
      expect(d.title.length).toBeGreaterThan(0);
    }
  });

  // Breadth step 3, Task 1: computeFingerprint hashes only name + kind
  // (fingerprint.ts), so adding `title` to CbsDimension must not change it —
  // pinned against a value computed BEFORE this task's change existed.
  it('computeFingerprint of the 03759ned fixture schema is unchanged by adding CbsDimension.title', async () => {
    const docs = await loadFixtureDocs(fixturePath('03759ned'));
    const source = new FixtureSource(docs);
    const schema = await source.fetchTableSchema('03759ned');

    const fingerprint = computeFingerprint(
      schema.dimensions,
      schema.measures.map((m) => m.code),
    );
    expect(fingerprint).toBe('a8d13e655814e9292b7dfa37adf29dfd141111098d6352e4e15afc33cf7194f8');
  });

  it('parseMeasures of 82235NED gives D002936 unit "x 1 000" decimals 0', async () => {
    const docs = await loadFixtureDocs(fixturePath('82235NED'));
    const source = new FixtureSource(docs);
    const schema = await source.fetchTableSchema('82235NED');

    const measure = schema.measures.find((m) => m.code === 'D002936');
    expect(measure).toBeDefined();
    expect(measure?.unit).toBe('x 1 000');
    expect(measure?.decimals).toBe(0);
    // #115 lever b: the CBS 'Description' blurb is captured verbatim (it drives
    // the onboarded answer's real "Definitie:" line), not dropped on the floor.
    expect(measure?.description).toContain('Aantal aan het begin van de periode.');
  });

  // Breadth step 4b, Task 1: CBS's own MeasureGroups, resolved root -> leaf,
  // distinguishes measures that share a title (e.g. every "Seizoengecorrigeerd"
  // measure in 80590ned) by the group CBS files them under.
  describe('measure groups (breadth step 4b, Task 1)', () => {
    it('parseMeasures of 80590ned fills groupPath from MeasureGroups (D002308 -> ["Beroepsbevolking"])', async () => {
      const docs = await loadFixtureDocs(fixturePath('80590ned'));
      const source = new FixtureSource(docs);
      const schema = await source.fetchTableSchema('80590ned');

      const d002308 = schema.measures.find((m) => m.code === 'D002308');
      expect(d002308?.title).toBe('Seizoengecorrigeerd');
      expect(d002308?.groupPath).toEqual(['Beroepsbevolking']);

      // Every measure in this fixture references a real MeasureGroupId
      // (measured live 2026-09-29 — see index.json), so every one resolves
      // to a non-empty, single-level path.
      for (const m of schema.measures) {
        expect(m.groupPath.length).toBe(1);
      }
    });

    it('parseMeasures of 82235NED (fixture has no MeasureGroups file) leaves every measure groupPath empty', async () => {
      const docs = await loadFixtureDocs(fixturePath('82235NED'));
      const source = new FixtureSource(docs);
      const schema = await source.fetchTableSchema('82235NED');

      expect(schema.measures.length).toBeGreaterThan(0);
      for (const m of schema.measures) {
        expect(m.groupPath).toEqual([]);
      }
      // No captured file = "no groups", not "groups unavailable" (I2).
      expect(schema).not.toHaveProperty('measureGroupsUnavailable');
    });

    // Pinned BEFORE this task's change existed (computed from the fixture with
    // the then-current parser): computeFingerprint hashes dimensions (name +
    // kind) and measure CODES only (fingerprint.ts) — never measure objects —
    // so adding CbsMeasure.groupPath must not move this value.
    it('computeFingerprint of the 80590ned fixture schema is unchanged by adding CbsMeasure.groupPath', async () => {
      const docs = await loadFixtureDocs(fixturePath('80590ned'));
      const source = new FixtureSource(docs);
      const schema = await source.fetchTableSchema('80590ned');

      const fingerprint = computeFingerprint(
        schema.dimensions,
        schema.measures.map((m) => m.code),
      );
      expect(fingerprint).toBe('2f96d990d5d476dbee389907e5e069231ca60801ef533a5990b396417a9fc2b9');
    });

    // unitsFromMeasures (src/ingestion/pipeline.ts) copies named fields only
    // (constraints.md: cbs_tables.units stays byte-identical) — groupPath must
    // never leak into the stored registry units, even for a measure that has one.
    it('unitsFromMeasures output is unchanged for a measure carrying a groupPath', async () => {
      const docs = await loadFixtureDocs(fixturePath('80590ned'));
      const source = new FixtureSource(docs);
      const schema = await source.fetchTableSchema('80590ned');

      const d002308 = schema.measures.find((m) => m.code === 'D002308')!;
      expect(d002308.groupPath.length).toBeGreaterThan(0); // precondition: this measure DOES have a group path

      const units = unitsFromMeasures(schema.measures);
      expect(units['D002308']).toEqual({
        unit: d002308.unit,
        decimals: d002308.decimals,
        title: d002308.title,
        description: d002308.description,
      });
      expect(units['D002308']).not.toHaveProperty('groupPath');
    });

    // 80590ned's own groups do not nest (measured live 2026-09-29: all 7 have
    // ParentId null), but real nested groups DO exist elsewhere — the
    // committed 86116NED table-parse fixture (written by the same adapter via
    // scripts/extract-tableparse-schemas) carries 2- and 3-level paths,
    // pinned by the real-data test below. The synthetic pair here isolates
    // the root -> leaf ordering itself.
    it('real nested groups: the committed 86116NED table-parse fixture carries 2- and 3-level group paths, root -> leaf', () => {
      const fixture = JSON.parse(
        readFileSync(fileURLToPath(new URL('../fixtures/tableparse/schemas/86116NED.json', import.meta.url)), 'utf8'),
      ) as { schema: CbsTableSchema };
      const byCode = new Map(fixture.schema.measures.map((m) => [m.code, m]));
      expect(byCode.get('M004746_2')?.groupPath).toEqual(['Toegang en gebruik internet', 'Vaste internetverbinding']);
      expect(byCode.get('M000783')?.groupPath).toEqual([
        'Personeel en ICT',
        'Toegang tot ICT-systeem van buitenaf',
        'Biedt toegang tot',
      ]);
    });

    it('parseMeasureGroups + parseMeasures resolves a two-level group path root -> leaf', () => {
      const groupsRaw = {
        value: [
          { Id: 'ROOT', Title: 'Arbeidsmarkt', ParentId: null },
          { Id: 'LEAF', Title: 'Werkloze beroepsbevolking', ParentId: 'ROOT' },
        ],
      };
      const measuresRaw = {
        value: [
          {
            Identifier: 'M1',
            Title: 'Seizoengecorrigeerd',
            Unit: 'x 1000',
            Decimals: 0,
            MeasureGroupId: 'LEAF',
          },
        ],
      };
      const groups = parseMeasureGroups(groupsRaw);
      const measures = parseMeasures(measuresRaw, groups);
      expect(measures[0]?.groupPath).toEqual(['Arbeidsmarkt', 'Werkloze beroepsbevolking']);
    });

    it('a MeasureGroupId pointing at a missing group stops the path there ([]), never throws', () => {
      const groupsRaw = { value: [] }; // MeasureGroupId references a group CBS never listed
      const measuresRaw = {
        value: [
          { Identifier: 'M1', Title: 'Iets', Unit: 'aantal', Decimals: 0, MeasureGroupId: 'GHOST' },
        ],
      };
      const groups = parseMeasureGroups(groupsRaw);
      expect(() => parseMeasures(measuresRaw, groups)).not.toThrow();
      const measures = parseMeasures(measuresRaw, groups);
      expect(measures[0]?.groupPath).toEqual([]);
    });

    it('no MeasureGroupId on the measure at all -> groupPath []', () => {
      const groupsRaw = { value: [{ Id: 'G1', Title: 'Iets', ParentId: null }] };
      const measuresRaw = {
        value: [{ Identifier: 'M1', Title: 'Iets', Unit: 'aantal', Decimals: 0 }],
      };
      const measures = parseMeasures(measuresRaw, parseMeasureGroups(groupsRaw));
      expect(measures[0]?.groupPath).toEqual([]);
    });

    it('a ParentId cycle terminates instead of looping forever', () => {
      // A and B point at each other — a CBS-side data error this parser must
      // survive (loud-never-silent is for missing/ambiguous data, not for
      // defending against an impossible-but-conceivable cyclic graph).
      const groupsRaw = {
        value: [
          { Id: 'A', Title: 'Groep A', ParentId: 'B' },
          { Id: 'B', Title: 'Groep B', ParentId: 'A' },
        ],
      };
      const measuresRaw = {
        value: [{ Identifier: 'M1', Title: 'Iets', Unit: 'aantal', Decimals: 0, MeasureGroupId: 'A' }],
      };
      const groups = parseMeasureGroups(groupsRaw);
      let measures: ReturnType<typeof parseMeasures> = [];
      expect(() => {
        measures = parseMeasures(measuresRaw, groups);
      }).not.toThrow();
      // Terminates with SOME finite path (first repeat stops the walk) rather
      // than hanging or growing unbounded.
      expect(measures[0]?.groupPath.length).toBeLessThanOrEqual(2);
    });
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

  it('sliceToFilter: measures allow-list is appended last — single code without parentheses, several ORed in parentheses', async () => {
    const { sliceToFilter } = await import('../../src/cbs-adapter/fixture-source.ts');
    expect(sliceToFilter({ measures: ['M000100'] })).toBe("Measure eq 'M000100'");
    expect(
      sliceToFilter({ dimensionPrefixes: { RegioS: ['NL', 'PV'] }, periodFloor: '2015JJ00', measures: ['A', 'B'] }),
    ).toBe("(startswith(RegioS,'NL') or startswith(RegioS,'PV')) and Perioden ge '2015JJ00' and (Measure eq 'A' or Measure eq 'B')");
    // empty list = no measure clause at all (never "match nothing")
    expect(sliceToFilter({ periodFloor: '2015JJ00', measures: [] })).toBe("Perioden ge '2015JJ00'");
  });

  it('sliceToFilter: dimensionIn and periodIn are appended LAST, after every existing clause', async () => {
    const { sliceToFilter } = await import('../../src/cbs-adapter/fixture-source.ts');
    // Single code per dimension: no parentheses. Dimension keys sorted (A before B).
    expect(sliceToFilter({ dimensionIn: { B: ['b1'], A: ['a1'] } })).toBe(
      "A eq 'a1' and B eq 'b1'",
    );
    // Several codes: parenthesised, ORed, codes kept in given order.
    expect(sliceToFilter({ dimensionIn: { RegioS: ['GM0363', 'GM0599'] } })).toBe(
      "(RegioS eq 'GM0363' or RegioS eq 'GM0599')",
    );
    // periodIn: single code no parens, several parenthesised.
    expect(sliceToFilter({ periodIn: { dimension: 'Perioden', codes: ['2019JJ00'] } })).toBe(
      "Perioden eq '2019JJ00'",
    );
    expect(
      sliceToFilter({ periodIn: { dimension: 'Perioden', codes: ['2019JJ00', '2020JJ00'] } }),
    ).toBe("(Perioden eq '2019JJ00' or Perioden eq '2020JJ00')");
    // Everything together, in the fixed clause order: dimensionEquals,
    // dimensionPrefixes, periodFloor, measures, dimensionIn, periodIn.
    expect(
      sliceToFilter({
        dimensionEquals: { Geslacht: 'T001038' },
        dimensionPrefixes: { RegioS: ['NL', 'PV'] },
        periodFloor: '2015JJ00',
        measures: ['M1'],
        dimensionIn: { Leeftijd: ['A1', 'A2'] },
        periodIn: { dimension: 'Perioden', codes: ['2019JJ00'] },
      }),
    ).toBe(
      "Geslacht eq 'T001038' and (startswith(RegioS,'NL') or startswith(RegioS,'PV')) and " +
        "Perioden ge '2015JJ00' and Measure eq 'M1' and (Leeftijd eq 'A1' or Leeftijd eq 'A2') and " +
        "Perioden eq '2019JJ00'",
    );
    // Empty arrays add nothing.
    expect(sliceToFilter({ dimensionIn: { RegioS: [] } })).toBeNull();
    expect(sliceToFilter({ periodIn: { dimension: 'Perioden', codes: [] } })).toBeNull();
    // Existing 03759ned-style slices (no dimensionIn/periodIn at all) are
    // untouched — proven by the dedicated exact-string test above; this test
    // only proves the NEW fields append last without disturbing that order.
  });

  it('FixtureSource: dimensionIn and periodIn are applied client-side, matching sliceToFilter semantics', async () => {
    const docs = await loadFixtureDocs(fixturePath('03759ned'));
    const source = new FixtureSource(docs);
    const rows: CbsObservationRow[] = [];
    for await (const page of source.fetchObservations('03759ned', {
      dimensionIn: { RegioS: ['NL01'] },
    })) {
      rows.push(...page);
    }
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.coordinates.RegioS === 'NL01')).toBe(true);

    const periodRows: CbsObservationRow[] = [];
    for await (const page of source.fetchObservations('03759ned', {
      periodIn: { dimension: 'Perioden', codes: ['2020JJ00'] },
    })) {
      periodRows.push(...page);
    }
    expect(periodRows.length).toBeGreaterThan(0);
    expect(periodRows.every((r) => r.coordinates.Perioden === '2020JJ00')).toBe(true);

    // Empty codes array = no restriction from that clause (matches everything).
    const allRows: CbsObservationRow[] = [];
    for await (const page of source.fetchObservations('03759ned', {
      dimensionIn: { RegioS: [] },
    })) {
      allRows.push(...page);
    }
    const unfiltered: CbsObservationRow[] = [];
    for await (const page of source.fetchObservations('03759ned')) {
      unfiltered.push(...page);
    }
    expect(allRows.length).toBe(unfiltered.length);
  });

  it('parseMeasures of 70072ned fills dataType from CBS DataType (String / Double), "" when absent', async () => {
    const docs = await loadFixtureDocs(fixturePath('70072ned'));
    const source = new FixtureSource(docs);
    const schema = await source.fetchTableSchema('70072ned');

    const cp0001 = schema.measures.find((m) => m.code === 'CP0001');
    expect(cp0001?.dataType).toBe('String');
    const m000100 = schema.measures.find((m) => m.code === 'M000100');
    expect(m000100?.dataType).toBe('Double');
  });

  it('FixtureSource: a measures slice keeps only the listed measure codes', async () => {
    const docs = await loadFixtureDocs(fixturePath('82235NED'));
    const source = new FixtureSource(docs);
    const keep = 'M003003';
    const rows: CbsObservationRow[] = [];
    for await (const page of source.fetchObservations('82235NED', { measures: [keep] })) rows.push(...page);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.measure === keep)).toBe(true);
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

  it('#156 ODataV4Source: reuses caller-supplied dimension names, skipping the redundant /Dimensions fetch', async () => {
    const pageResponse = {
      value: [{ Id: 0, Measure: 'M1', ValueAttribute: 'None', Value: 7, StringValue: null, Perioden: '2020JJ00' }],
    };
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      requestedUrls.push(url);
      let body: unknown;
      if (url.endsWith('/Dimensions')) body = { value: [{ Identifier: 'Perioden', Title: 'Perioden', Kind: 'TimeDimension' }] };
      else if (url.includes('/Observations')) body = pageResponse;
      else throw new Error(`unexpected hermetic-stub request: ${url}`);
      return { ok: true, status: 200, statusText: 'OK', json: async () => body };
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const source = new ODataV4Source();
      const pages: unknown[][] = [];
      // The caller (the ingestion pipeline) hands in the already-validated
      // dimension names, so the adapter must NOT re-fetch /Dimensions.
      for await (const page of source.fetchObservations('TESTTABLE', undefined, ['Perioden'])) {
        pages.push(page as unknown[]);
      }

      // The passed names were actually USED (Perioden resolved as a coordinate).
      expect(pages).toHaveLength(1);
      const row = pages[0]![0] as { value: number; coordinates: Record<string, string> };
      expect(row.value).toBe(7);
      expect(row.coordinates.Perioden).toBe('2020JJ00');
      // The redundant /Dimensions fetch is gone.
      expect(requestedUrls.some((u) => u.endsWith('/Dimensions'))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('fetchObservationCount (WP16 sub-part 2 §4)', () => {
  it('FixtureSource returns the manifest observationRows count', async () => {
    // 82235NED's committed manifest records observationRows: 889.
    const source = new FixtureSource(loadFixtureDocs(fixturePath('82235NED')));
    expect(await source.fetchObservationCount('82235NED')).toBe(889);
  });

  it('ODataV4Source parses the $count body as an integer', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/Observations/$count')) {
        return { ok: true, status: 200, statusText: 'OK', text: async () => '123456' };
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      expect(await new ODataV4Source().fetchObservationCount('T')).toBe(123456);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('ODataV4Source returns null on a 404 (count unavailable, never a throw)', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => 'not found',
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      expect(await new ODataV4Source().fetchObservationCount('T')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('ODataV4Source returns null on a non-integer body (never a fabricated size)', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '<html>not a count</html>',
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      expect(await new ODataV4Source().fetchObservationCount('T')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('ODataV4Source.fetchTableSchema — MeasureGroups (breadth step 4b, Task 1)', () => {
  const propertiesResponse = { Title: 'Test tabel' };
  const dimensionsResponse = {
    value: [{ Identifier: 'Perioden', Title: 'Perioden', Kind: 'TimeDimension' }],
  };
  const measuresResponse = {
    value: [{ Identifier: 'M1', Title: 'Seizoengecorrigeerd', Unit: 'x 1000', Decimals: 0, MeasureGroupId: 'G1' }],
  };

  it('fetches MeasureGroups alongside MeasureCodes and fills groupPath', async () => {
    const groupsResponse = { value: [{ Id: 'G1', Title: 'Beroepsbevolking', ParentId: null }] };
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/Properties')) return { ok: true, status: 200, statusText: 'OK', json: async () => propertiesResponse };
      if (url.endsWith('/Dimensions')) return { ok: true, status: 200, statusText: 'OK', json: async () => dimensionsResponse };
      if (url.endsWith('/MeasureCodes')) return { ok: true, status: 200, statusText: 'OK', json: async () => measuresResponse };
      if (url.endsWith('/MeasureGroups')) return { ok: true, status: 200, statusText: 'OK', json: async () => groupsResponse };
      throw new Error(`unexpected hermetic-stub request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const schema = await new ODataV4Source().fetchTableSchema('TESTTABLE');
      expect(schema.measures[0]?.groupPath).toEqual(['Beroepsbevolking']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a 404 on MeasureGroups means no groups (every measure groupPath []), never a throw', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/Properties')) return { ok: true, status: 200, statusText: 'OK', json: async () => propertiesResponse };
      if (url.endsWith('/Dimensions')) return { ok: true, status: 200, statusText: 'OK', json: async () => dimensionsResponse };
      if (url.endsWith('/MeasureCodes')) return { ok: true, status: 200, statusText: 'OK', json: async () => measuresResponse };
      if (url.endsWith('/MeasureGroups')) return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) };
      throw new Error(`unexpected hermetic-stub request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const schema = await new ODataV4Source().fetchTableSchema('TESTTABLE');
      expect(schema.measures[0]?.groupPath).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('an empty MeasureGroups list means no groups (every measure groupPath [])', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/Properties')) return { ok: true, status: 200, statusText: 'OK', json: async () => propertiesResponse };
      if (url.endsWith('/Dimensions')) return { ok: true, status: 200, statusText: 'OK', json: async () => dimensionsResponse };
      if (url.endsWith('/MeasureCodes')) return { ok: true, status: 200, statusText: 'OK', json: async () => measuresResponse };
      if (url.endsWith('/MeasureGroups')) return { ok: true, status: 200, statusText: 'OK', json: async () => ({ value: [] }) };
      throw new Error(`unexpected hermetic-stub request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const schema = await new ODataV4Source().fetchTableSchema('TESTTABLE');
      expect(schema.measures[0]?.groupPath).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // Final-review I2 (breadth step 4b fix wave): MeasureGroups is
  // BEST-EFFORT. Groups are never stored (they only feed the table-scoped
  // parser's prompt), so a MeasureGroups outage must never fail a production
  // sync — the schema resolves with every groupPath [] and the in-memory
  // measureGroupsUnavailable flag, which buildTableParseSchema refuses.
  function stubWithGroups(groups: () => { ok: boolean; status: number; statusText: string; json: () => Promise<unknown> }) {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/Properties')) return { ok: true, status: 200, statusText: 'OK', json: async () => propertiesResponse };
      if (url.endsWith('/Dimensions')) return { ok: true, status: 200, statusText: 'OK', json: async () => dimensionsResponse };
      if (url.endsWith('/MeasureCodes')) return { ok: true, status: 200, statusText: 'OK', json: async () => measuresResponse };
      if (url.endsWith('/MeasureGroups')) return groups();
      throw new Error(`unexpected hermetic-stub request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('a 500 on MeasureGroups (after the normal retries) resolves the schema: every groupPath [] + measureGroupsUnavailable', async () => {
    const fetchMock = stubWithGroups(() => ({ ok: false, status: 500, statusText: 'Internal Server Error', json: async () => ({}) }));
    try {
      const schema = await new ODataV4Source().fetchTableSchema('TESTTABLE');
      expect(schema.measures[0]?.groupPath).toEqual([]);
      expect(schema.measureGroupsUnavailable).toBe(true);
      expect(schema.title).toBe('Test tabel');
      // the normal retries still ran (3 attempts) before degrading
      expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/MeasureGroups'))).toHaveLength(3);
    } finally {
      vi.unstubAllGlobals();
    }
  }, 15_000); // 3 retries with backoff (RETRY_BACKOFF_MS), like the equivalent Eurostat test

  it('a malformed MeasureGroups row (missing Title) resolves the schema: every groupPath [] + measureGroupsUnavailable', async () => {
    stubWithGroups(() => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({ value: [{ Id: 'G1', ParentId: null }] }) }));
    try {
      const schema = await new ODataV4Source().fetchTableSchema('TESTTABLE');
      expect(schema.measures[0]?.groupPath).toEqual([]);
      expect(schema.measureGroupsUnavailable).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a MeasureGroups body that is not a value array resolves the schema: every groupPath [] + measureGroupsUnavailable', async () => {
    stubWithGroups(() => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({ unexpected: true }) }));
    try {
      const schema = await new ODataV4Source().fetchTableSchema('TESTTABLE');
      expect(schema.measures[0]?.groupPath).toEqual([]);
      expect(schema.measureGroupsUnavailable).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a 404 on MeasureGroups ("this table has no groups") sets NO unavailable flag', async () => {
    stubWithGroups(() => ({ ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) }));
    try {
      const schema = await new ODataV4Source().fetchTableSchema('TESTTABLE');
      expect(schema.measures[0]?.groupPath).toEqual([]);
      expect(schema).not.toHaveProperty('measureGroupsUnavailable');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a successful MeasureGroups fetch sets NO unavailable flag', async () => {
    stubWithGroups(() => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({ value: [{ Id: 'G1', Title: 'Beroepsbevolking', ParentId: null }] }) }));
    try {
      const schema = await new ODataV4Source().fetchTableSchema('TESTTABLE');
      expect(schema.measures[0]?.groupPath).toEqual(['Beroepsbevolking']);
      expect(schema).not.toHaveProperty('measureGroupsUnavailable');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a failure on a REQUIRED metadata fetch (MeasureCodes 500) still throws — only MeasureGroups is best-effort', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/Properties')) return { ok: true, status: 200, statusText: 'OK', json: async () => propertiesResponse };
      if (url.endsWith('/Dimensions')) return { ok: true, status: 200, statusText: 'OK', json: async () => dimensionsResponse };
      if (url.endsWith('/MeasureCodes')) return { ok: false, status: 500, statusText: 'Internal Server Error', json: async () => ({}) };
      if (url.endsWith('/MeasureGroups')) return { ok: true, status: 200, statusText: 'OK', json: async () => ({ value: [] }) };
      throw new Error(`unexpected hermetic-stub request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(new ODataV4Source().fetchTableSchema('TESTTABLE')).rejects.toThrow(/CBS OData request failed/);
    } finally {
      vi.unstubAllGlobals();
    }
  }, 15_000);
});

describe('ODataV4Source — time limit, retries and readable errors (#357)', () => {
  const dimensionsBody = { value: [{ Identifier: 'Perioden', Title: 'Perioden', Kind: 'TimeDimension' }] };
  const pageBody = {
    value: [{ Id: 0, Measure: 'M1', ValueAttribute: 'None', Value: 7, StringValue: null, Perioden: '2020JJ00' }],
  };
  const never = () => new Promise<never>(() => {});
  const fast = { retryBackoffMs: 1 };
  const okJson = (body: unknown) => ({ ok: true, status: 200, statusText: 'OK', json: async () => body });

  it('uses the injected fetchFn, not the global fetch', async () => {
    const globalFetch = vi.fn(async () => {
      throw new Error('global fetch must not be called');
    });
    vi.stubGlobal('fetch', globalFetch);
    try {
      const fetchFn = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', text: async () => '42' }));
      const source = new ODataV4Source({ fetchFn: fetchFn as unknown as typeof fetch });
      expect(await source.fetchObservationCount('T')).toBe(42);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(globalFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a hung metadata call fails after 3 timed-out attempts, naming the URL and the timeout', async () => {
    const fetchFn = vi.fn(never);
    const source = new ODataV4Source({ fetchFn: fetchFn as unknown as typeof fetch, metadataTimeoutMs: 20, ...fast });
    const err = await source.fetchCodeList('T', 'Perioden').catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/failed after 3 attempts/);
    expect((err as Error).message).toContain('https://datasets.cbs.nl/odata/v1/CBS/T/PeriodenCodes');
    expect((err as Error).message).toMatch(/timed out after 0\.02 seconds/);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('a timeout counts as ONE attempt: the retry that follows can still succeed', async () => {
    let calls = 0;
    const fetchFn = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return never();
      return okJson({ value: [{ Identifier: 'A', Title: 'Alpha', Description: null }] });
    });
    const source = new ODataV4Source({ fetchFn: fetchFn as unknown as typeof fetch, metadataTimeoutMs: 20, ...fast });
    const codes = await source.fetchCodeList('T', 'Perioden');
    expect(codes).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('a server that sends headers and then stalls the body is cut off too', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', json: never }));
    const source = new ODataV4Source({ fetchFn: fetchFn as unknown as typeof fetch, metadataTimeoutMs: 20, ...fast });
    await expect(source.fetchCodeList('T', 'Perioden')).rejects.toThrow(/timed out after 0\.02 seconds/);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('the optional (MeasureGroups) fetch times out into the best-effort path, schema still resolves', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/Properties')) return okJson({ Title: 'Test tabel' });
      if (url.endsWith('/Dimensions')) return okJson(dimensionsBody);
      if (url.endsWith('/MeasureCodes')) return okJson({ value: [{ Identifier: 'M1', Title: 'x', Unit: 'x 1000', Decimals: 0 }] });
      return never(); // MeasureGroups hangs
    });
    const source = new ODataV4Source({ fetchFn: fetchFn as unknown as typeof fetch, metadataTimeoutMs: 20, ...fast });
    const schema = await source.fetchTableSchema('T');
    expect(schema.measureGroupsUnavailable).toBe(true);
    expect(fetchFn.mock.calls.filter(([u]) => String(u).endsWith('/MeasureGroups'))).toHaveLength(3);
  });

  it('a hung $count call fails after 3 timed-out attempts and names the URL', async () => {
    const fetchFn = vi.fn(never);
    const source = new ODataV4Source({ fetchFn: fetchFn as unknown as typeof fetch, metadataTimeoutMs: 20, ...fast });
    const err = await source.fetchObservationCount('T').catch((e: Error) => e);
    expect((err as Error).message).toContain('https://datasets.cbs.nl/odata/v1/CBS/T/Observations/$count');
    expect((err as Error).message).toMatch(/timed out after 0\.02 seconds/);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('an Observations page has its own (longer) limit than metadata calls', async () => {
    // The page takes 60 ms: over the 20 ms metadata limit, inside the 2 s page limit.
    const fetchFn = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 60));
      return okJson(pageBody);
    });
    const source = new ODataV4Source({
      fetchFn: fetchFn as unknown as typeof fetch,
      metadataTimeoutMs: 20,
      observationsTimeoutMs: 2000,
      ...fast,
    });
    const pages: unknown[][] = [];
    for await (const page of source.fetchObservations('T', undefined, ['Perioden'])) pages.push(page as unknown[]);
    expect(pages).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('a very long request address is shortened in the error message', async () => {
    // A warm request can carry a filter of several thousand characters; the message named it twice.
    const fetchFn = vi.fn(async () => ({ ok: false, status: 400, statusText: 'Bad Request', text: async () => 'node count limit' }));
    const source = new ODataV4Source({ fetchFn: fetchFn as unknown as typeof fetch, ...fast });
    const codes = Array.from({ length: 400 }, (_, i) => `GM${String(i).padStart(4, '0')}`);
    const run = async () => {
      for await (const page of source.fetchObservations('T', { dimensionIn: { RegioS: codes } }, ['RegioS', 'Perioden'])) void page;
    };
    const err = await run().catch((e: Error) => e);
    const message = (err as Error).message;
    expect(message).toContain('https://datasets.cbs.nl/odata/v1/CBS/T/Observations?');
    expect(message).toContain('node count limit');
    expect(message.length).toBeLessThan(1200);
  });

  it('the catalogue download has its own (longer) limit than metadata calls', async () => {
    // Measured 2026-09-30: the full catalogue is 6.8 MB and took 21 s — too close to the 30 s
    // metadata limit. Here it takes 60 ms: over the 20 ms metadata limit, inside its own 2 s.
    const fetchFn = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 60));
      return okJson({ value: [{ Identifier: '85773NED', Title: 'Koopwoningen', Status: 'Regulier' }] });
    });
    const source = new ODataV4Source({
      fetchFn: fetchFn as unknown as typeof fetch,
      metadataTimeoutMs: 20,
      catalogTimeoutMs: 2000,
      ...fast,
    });
    const entries = await source.fetchCatalog();
    expect(entries.map((e) => e.tableId)).toEqual(['85773NED']);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('a hung Observations page fails on the observations limit, naming the URL', async () => {
    const fetchFn = vi.fn(never);
    const source = new ODataV4Source({
      fetchFn: fetchFn as unknown as typeof fetch,
      metadataTimeoutMs: 5000,
      observationsTimeoutMs: 20,
      ...fast,
    });
    const run = async () => {
      for await (const page of source.fetchObservations('T', undefined, ['Perioden'])) void page;
    };
    await expect(run()).rejects.toThrow(/T\/Observations.*timed out after 0\.02 seconds/);
  });

  it('a non-OK answer carries a short summary of the body (OData error.message)', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => JSON.stringify({ error: { code: '400', message: 'Unknown property Foo in filter' } }),
    }));
    const source = new ODataV4Source({ fetchFn: fetchFn as unknown as typeof fetch, ...fast });
    await expect(source.fetchCodeList('T', 'Perioden')).rejects.toThrow(
      /CBS OData request failed: 400 Bad Request for https:\/\/\S+: Unknown property Foo in filter/,
    );
  });

  it('a non-OK $count answer carries the summary too (HTML stripped)', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => '<html><body><h1>Down for   maintenance</h1></body></html>',
    }));
    const source = new ODataV4Source({ fetchFn: fetchFn as unknown as typeof fetch, ...fast });
    await expect(source.fetchObservationCount('T')).rejects.toThrow(
      /CBS OData \$count request failed: 503 Service Unavailable for https:\/\/\S+: Down for maintenance/,
    );
  });

  it("if the error body cannot be read, the message is exactly today's (status + statusText + URL)", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => {
        throw new Error('stream broke');
      },
    }));
    const source = new ODataV4Source({ fetchFn: fetchFn as unknown as typeof fetch, ...fast });
    const url = 'https://datasets.cbs.nl/odata/v1/CBS/T/PeriodenCodes';
    await expect(source.fetchCodeList('T', 'Perioden')).rejects.toThrow(
      `CBS OData request failed after 3 attempts for ${url}: CBS OData request failed: 500 Internal Server Error for ${url}`,
    );
  });

  it('a stalled error body does not hang: the attempt times out', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 500, statusText: 'Oops', text: never }));
    const source = new ODataV4Source({ fetchFn: fetchFn as unknown as typeof fetch, metadataTimeoutMs: 20, ...fast });
    await expect(source.fetchCodeList('T', 'Perioden')).rejects.toThrow(/timed out after 0\.02 seconds/);
  });
});

describe('sliceToFilter — single quotes in values are escaped (#357)', () => {
  it('doubles a single quote in every kind of value, never in dimension names', async () => {
    const { sliceToFilter } = await import('../../src/cbs-adapter/fixture-source.ts');
    expect(sliceToFilter({ dimensionEquals: { Geslacht: "a'b" } })).toBe("Geslacht eq 'a''b'");
    expect(sliceToFilter({ dimensionPrefixes: { RegioS: ["O'"] } })).toBe("startswith(RegioS,'O''')");
    expect(sliceToFilter({ periodFloor: "20'15" })).toBe("Perioden ge '20''15'");
    expect(sliceToFilter({ measures: ["M'1", 'M2'] })).toBe("(Measure eq 'M''1' or Measure eq 'M2')");
    expect(sliceToFilter({ dimensionIn: { RegioS: ["x'", 'y'] } })).toBe("(RegioS eq 'x''' or RegioS eq 'y')");
    expect(sliceToFilter({ periodIn: { dimension: 'Perioden', codes: ["p'1"] } })).toBe("Perioden eq 'p''1'");
  });

  it('a value that would close the literal and inject a clause stays inside the literal', async () => {
    const { sliceToFilter } = await import('../../src/cbs-adapter/fixture-source.ts');
    expect(sliceToFilter({ dimensionEquals: { Geslacht: "x' or 1 eq 1 or Geslacht eq 'y" } })).toBe(
      "Geslacht eq 'x'' or 1 eq 1 or Geslacht eq ''y'",
    );
  });
});
