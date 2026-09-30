// #357 study step 1: the Eurostat structure reader, on the REAL SDMX structure messages captured 2026-09-30
// (tests/fixtures/eurostat-structure/, refresh: `node scripts/capture-eurostat-fixtures.ts --structure`).
// Hermetic: no network, no production database (PGlite for the one registration).
//
// It proves: the strict XML reader refuses what it does not read; the structure of the four registered
// datasets is a SUPERSET of what today's download-based registration holds (same dimensions, titles, code
// labels, measure titles; more codes); geo levels come from Eurostat's LEVEL annotation and the licence rule
// sits on top; a dataset without `unit` or with an unsupported grain is refused; malformed or unknown
// structure fails closed; and `registerSchemaOnly` registers a Eurostat id from the structure alone.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { CbsSlice } from '../../src/cbs-adapter/types.ts';
import {
  EU_EFTA_LICENSED_AGGREGATE_CODES,
  EU_EFTA_LICENSED_COUNTRY_CODES,
  EU_EFTA_STAND_IN_GEO_CODES,
  parseJsonStatDataset,
} from '../../src/eurostat-adapter/jsonstat.ts';
import {
  eurostatLayoutFromStructure,
  EurostatLayoutRefusalError,
  EurostatStructureError,
  fitEurostatStructure,
  geoLevelOf,
  licensedGeo,
  readEurostatStructure,
  type EurostatStructure,
} from '../../src/eurostat-adapter/sdmx-structure.ts';
import { StatisticsApiSource, structureUrls } from '../../src/eurostat-adapter/statistics-api.ts';
import { parseXml, XmlParseError } from '../../src/eurostat-adapter/xml.ts';
import { registerSchemaOnly } from '../../src/ingestion/slice-cache.ts';
import { EUROSTAT_SIBLING_REGISTRATIONS } from '../../src/sources/eurostat-siblings.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

const text = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
const json = (rel: string): unknown => JSON.parse(text(rel));

function xmlOf(code: string): { dataflow: string; constraint: string } {
  return {
    dataflow: text(`../fixtures/eurostat-structure/${code}.dataflow.xml`),
    constraint: text(`../fixtures/eurostat-structure/${code}.constraint.xml`),
  };
}

function structureOf(code: string): EurostatStructure {
  const { dataflow, constraint } = xmlOf(code);
  return readEurostatStructure(code, dataflow, constraint);
}

/** Today's registrations of the four datasets: the download (JSON-stat) parse of the committed real captures,
 * with the scope production registers them with (tipsbd30: none; the siblings: their reviewed slice). */
const TODAY: { id: string; code: string; slice: CbsSlice | undefined; capture: string }[] = [
  { id: 'eurostat:tipsbd30', code: 'tipsbd30', slice: undefined, capture: '../fixtures/eurostat/tipsbd30/dataset.json' },
  ...EUROSTAT_SIBLING_REGISTRATIONS.map((r) => {
    const code = r.tableId.slice('eurostat:'.length);
    return { id: r.tableId, code, slice: r.slice, capture: `../fixtures/eurostat-siblings/${code}.json` };
  }),
];

// ---------------------------------------------------------------------------
// The XML reader
// ---------------------------------------------------------------------------

