// Breadth step 5, Task 2 — the table lane's region resolver
// (src/answer/table-lane/regions.ts; plan "Settled design choices" 5–7).
// Pure; no db, no LLM. Real CBS region lists from the committed fixtures
// wherever a fixture has the shape; synthetic tables only for shapes no
// fixture has (a geo-like Dimension, a Caribisch national-only title, a geo
// table that also has region-coded breakdown members).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CbsCode, CbsTableSchema } from '../../src/cbs-adapter/types.ts';
import type { BreakdownDimension } from '../../src/query/breakdowns.ts';
import { resolveTableRegions } from '../../src/answer/table-lane/regions.ts';
import type { TableLaneTable } from '../../src/answer/table-lane/types.ts';
import type { RegionTerm } from '../../src/answer/intent/types.ts';

function loadFixture(tableId: string): TableLaneTable {
  const path = fileURLToPath(new URL(`../fixtures/tableparse/schemas/${tableId}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as TableLaneTable;
}

function dimOf(table: TableLaneTable, name: string): BreakdownDimension {
  const d = table.schema.dimensions.find((x) => x.name === name)!;
  return { name: d.name, title: d.title, kind: d.kind, members: table.codeLists[name]!.map((c) => ({ code: c.code, title: c.title })) };
}

function code(c: string, title: string): CbsCode {
  return { code: c, title, dimensionGroup: null, status: null, index: null };
}

function synthetic(title: string, regionDim?: { name: string; kind: 'GeoDimension' | 'Dimension'; codes: CbsCode[] }): TableLaneTable {
  const schema: CbsTableSchema = {
    tableId: 'T1',
    title,
    modified: null,
    measures: [{ code: 'M1', title: 'Aantal', unit: 'aantal', decimals: 0, description: '', dataType: 'Long', groupPath: [] }],
    dimensions: [
      ...(regionDim ? [{ name: regionDim.name, kind: regionDim.kind, title: 'Regio' }] : []),
      { name: 'Perioden', kind: 'TimeDimension', title: 'Perioden' },
    ],
  };
  return {
    schema,
    codeLists: { ...(regionDim ? { [regionDim.name]: regionDim.codes } : {}), Perioden: [code('2020JJ00', '2020')] },
  };
}

const geo = loadFixture('03759ned'); // RegioS GeoDimension, 892 members, one NL member (NL01)
const geoDim = dimOf(geo, 'RegioS');
const national = loadFixture('85245NED'); // no region dimension, no region-coded member

const base = { regionScope: null, hasRegionCodedBreakdownMember: false, choices: [] };

describe('resolveTableRegions — geo dimension', () => {
  it('a named place with one match → that code, recorded as a named selection', () => {
    const r = resolveTableRegions({ ...base, terms: [{ name: 'Amsterdam', kind: 'gemeente' }], table: geo, regionDims: [geoDim] });
    expect(r).toEqual({
      ok: true,
      coordinates: { RegioS: ['GM0363'] },
      defaults: [],
      named: [{ dimension: 'RegioS', dimensionTitle: "Regio's", code: 'GM0363', memberTitle: 'Amsterdam' }],
    });
  });

  it('several matches → a button question over the matches only', () => {
    const r = resolveTableRegions({ ...base, terms: [{ name: 'Utrecht', kind: 'onbekend' }], table: geo, regionDims: [geoDim] });
    expect(r).toEqual({
      ok: false,
      question: {
        dimension: 'RegioS',
        dimensionTitle: "Regio's",
        options: [
          { code: 'PV26', title: 'Utrecht (PV)' },
          { code: 'CR17', title: 'Utrecht (CR)' },
          { code: 'GM0344', title: 'Utrecht (gemeente)' },
        ],
        totalOptions: 3,
      },
    });
  });

  it('the place kind filters the matches ("gemeente Utrecht" → GM0344 only)', () => {
    const r = resolveTableRegions({ ...base, terms: [{ name: 'gemeente Utrecht', kind: 'onbekend' }], table: geo, regionDims: [geoDim] });
    expect(r).toMatchObject({ ok: true, coordinates: { RegioS: ['GM0344'] } });
  });

  it('conflicting place kinds refuse (region_unavailable), never pick one', () => {
    const r = resolveTableRegions({ ...base, terms: [{ name: 'provincie Utrecht', kind: 'gemeente' }], table: geo, regionDims: [geoDim] });
    expect(r).toMatchObject({ ok: false, reason: 'region_unavailable' });
  });

  it('a choice answers the earlier region question', () => {
    const r = resolveTableRegions({
      ...base,
      terms: [{ name: 'Utrecht', kind: 'onbekend' }],
      table: geo,
      regionDims: [geoDim],
      choices: [{ dimension: 'RegioS', code: 'GM0344' }],
    });
    expect(r).toMatchObject({ ok: true, coordinates: { RegioS: ['GM0344'] } });
  });

  it('a choice is bound to a place by membership, not queue order — terms swapping order between rounds', () => {
    const utrecht: RegionTerm = { name: 'Utrecht', kind: 'onbekend' };
    const groningen: RegionTerm = { name: 'Groningen', kind: 'onbekend' };
    const run = (terms: RegionTerm[], choices: { dimension: string; code: string }[]) =>
      resolveTableRegions({ ...base, terms, table: geo, regionDims: [geoDim], choices });

    // Round 1: [Utrecht, Groningen] → asked about Utrecht first.
    expect(run([utrecht, groningen], [])).toMatchObject({ ok: false, question: { options: [{ code: 'PV26' }, { code: 'CR17' }, { code: 'GM0344' }] } });
    // Round 2: the re-parse lists [Groningen, Utrecht]; the Utrecht pick must NOT land on Groningen.
    expect(run([groningen, utrecht], [{ dimension: 'RegioS', code: 'GM0344' }])).toEqual({
      ok: false,
      question: {
        dimension: 'RegioS',
        dimensionTitle: "Regio's",
        options: [
          { code: 'PV20', title: 'Groningen (PV)' },
          { code: 'GM0014', title: 'Groningen (gemeente)' },
        ],
        totalOptions: 2,
      },
    });
    // Round 3: both answered; order of terms flips again — each pick stays with its own place.
    const choices = [
      { dimension: 'RegioS', code: 'GM0344' },
      { dimension: 'RegioS', code: 'PV20' },
    ];
    expect(run([utrecht, groningen], choices)).toMatchObject({ ok: true, coordinates: { RegioS: ['GM0344', 'PV20'] } });
    expect(run([groningen, utrecht], choices)).toMatchObject({ ok: true, coordinates: { RegioS: ['PV20', 'GM0344'] } });
  });

  it('a choice outside the ambiguous place\'s matches is never applied — the question is asked again', () => {
    const r = resolveTableRegions({
      ...base,
      terms: [{ name: 'Utrecht', kind: 'onbekend' }],
      table: geo,
      regionDims: [geoDim],
      choices: [{ dimension: 'RegioS', code: 'GM0363' }], // Amsterdam: a real member, but not an Utrecht
    });
    expect(r).toMatchObject({ ok: false, question: { dimension: 'RegioS', totalOptions: 3 } });
  });

  it('with several NL members, a choice outside them is not applied (asked again)', () => {
    const t = synthetic('Test', {
      name: 'RegioS',
      kind: 'GeoDimension',
      codes: [code('NL01', 'Nederland'), code('NL02', 'Nederland (oud)'), code('PV20', 'Groningen (PV)')],
    });
    const dim = dimOf(t, 'RegioS');
    expect(
      resolveTableRegions({ ...base, terms: [], table: t, regionDims: [dim], choices: [{ dimension: 'RegioS', code: 'PV20' }] }),
    ).toMatchObject({ ok: false, question: { totalOptions: 2 } });
    expect(
      resolveTableRegions({ ...base, terms: [], table: t, regionDims: [dim], choices: [{ dimension: 'RegioS', code: 'NL02' }] }),
    ).toMatchObject({ ok: true, coordinates: { RegioS: ['NL02'] } });
  });

  it('a choice with a code that is not a member of the dimension throws (caller bug)', () => {
    expect(() =>
      resolveTableRegions({
        ...base,
        terms: [{ name: 'Utrecht', kind: 'onbekend' }],
        table: geo,
        regionDims: [geoDim],
        choices: [{ dimension: 'RegioS', code: 'XX99' }],
      }),
    ).toThrow();
  });

  it('an unknown place → region_unknown', () => {
    const r = resolveTableRegions({ ...base, terms: [{ name: 'Atlantis', kind: 'onbekend' }], table: geo, regionDims: [geoDim] });
    expect(r).toMatchObject({ ok: false, reason: 'region_unknown' });
  });

  it('"Nederland" on a geo table → NL01 as a named place', () => {
    const r = resolveTableRegions({ ...base, terms: [{ name: 'Nederland', kind: 'land' }], table: geo, regionDims: [geoDim] });
    expect(r).toMatchObject({ ok: true, coordinates: { RegioS: ['NL01'] } });
  });

  it('"heel Nederland" on a geo table → NL01', () => {
    const r = resolveTableRegions({ ...base, terms: [{ name: 'heel Nederland', kind: 'onbekend' }], table: geo, regionDims: [geoDim] });
    expect(r).toMatchObject({ ok: true, coordinates: { RegioS: ['NL01'] } });
  });

  it('two named places → both codes on a geo dimension', () => {
    const r = resolveTableRegions({
      ...base,
      terms: [
        { name: 'Amsterdam', kind: 'gemeente' },
        { name: 'Groningen (PV)', kind: 'onbekend' },
      ],
      table: geo,
      regionDims: [geoDim],
    });
    expect(r).toMatchObject({ ok: true, coordinates: { RegioS: ['GM0363', 'PV20'] } });
  });

  it('no place named → the single NL member, stated as a default', () => {
    const r = resolveTableRegions({ ...base, terms: [], table: geo, regionDims: [geoDim] });
    expect(r).toEqual({
      ok: true,
      coordinates: { RegioS: ['NL01'] },
      defaults: [{ dimension: 'RegioS', dimensionTitle: "Regio's", code: 'NL01', memberTitle: 'Nederland' }],
      named: [],
    });
  });

  it('no place named and no NL member → a question over the full member list', () => {
    const t = synthetic('Test', { name: 'RegioS', kind: 'GeoDimension', codes: [code('PV20', 'Groningen (PV)'), code('PV21', 'Fryslân (PV)')] });
    const r = resolveTableRegions({ ...base, terms: [], table: t, regionDims: [dimOf(t, 'RegioS')] });
    expect(r).toEqual({
      ok: false,
      question: {
        dimension: 'RegioS',
        dimensionTitle: 'Regio',
        options: [
          { code: 'PV20', title: 'Groningen (PV)' },
          { code: 'PV21', title: 'Fryslân (PV)' },
        ],
        totalOptions: 2,
      },
    });
  });

  it('no place named and several NL members → a question over those NL members', () => {
    const t = synthetic('Test', {
      name: 'RegioS',
      kind: 'GeoDimension',
      codes: [code('NL01', 'Nederland'), code('NL02', 'Nederland (oud)'), code('PV20', 'Groningen (PV)')],
    });
    const r = resolveTableRegions({ ...base, terms: [], table: t, regionDims: [dimOf(t, 'RegioS')] });
    expect(r).toMatchObject({ ok: false, question: { options: [{ code: 'NL01' }, { code: 'NL02' }], totalOptions: 2 } });
  });

  it('a geo table that ALSO has region-coded breakdown members refuses a named place', () => {
    const r = resolveTableRegions({
      ...base,
      hasRegionCodedBreakdownMember: true,
      terms: [{ name: 'Amsterdam', kind: 'gemeente' }],
      table: geo,
      regionDims: [geoDim],
    });
    expect(r).toMatchObject({ ok: false, reason: 'region_unavailable' });
  });

  it('a region class is refused (table_lane_region_class)', () => {
    const r = resolveTableRegions({ ...base, regionScope: 'all_provincies', terms: [], table: geo, regionDims: [geoDim] });
    expect(r).toMatchObject({ ok: false, reason: 'table_lane_region_class' });
  });
});

describe('resolveTableRegions — geo-like dimension', () => {
  const t = synthetic('Test', {
    name: 'Regio',
    kind: 'Dimension',
    codes: [code('NL01', 'Nederland'), code('PV20', 'Groningen (PV)'), code('PV26', 'Utrecht (PV)'), code('GM0344', 'Utrecht')],
  });
  const dim = dimOf(t, 'Regio');

  it('a named place resolves the same way', () => {
    const r = resolveTableRegions({ ...base, terms: [{ name: 'Groningen', kind: 'provincie' }], table: t, regionDims: [dim] });
    expect(r).toMatchObject({ ok: true, coordinates: { Regio: ['PV20'] } });
  });

  it('two places on a geo-like dimension are refused (one coordinate per plain dimension)', () => {
    const r = resolveTableRegions({
      ...base,
      terms: [
        { name: 'Groningen', kind: 'provincie' },
        { name: 'Utrecht', kind: 'gemeente' },
      ],
      table: t,
      regionDims: [dim],
    });
    expect(r).toMatchObject({ ok: false, reason: 'region_unavailable' });
  });
});

describe('resolveTableRegions — national-only table ("Nederland", rule 5)', () => {
  it('no terms → nothing to resolve', () => {
    expect(resolveTableRegions({ ...base, terms: [], table: national, regionDims: [] })).toEqual({
      ok: true,
      coordinates: {},
      defaults: [],
      named: [],
    });
  });

  it('"Nederland" is absorbed by a national-only table, with the national-table line', () => {
    expect(resolveTableRegions({ ...base, terms: [{ name: 'Nederland', kind: 'land' }], table: national, regionDims: [] })).toEqual({
      ok: true,
      coordinates: {},
      defaults: [],
      named: [],
      nationalTable: true,
    });
  });

  it('"heel Nederland" is absorbed too', () => {
    expect(
      resolveTableRegions({ ...base, terms: [{ name: 'heel Nederland', kind: 'onbekend' }], table: national, regionDims: [] }),
    ).toMatchObject({ ok: true, nationalTable: true });
  });

  it('"Nederland" on a table titled with "Caribisch" → region_unavailable', () => {
    const t = synthetic('Caribisch Nederland; bevolking');
    expect(resolveTableRegions({ ...base, terms: [{ name: 'Nederland', kind: 'land' }], table: t, regionDims: [] })).toMatchObject({
      ok: false,
      reason: 'region_unavailable',
    });
  });

  it('any other place on a national-only table → region_unavailable', () => {
    expect(
      resolveTableRegions({ ...base, terms: [{ name: 'Amsterdam', kind: 'gemeente' }], table: national, regionDims: [] }),
    ).toMatchObject({ ok: false, reason: 'region_unavailable' });
  });

  it('"Nederland" on a regionless table WITH region-coded breakdown members is left to the breakdown (never nationalTable)', () => {
    const t = loadFixture('85004NED');
    expect(
      resolveTableRegions({
        ...base,
        hasRegionCodedBreakdownMember: true,
        terms: [{ name: 'Nederland', kind: 'land' }],
        table: t,
        regionDims: [],
      }),
    ).toEqual({ ok: true, coordinates: {}, defaults: [], named: [] });
  });

  it('a regionless table WITH region-coded breakdown members leaves places to the breakdowns (parser-checked)', () => {
    const t = loadFixture('85004NED');
    expect(
      resolveTableRegions({
        ...base,
        hasRegionCodedBreakdownMember: true,
        terms: [{ name: 'Groningen (PV)', kind: 'provincie' }],
        table: t,
        regionDims: [],
      }),
    ).toEqual({ ok: true, coordinates: {}, defaults: [], named: [] });
  });
});