describe('parseXml (strict)', () => {
  it('reads namespaces, attributes, entities, character references and CDATA', () => {
    const root = parseXml(
      '<?xml version="1.0" encoding="UTF-8"?>\n<!-- c --><a:r xmlns:a="urn:a" xmlns:b="urn:b" id="x&amp;y">' +
        '<b:c xml:lang="en">Ma&#223;einheit &lt;&#x41;&gt;</b:c><Ref id="z"/><d><![CDATA[<raw>]]></d></a:r>',
    );
    expect(root).toMatchObject({ ns: 'urn:a', name: 'r', attributes: { id: 'x&y' } });
    const [c, ref, d] = root.children;
    expect(c).toMatchObject({ ns: 'urn:b', name: 'c', text: 'Maßeinheit <A>', attributes: { 'xml:lang': 'en' } });
    expect(ref).toMatchObject({ ns: null, name: 'Ref', attributes: { id: 'z' } });
    expect(d!.text).toBe('<raw>');
  });

  const bad: [string, string][] = [
    ['a DOCTYPE', '<!DOCTYPE r [<!ENTITY e "x">]><r>&e;</r>'],
    ['a processing instruction', '<r><?php x ?></r>'],
    ['an unknown entity', '<r>&nbsp;</r>'],
    ['a bare ampersand', '<r>a & b</r>'],
    ['an unbound prefix', '<p:r/>'],
    ['a duplicate attribute', '<r a="1" a="2"/>'],
    ['a mismatched end tag', '<r><a></b></r>'],
    ['an unclosed element', '<r><a></r>'],
    ['text outside the root', '<r/>junk'],
    ['two roots', '<r/><s/>'],
    ['no root', '   '],
    ['a non-UTF-8 declaration', '<?xml version="1.0" encoding="ISO-8859-1"?><r/>'],
    ['an unquoted attribute', '<r a=1/>'],
  ];
  for (const [what, input] of bad) {
    it(`refuses ${what}`, () => {
      expect(() => parseXml(input)).toThrow(XmlParseError);
    });
  }
});

// ---------------------------------------------------------------------------
// The four real structures
// ---------------------------------------------------------------------------

describe('readEurostatStructure on the real captures', () => {
  it('reads une_rt_q: key order, labels, occurring codes, annotations', () => {
    const s = structureOf('une_rt_q');
    expect(s.datasetCode).toBe('UNE_RT_Q');
    expect(s.title).toBe('Unemployment by sex and age - quarterly data');
    expect(s.dimensions.map((d) => d.name)).toEqual(['freq', 's_adj', 'age', 'unit', 'sex', 'geo', 'time']);
    expect(s.dimensions.find((d) => d.name === 'unit')!.codes.map((c) => [c.code, c.label])).toEqual([
      ['THS_PER', 'Thousand persons'],
      ['PC_POP', 'Percentage of total population'],
      ['PC_ACT', 'Percentage of population in the labour force'],
    ]);
    expect(s.annotations).toMatchObject({
      updateData: '2026-09-10T23:00:00+0200',
      obsCount: 485391,
      oldestPeriod: '2003-Q1',
      latestPeriod: '2026-Q2',
    });
    const time = s.dimensions.find((d) => d.name === 'time')!;
    expect(time.codes).toHaveLength(94);
  });

  it('A1 holds on all four: the constraint time list runs exactly from the stated oldest to the stated latest period', () => {
    for (const { code } of TODAY) {
      const fit = fitEurostatStructure(`eurostat:${code}`, structureOf(code));
      expect(fit.ok, code).toBe(true);
    }
  });
});

describe('superset of today’s registration (the four registered datasets)', () => {
  for (const t of TODAY) {
    it(t.id, () => {
      const today = parseJsonStatDataset(json(t.capture), t.id, t.slice);
      const decimals = new Map(today.schema.measures.map((m) => [m.code.split('|')[1]!, m.decimals]));
      const layout = eurostatLayoutFromStructure(t.id, structureOf(t.code), (u) => decimals.get(u) ?? 1);
      if (!layout.ok) throw new Error(layout.summary);

      // Same dimensions: names, kinds and titles, in the same order.
      expect(layout.schema.dimensions).toEqual(today.schema.dimensions);
      expect(layout.schema.title).toBe(today.schema.title);
      // Every measure today holds, identically (code, title, unit label; decimals are today's, see the reader).
      for (const m of today.schema.measures) {
        expect(layout.schema.measures, m.code).toContainEqual(m);
      }
      expect(layout.schema.measures.length).toBeGreaterThanOrEqual(today.schema.measures.length);
      // Every code today holds, with the same title; the structure may hold more.
      for (const [dim, codes] of Object.entries(today.codeLists)) {
        const byCode = new Map(layout.codeLists[dim]!.map((c) => [c.code, c]));
        for (const c of codes) {
          expect(byCode.get(c.code)?.title, `${dim} ${c.code}`).toBe(c.title);
          if (dim === 'time') expect(byCode.get(c.code)?.status, c.code).toBe(c.status);
        }
      }
      // The update date reads in the same format and is never older than the capture today's rows came from.
      expect(Date.parse(layout.schema.modified!)).toBeGreaterThanOrEqual(Date.parse(today.schema.modified!));
    });
  }
});

describe('geo levels (the LEVEL annotation) and the licence rule on top', () => {
  it('reads country, aggregate and the not-licensed codes of une_rt_q', () => {
    const fit = fitEurostatStructure('eurostat:une_rt_q', structureOf('une_rt_q'));
    if (!fit.ok) throw new Error(fit.summary);
    expect(fit.geo.map((g) => [g.dimension, g.mark])).toEqual([['geo', 'geo_code_list']]);
    const geo = fit.geo[0]!;
    expect(geo.levels).toMatchObject({ NL: 'country', DE: 'country', BA: 'country', TR: 'country', EU27_2020: 'aggregate', EA21: 'aggregate' });
    expect(geo.licensed).toContain('NL');
    expect(geo.licensed).toContain('EU27_2020');
    // Candidate countries are countries by level, but outside the EU/EFTA licence scope.
    expect(geo.excluded).toContainEqual({ code: 'BA', why: 'not_licensed' });
    expect(geo.excluded).toContainEqual({ code: 'TR', why: 'not_licensed' });
    // A real finding: the euro area's 2026 composition is not (yet) a reviewed aggregate.
    expect(geo.excluded).toContainEqual({ code: 'EA21', why: 'not_licensed' });
  });

  it('every geo code of the four datasets carries a level Eurostat stated', () => {
    for (const { code } of TODAY) {
      const geo = structureOf(code).dimensions.find((d) => d.name === 'geo')!;
      for (const c of geo.codes) expect(geoLevelOf(c), `${code} ${c.code}`).not.toBeNull();
    }
  });

  it('the licence halves are exactly the stand-in list, which is unchanged', () => {
    // The list as it stood before the split (session 107 onwards), pinned so the licence scope cannot drift.
    const before = [
      'BE', 'BG', 'CZ', 'DK', 'DE', 'EE', 'IE', 'EL', 'ES', 'FR', 'HR', 'IT', 'CY', 'LV', 'LT', 'LU', 'HU', 'MT',
      'NL', 'AT', 'PL', 'PT', 'RO', 'SI', 'SK', 'FI', 'SE', 'IS', 'LI', 'NO', 'CH', 'EU27_2020', 'EA', 'EA19', 'EA20', 'EFTA',
    ];
    expect([...EU_EFTA_STAND_IN_GEO_CODES]).toEqual(before);
    expect(EU_EFTA_LICENSED_COUNTRY_CODES.size).toBe(31);
    expect([...EU_EFTA_LICENSED_AGGREGATE_CODES].sort()).toEqual(['EA', 'EA19', 'EA20', 'EFTA', 'EU27_2020']);
  });

  it('never guesses: no level, or a level that disagrees with the licence list, excludes the code', () => {
    expect(licensedGeo('NL', null)).toEqual({ ok: false, why: 'no_level' });
    expect(licensedGeo('NL', 'aggregate')).toEqual({ ok: false, why: 'level_disagrees' });
    expect(licensedGeo('EU27_2020', 'country')).toEqual({ ok: false, why: 'level_disagrees' });
    expect(licensedGeo('NL11', 'nuts2')).toEqual({ ok: false, why: 'not_licensed' });
    expect(licensedGeo('NL', 'country')).toEqual({ ok: true });
    expect(geoLevelOf({ code: 'X', label: 'X', levelAnnotation: '9' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Refusals (today's rules) and fail-closed structure
// ---------------------------------------------------------------------------

describe('refusals: a dataset that does not fit is refused, never mapped by guesswork', () => {
  const base = () => structureOf('une_rt_q');
  const withDims = (s: EurostatStructure, dims: EurostatStructure['dimensions']): EurostatStructure => ({ ...s, dimensions: dims });

  it('no unit dimension', () => {
    const s = base();
    const r = fitEurostatStructure('eurostat:une_rt_q', withDims(s, s.dimensions.filter((d) => d.name !== 'unit')));
    expect(r).toMatchObject({ ok: false, reason: 'no_unit_dimension' });
  });

  it('no time dimension', () => {
    const s = base();
    const r = fitEurostatStructure('eurostat:une_rt_q', withDims(s, s.dimensions.filter((d) => d.name !== 'time')));
    expect(r).toMatchObject({ ok: false, reason: 'no_time_dimension' });
  });

  it('a semester, weekly or daily grain (by frequency or by period spelling)', () => {
    const s = base();
    const semesterFreq = s.dimensions.map((d) =>
      d.name === 'freq' ? { ...d, codes: [{ code: 'S', label: 'Semi-annual', levelAnnotation: null }] } : d,
    );
    expect(fitEurostatStructure('x', withDims(s, semesterFreq))).toMatchObject({ ok: false, reason: 'unsupported_grain' });
    for (const period of ['2024-S1', '2024-W01', '2024-01-15', '2024Q1']) {
      const dims = s.dimensions.map((d) => (d.name === 'time' ? { ...d, codes: [{ code: period, label: period, levelAnnotation: null }] } : d));
      const noSpan = { ...withDims(s, dims), annotations: { ...s.annotations, oldestPeriod: null, latestPeriod: null } };
      expect(fitEurostatStructure('x', noSpan), period).toMatchObject({ ok: false, reason: 'unsupported_grain' });
    }
  });

  it('a time list that disagrees with Eurostat’s own stated span (A1)', () => {
    const s = base();
    expect(fitEurostatStructure('x', { ...s, annotations: { ...s.annotations, latestPeriod: '2026-Q3' } })).toMatchObject({
      ok: false,
      reason: 'time_span_mismatch',
    });
    expect(fitEurostatStructure('x', { ...s, annotations: { ...s.annotations, latestPeriod: '2026-Q1' } })).toMatchObject({
      ok: false,
      reason: 'time_span_mismatch',
    });
  });

  it('no update date', () => {
    const s = base();
    expect(fitEurostatStructure('x', { ...s, annotations: { ...s.annotations, updateData: null } })).toMatchObject({
      ok: false,
      reason: 'no_update_date',
    });
  });

  it('no licensed geo code', () => {
    const s = base();
    const dims = s.dimensions.map((d) => (d.name === 'geo' ? { ...d, codes: d.codes.filter((c) => ['BA', 'TR', 'EA21'].includes(c.code)) } : d));
    expect(fitEurostatStructure('x', withDims(s, dims))).toMatchObject({ ok: false, reason: 'no_licensed_geo' });
  });

  it('a unit whose decimals nobody knows', () => {
    const r = eurostatLayoutFromStructure('eurostat:une_rt_q', base(), (u) => (u === 'PC_ACT' ? 1 : undefined));
    expect(r).toMatchObject({ ok: false, reason: 'decimals_unknown' });
  });
});

describe('malformed or unknown structure fails closed', () => {
  const { dataflow, constraint } = xmlOf('une_rt_q');
  const read = (df: string, cc: string, code = 'une_rt_q') => () => readEurostatStructure(code, df, cc);

  const cases: [string, () => unknown][] = [
    ['a truncated dataflow', read(dataflow.slice(0, dataflow.length / 2), constraint)],
    ['a DOCTYPE in the constraint', read(dataflow, constraint.replace('<m:Structure', '<!DOCTYPE x><m:Structure'))],
    ['the structure of another dataset', read(dataflow, constraint, 'une_rt_m')],
    ['a constraint value with no code in the code list', read(dataflow, constraint.replace('<c:Value>NL</c:Value>', '<c:Value>NL</c:Value><c:Value>XX</c:Value>'))],
    ['a dimension the constraint says nothing about', read(dataflow, constraint.replace(/<c:KeyValue id="sex">[\s\S]*?<\/c:KeyValue>/, ''))],
    ['a constraint dimension the structure lacks', read(dataflow, constraint.replace('<c:KeyValue id="sex">', '<c:KeyValue id="nace_r2"><c:Value>A</c:Value></c:KeyValue><c:KeyValue id="sex">'))],
    ['an excluding cube region', read(dataflow, constraint.replace('<s:CubeRegion include="true">', '<s:CubeRegion include="false">'))],
    ['a time range instead of listed periods', read(dataflow, constraint.replace(/<c:KeyValue id="TIME_PERIOD">[\s\S]*?<\/c:KeyValue>/, '<c:KeyValue id="TIME_PERIOD"><c:TimeRange/></c:KeyValue>'))],
    ['a constraint that is not of type Actual', read(dataflow, constraint.replace('type="Actual"', 'type="Allowed"'))],
    ['an unknown message namespace', read(dataflow.replace('schemas/v2_1/message"', 'schemas/v3_0/message"'), constraint)],
    ['a code list the dimension points to but the message lacks', read(dataflow.replace('id="GEO" isFinal', 'id="GEO_OTHER" isFinal'), constraint)],
    ['two dataflows', read(dataflow.replace('</s:Dataflows>', dataflow.match(/<s:Dataflow [\s\S]*?<\/s:Dataflow>/)![0] + '</s:Dataflows>'), constraint)],
    ['conflicting OBS_PERIOD_OVERALL_LATEST annotations', read(dataflow.replace('<c:AnnotationTitle>2026-Q2</c:AnnotationTitle>', '<c:AnnotationTitle>2026-Q2</c:AnnotationTitle><c:AnnotationType>OBS_PERIOD_OVERALL_LATEST</c:AnnotationType></c:Annotation><c:Annotation><c:AnnotationTitle>2026-Q1</c:AnnotationTitle>'), constraint)],
  ];
  for (const [what, run] of cases) {
    it(`refuses ${what}`, () => {
      expect(run).toThrow(/Eurostat|XML parse error/);
      try {
        run();
      } catch (err) {
        expect(err instanceof EurostatStructureError || err instanceof XmlParseError, String(err)).toBe(true);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// The adapter's structure-layout mode, and registerSchemaOnly on it
// ---------------------------------------------------------------------------

/** A fetch stub that serves the captured structure messages and records every URL; anything else is a 404. */
function structureFetch(requested: string[]): typeof fetch {
  const byUrl = new Map<string, string>();
  for (const { code } of TODAY) {
    const urls = structureUrls(code);
    const xml = xmlOf(code);
    byUrl.set(urls.dataflow, xml.dataflow);
    byUrl.set(urls.constraint, xml.constraint);
  }
  return (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    const body = byUrl.get(url);
    return body === undefined ? new Response('not found', { status: 404, statusText: 'Not Found' }) : new Response(body, { status: 200 });
  }) as typeof fetch;
}

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()!();
});

describe('StatisticsApiSource structure-layout mode', () => {
  it('builds the two structure URLs and refuses a code that is not a main-server dataset code', () => {
    expect(structureUrls('une_rt_q')).toEqual({
      dataflow: 'https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/dataflow/ESTAT/UNE_RT_Q/1.0?references=descendants&detail=referencepartial',
      constraint: 'https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/contentconstraint/ESTAT/UNE_RT_Q/1.0',
    });
    expect(() => structureUrls('DS-045409')).toThrow(/main-server/);
    expect(() => structureUrls('x/../y')).toThrow(/main-server/);
  });

  it('reads schema and code lists from two structure requests, never an observation download', async () => {
    const requested: string[] = [];
    const source = new StatisticsApiSource(structureFetch(requested), { structureLayout: { decimals: () => 1 }, retryBackoffMs: 0 });
    const schema = await source.fetchTableSchema('eurostat:namq_10_gdp');
    const geo = await source.fetchCodeList('eurostat:namq_10_gdp', 'geo');
    await source.fetchCodeList('eurostat:namq_10_gdp', 'na_item');
    expect(schema.measures).toHaveLength(34);
    expect(geo.map((c) => c.code)).toContain('NL');
    expect(geo.map((c) => c.code)).not.toContain('TR');
    expect(requested).toEqual(Object.values(structureUrls('namq_10_gdp')));
    expect(requested.some((u) => u.includes('/statistics/1.0/data/'))).toBe(false);
  });

  it('refuses loudly (typed) when a unit’s decimals are unknown', async () => {
    const source = new StatisticsApiSource(structureFetch([]), { structureLayout: { decimals: () => undefined }, retryBackoffMs: 0 });
    await expect(source.fetchTableSchema('eurostat:une_rt_q')).rejects.toBeInstanceOf(EurostatLayoutRefusalError);
  });

  it('without the option, the download path is unchanged (the structure is never requested)', async () => {
    const requested: string[] = [];
    const source = new StatisticsApiSource(structureFetch(requested), { retryBackoffMs: 0 });
    await expect(source.fetchTableSchema('eurostat:tipsbd30')).rejects.toThrow();
    expect(requested.every((u) => u.includes('/statistics/1.0/data/'))).toBe(true);
  });

  it('registerSchemaOnly registers a Eurostat id from its structure alone', async () => {
    const { db, close } = await createTestDb();
    closers.push(close);
    // tipsbd30's one unit: decimals as the whole-table download observed them (the only honest source today).
    const today = parseJsonStatDataset(json('../fixtures/eurostat/tipsbd30/dataset.json'), 'eurostat:tipsbd30');
    const known = new Map(today.schema.measures.map((m) => [m.code, m.decimals]));
    const requested: string[] = [];
    const source = new StatisticsApiSource(structureFetch(requested), {
      structureLayout: { decimals: (tableId, unit) => known.get(`${tableId.slice('eurostat:'.length)}|${unit}`) },
      retryBackoffMs: 0,
    });

    const result = await registerSchemaOnly(db, source, 'eurostat:tipsbd30');
    expect(result).toEqual({ ok: true, tableId: 'eurostat:tipsbd30', numericMeasures: ['tipsbd30|PC_RWA'], alreadyRegistered: false });
    expect(requested.some((u) => u.includes('/statistics/1.0/data/'))).toBe(false);

    const row = (
      await db.query('select ingest_mode, source, pinned, units, schema_cbs_modified from cbs_tables where id = $1', ['eurostat:tipsbd30'])
    ).rows[0]!;
    expect(row.ingest_mode).toBe('slice_cache');
    expect(row.source).toBe('eurostat');
    const units = typeof row.units === 'string' ? JSON.parse(row.units) : row.units;
    expect(units['tipsbd30|PC_RWA']).toMatchObject({ unit: today.schema.measures[0]!.unit, decimals: today.schema.measures[0]!.decimals });
    const geo = await db.query(`select code from dimension_labels where table_id = $1 and dimension = 'geo' order by code`, ['eurostat:tipsbd30']);
    const geoCodes = geo.rows.map((r) => r.code as string);
    expect(geoCodes).toContain('NL');
    expect(geoCodes).not.toContain('EU'); // the pre-2020 EU aggregate is not a reviewed licensed aggregate
    for (const code of today.codeLists.geo!.map((c) => c.code)) expect(geoCodes).toContain(code);
    const periods = await db.query(`select count(*)::int as n from dimension_labels where table_id = $1 and dimension = 'time'`, ['eurostat:tipsbd30']);
    expect(periods.rows[0]!.n).toBe(19);
  });
});
