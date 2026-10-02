// #357 (a) decimals and (d) licence gap — the two gaps that blocked registering any Eurostat dataset from its
// structure. Hermetic: REAL captured structure messages (tests/fixtures/eurostat-structure/, incl. the two
// geography examples captured 2026-10-01) and REAL captured answers to the first decimals read
// (tests/fixtures/eurostat-decimals/, refresh: `node scripts/capture-eurostat-fixtures.ts --decimals-probe <code>`);
// no network, no production database (PGlite).
//
// (d) The licence rule restricts EVERY dimension Eurostat marks as geography — the GEO code list or a list derived
//     from it — whatever the dimension is called; a dataset with no marked dimension, or an unmarked dimension that
//     names a marked place, is refused.
// (a) A unit's decimals come from one small bounded read at registration (the latest period); a value later
//     carrying MORE decimals than registered is refused at slice time and the table quarantined — never rounded.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { CbsObservationRow } from '../../src/cbs-adapter/types.ts';
import { parseJsonStatDataset } from '../../src/eurostat-adapter/jsonstat.ts';
import {
  DECIMALS_PROBE_MAX_CELLS,
  DECIMALS_PROBE_MAX_READS,
  decimalsProbeSlice,
  eurostatLayoutFromStructure,
  EurostatLayoutRefusalError,
  fitEurostatStructure,
  geographyMark,
  readEurostatStructure,
  type EurostatStructure,
} from '../../src/eurostat-adapter/sdmx-structure.ts';
import { buildRequestUrl, StatisticsApiSource, structureUrls } from '../../src/eurostat-adapter/statistics-api.ts';
import { decimalsOf } from '../../src/ingestion/decimals.ts';
import { fetchSlice, registerSchemaOnly } from '../../src/ingestion/slice-cache.ts';
import { checkObservedDecimals } from '../../src/ingestion/validate.ts';
import { SOURCES } from '../../src/sources/registry.ts';
import { EUROSTAT_SIBLING_REGISTRATIONS } from '../../src/sources/eurostat-siblings.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

const text = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
const json = (rel: string): unknown => JSON.parse(text(rel));

const REGISTERED = ['tipsbd30', 'une_rt_q', 'prc_hicp_minr', 'namq_10_gdp'];

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

function fitOf(code: string) {
  const fit = fitEurostatStructure(`eurostat:${code}`, structureOf(code));
  if (!fit.ok) throw new Error(fit.summary);
  return fit;
}

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()!();
});

// ---------------------------------------------------------------------------
// (d) Geography by Eurostat's own marks
// ---------------------------------------------------------------------------

describe('(d) geography-bearing dimensions come from Eurostat’s marks, never from a name', () => {
  it('the four registered datasets: only `geo` (the GEO code list) — COICOP18’s LEVEL annotation is not a place mark', () => {
    for (const code of REGISTERED) {
      const marked = structureOf(code).dimensions.filter((d) => geographyMark(d) !== null);
      expect(marked.map((d) => [d.name, geographyMark(d)]), code).toEqual([['geo', 'geo_code_list']]);
    }
    // prc_hicp_minr's classification carries LEVEL annotations too (depth 1–5, AGG): it is not geography.
    const coicop = structureOf('prc_hicp_minr').dimensions.find((d) => d.name === 'coicop18')!;
    expect(coicop.codes.some((c) => c.levelAnnotation !== null)).toBe(true);
    expect(geographyMark(coicop)).toBeNull();
  });

  it('a dataset with no marked dimension is refused: rep_mar holds countries in a list Eurostat does not mark', () => {
    const s = structureOf('mar_mg_aa_cwhd');
    const repMar = s.dimensions.find((d) => d.name === 'rep_mar')!;
    // It IS geography (Belgium, Bulgaria, EU aggregates) — just unmarked: no GEO list, no MASTER, no LEVEL.
    expect(repMar.codelist).toEqual({ id: 'REP_MAR', master: null });
    expect(repMar.codes.map((c) => c.code)).toEqual(expect.arrayContaining(['BE', 'NL', 'EU27_2020']));
    expect(repMar.codes.every((c) => c.levelAnnotation === null)).toBe(true);
    expect(fitEurostatStructure('eurostat:mar_mg_aa_cwhd', s)).toMatchObject({ ok: false, reason: 'no_identified_geography' });
    expect(eurostatLayoutFromStructure('eurostat:mar_mg_aa_cwhd', s, () => 0)).toMatchObject({
      ok: false,
      reason: 'no_identified_geography',
    });
  });

  it('a list DERIVED from GEO is restricted like `geo` itself: citizen in migr_asyappctza', () => {
    const s = structureOf('migr_asyappctza');
    const citizen = s.dimensions.find((d) => d.name === 'citizen')!;
    expect(citizen.codelist).toEqual({ id: 'CITIZEN', master: 'geo' });
    const fit = fitOf('migr_asyappctza');
    expect(fit.geo.map((g) => [g.dimension, g.mark])).toEqual([
      ['citizen', 'derived_from_geo'],
      ['geo', 'geo_code_list'],
    ]);
    const layout = eurostatLayoutFromStructure('eurostat:migr_asyappctza', s, () => 0);
    if (!layout.ok) throw new Error(layout.summary);
    const kept = layout.codeLists.citizen!.map((c) => c.code);
    expect(kept).toContain('NL');
    // #365: the all-citizenships total is the reporting country's own count — kept.
    expect(kept).toContain('TOTAL');
    for (const outside of ['SY', 'AF', 'UA', 'UNK', 'EXT_EU27_2020']) {
      expect(citizen.codes.some((c) => c.code === outside), outside).toBe(true);
      expect(kept, outside).not.toContain(outside);
    }
    expect(kept.length).toBe(fit.geo[0]!.licensed.length);
    // Kind is unchanged: only a dimension named `geo` is the waist's one GeoDimension.
    expect(layout.schema.dimensions.find((d) => d.name === 'citizen')!.kind).toBe('Dimension');
  });

  it('the name does not matter: the GEO list under another name is still restricted', () => {
    const s = structureOf('une_rt_q');
    const renamed = { ...s, dimensions: s.dimensions.map((d) => (d.name === 'geo' ? { ...d, name: 'reporter' } : d)) };
    const layout = eurostatLayoutFromStructure('eurostat:une_rt_q', renamed, () => 1);
    if (!layout.ok) throw new Error(layout.summary);
    const kept = layout.codeLists.reporter!.map((c) => c.code);
    expect(kept).toContain('NL');
    expect(kept).not.toContain('TR');
    expect(kept).not.toContain('EA21');
  });

  it('an unmarked dimension naming a marked place (same code, same English name) is refused', () => {
    const s = structureOf('une_rt_q');
    const nl = s.dimensions.find((d) => d.name === 'geo')!.codes.find((c) => c.code === 'NL')!;
    const partner = {
      name: 'partner',
      position: 99,
      isTime: false,
      label: 'Partner',
      codes: [{ code: 'NL', label: nl.label, levelAnnotation: null }, { code: 'WORLD', label: 'World', levelAnnotation: null }],
      codelist: { id: 'PARTNER', master: null },
    };
    const withPartner = { ...s, dimensions: [...s.dimensions, partner] };
    expect(fitEurostatStructure('x', withPartner)).toMatchObject({ ok: false, reason: 'unmarked_geography' });
    // The same code with another meaning is not a place: s_adj 'SA' is not Saudi Arabia.
    const otherMeaning = { ...partner, codes: [{ code: 'NL', label: 'Not listed', levelAnnotation: null }] };
    expect(fitEurostatStructure('x', { ...s, dimensions: [...s.dimensions, otherMeaning] }).ok).toBe(true);
  });

  it('every marked dimension needs a licensed code', () => {
    const s = structureOf('migr_asyappctza');
    const dims = s.dimensions.map((d) =>
      d.name === 'citizen' ? { ...d, codes: d.codes.filter((c) => ['SY', 'AF'].includes(c.code)) } : d,
    );
    expect(fitEurostatStructure('x', { ...s, dimensions: dims })).toMatchObject({ ok: false, reason: 'no_licensed_geo' });
  });

  it('#365: TOTAL is kept only in a list derived from GEO, never in the reporting geo list', () => {
    const s = structureOf('migr_asyappctza');
    const geo = s.dimensions.find((d) => d.name === 'geo')!;
    const total = s.dimensions.find((d) => d.name === 'citizen')!.codes.find((c) => c.code === 'TOTAL')!;
    const dims = s.dimensions.map((d) => (d.name === 'geo' ? { ...geo, codes: [...geo.codes, total] } : d));
    const layout = eurostatLayoutFromStructure('eurostat:migr_asyappctza', { ...s, dimensions: dims }, () => 0);
    if (!layout.ok) throw new Error(layout.summary);
    expect(layout.codeLists.geo!.map((c) => c.code)).not.toContain('TOTAL');
    expect(layout.codeLists.citizen!.map((c) => c.code)).toContain('TOTAL');
  });
});

// ---------------------------------------------------------------------------
// (a) Decimals: the bounded read at registration
// ---------------------------------------------------------------------------

describe('(a) the decimals read is small and bounded', () => {
  it('every fitting captured dataset: all units, the latest period, licensed geography only, at most 2,000 cells', () => {
    for (const code of [...REGISTERED, 'migr_asyappctza']) {
      const s = structureOf(code);
      const fit = fitOf(code);
      const probe = decimalsProbeSlice(`eurostat:${code}`, s, fit, fit.unitCodes, 1)!;
      expect(probe.cells, code).toBeLessThanOrEqual(DECIMALS_PROBE_MAX_CELLS);
      expect(probe.slice.measures, code).toEqual(fit.unitCodes.map((u) => `${code}|${u}`));
      const latest = [...fit.periods.values()].sort().at(-1);
      expect(probe.slice.periodIn, code).toEqual({ dimension: 'time', codes: [latest] });
      for (const g of fit.geo) {
        const listed = probe.slice.dimensionIn![g.dimension]!;
        expect(listed.length, `${code} ${g.dimension}`).toBeGreaterThan(0);
        for (const c of listed) expect(g.licensed, `${code} ${g.dimension} ${c}`).toContain(c);
      }
      // The request goes through the adapter's own URL builder (the slice request path) and its checks.
      expect(buildRequestUrl(code, probe.slice)).toContain(`sinceTimePeriod=`);
    }
  });

  it('a later read covers more periods for fewer units, still inside the bound; none exists when the units alone exceed it', () => {
    const s = structureOf('namq_10_gdp');
    const fit = fitOf('namq_10_gdp');
    const three = decimalsProbeSlice('eurostat:namq_10_gdp', s, fit, fit.unitCodes.slice(0, 2), 3)!;
    expect(three.slice.periodIn!.codes).toHaveLength(3);
    expect(three.cells).toBeLessThanOrEqual(DECIMALS_PROBE_MAX_CELLS);
    const many = Array.from({ length: DECIMALS_PROBE_MAX_CELLS + 1 }, (_, i) => `U${i}`);
    expect(decimalsProbeSlice('eurostat:namq_10_gdp', s, fit, many, 1)).toBeNull();
  });
});

/** Serves the captured structure messages, and the given answer for any data request; records every URL. */
function fakeEurostat(code: string, answer: (url: string, n: number) => unknown, requested: string[]): typeof fetch {
  const urls = structureUrls(code);
  const xml = xmlOf(code);
  let dataRequests = 0;
  return (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    if (url === urls.dataflow) return new Response(xml.dataflow, { status: 200 });
    if (url === urls.constraint) return new Response(xml.constraint, { status: 200 });
    if (url.includes(`/statistics/1.0/data/${code}?`)) {
      dataRequests++;
      return new Response(JSON.stringify(answer(url, dataRequests)), { status: 200 });
    }
    return new Response('not found', { status: 404, statusText: 'Not Found' });
  }) as typeof fetch;
}

const probeAnswer = (code: string) => json(`../fixtures/eurostat-decimals/${code}.json`) as Record<string, unknown>;
const NO_RESULTS = { error: [{ status: 200, id: 100, label: 'No data found for the selection' }] };

describe('(a) observed decimals, end to end on real answers', () => {
  it('une_rt_q: one read of the latest two quarters settles all three units; the registered unit matches today', async () => {
    const requested: string[] = [];
    const source = new StatisticsApiSource(fakeEurostat('une_rt_q', () => probeAnswer('une_rt_q'), requested), { retryBackoffMs: 0 });
    const observed = await source.observeUnitDecimals('eurostat:une_rt_q');
    expect(Object.fromEntries(observed.decimals)).toEqual({ THS_PER: 0, PC_POP: 1, PC_ACT: 1 });
    expect(observed.reads).toHaveLength(1);
    expect(observed.reads[0]!.periods).toEqual(['2026KW01', '2026KW02']);
    expect(observed.reads[0]!.cells).toBeLessThanOrEqual(DECIMALS_PROBE_MAX_CELLS);
    // The captured fixture IS the answer to exactly this URL (the capture script builds it the same way).
    const index = json('../fixtures/eurostat-decimals/une_rt_q.index.json') as { source: string };
    expect(observed.reads[0]!.url).toBe(index.source);
    expect(requested.filter((u) => u.includes('/statistics/'))).toEqual([index.source]);

    // Today's registration of une_rt_q (the reviewed scope, the whole download) holds PC_ACT with 1 decimal.
    const sibling = EUROSTAT_SIBLING_REGISTRATIONS.find((r) => r.tableId === 'eurostat:une_rt_q')!;
    const today = parseJsonStatDataset(json('../fixtures/eurostat-siblings/une_rt_q.json'), sibling.tableId, sibling.slice);
    expect(today.schema.measures.map((m) => [m.code, m.decimals])).toEqual([['une_rt_q|PC_ACT', observed.decimals.get('PC_ACT')]]);
  });

  it('a unit the latest period does not settle is read again over more periods; "no results" counts as nothing seen', async () => {
    const requested: string[] = [];
    const answer = (_url: string, n: number) => (n === 1 ? NO_RESULTS : probeAnswer('une_rt_q'));
    const source = new StatisticsApiSource(fakeEurostat('une_rt_q', answer, requested), { retryBackoffMs: 0 });
    const observed = await source.observeUnitDecimals('eurostat:une_rt_q');
    expect(observed.reads.map((r) => r.periods)).toEqual([['2026KW01', '2026KW02'], ['2025KW04', '2026KW01', '2026KW02']]);
    expect(Object.fromEntries(observed.decimals)).toEqual({ THS_PER: 0, PC_POP: 1, PC_ACT: 1 });
  });

  it('a few whole numbers do not settle a unit (trailing zeros); a unit no read saw is refused, never guessed', async () => {
    // Both reads answer with PC_POP holding only three values, all whole; PC_ACT and THS_PER hold none.
    const thin = structuredClone(probeAnswer('une_rt_q')) as {
      id: string[];
      size: number[];
      dimension: Record<string, { category: { index: Record<string, number> } }>;
      value: Record<string, number>;
    };
    const unitPos = thin.id.indexOf('unit');
    const stride = thin.size.slice(unitPos + 1).reduce((a, b) => a * b, 1);
    const popIndex = thin.dimension.unit!.category.index.PC_POP!;
    const kept: Record<string, number> = {};
    for (const [offset, v] of Object.entries(thin.value)) {
      if (Math.floor(Number(offset) / stride) % thin.size[unitPos]! === popIndex && Object.keys(kept).length < 3) {
        kept[offset] = Math.round(v);
      }
    }
    thin.value = kept;
    const requested: string[] = [];
    const source = new StatisticsApiSource(fakeEurostat('une_rt_q', () => thin, requested), {
      structureLayout: { decimals: 'observed' },
      retryBackoffMs: 0,
    });
    const observed = await source.observeUnitDecimals('eurostat:une_rt_q');
    expect(observed.reads).toHaveLength(DECIMALS_PROBE_MAX_READS);
    expect(Object.fromEntries(observed.decimals)).toEqual({ PC_POP: 0 });
    const refused = await source.fetchTableSchema('eurostat:une_rt_q').catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(EurostatLayoutRefusalError);
    expect((refused as EurostatLayoutRefusalError).reason).toBe('decimals_unknown');
  });

  it('a rounded newest period does not set the decimals: the period before it is read in the same request (nrg_ind_ren, session 153)', async () => {
    // Eurostat's real pattern: Sweden 2025 = 65.4 (an estimate), 2023 = 66.393. Here one PC_ACT value in the
    // OLDER quarter of the first read carries 3 decimals; the newer quarter keeps its 1-decimal values.
    const precise = structuredClone(probeAnswer('une_rt_q')) as {
      id: string[];
      size: number[];
      dimension: Record<string, { category: { index: Record<string, number> } }>;
      value: Record<string, number>;
    };
    const strides = precise.size.map((_, i) => precise.size.slice(i + 1).reduce((a, b) => a * b, 1));
    const coord = (offset: number, dim: string) => {
      const i = precise.id.indexOf(dim);
      return Math.floor(offset / strides[i]!) % precise.size[i]!;
    };
    const older = precise.dimension.time!.category.index['2026-Q1']!;
    const act = precise.dimension.unit!.category.index.PC_ACT!;
    const offset = Object.keys(precise.value).map(Number).find((o) => coord(o, 'time') === older && coord(o, 'unit') === act)!;
    precise.value[String(offset)] = 6.123;
    const requested: string[] = [];
    const source = new StatisticsApiSource(fakeEurostat('une_rt_q', () => precise, requested), { retryBackoffMs: 0 });
    const observed = await source.observeUnitDecimals('eurostat:une_rt_q');
    expect(observed.reads).toHaveLength(1);
    expect(observed.decimals.get('PC_ACT')).toBe(3);
  });

  it('a dataset whose geography cannot be identified is refused before any data is read', async () => {
    const requested: string[] = [];
    const source = new StatisticsApiSource(fakeEurostat('mar_mg_aa_cwhd', () => NO_RESULTS, requested), {
      structureLayout: { decimals: 'observed' },
      retryBackoffMs: 0,
    });
    const refused = await source.fetchTableSchema('eurostat:mar_mg_aa_cwhd').catch((e: unknown) => e);
    expect((refused as EurostatLayoutRefusalError).reason).toBe('no_identified_geography');
    expect(requested.some((u) => u.includes('/statistics/'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (a) Registration records the observed decimals; slice time refuses more
// ---------------------------------------------------------------------------

describe('(a) registered from observation, checked at slice time', () => {
  /** One BE / seasonally adjusted / 15-74 / total cell of the captured latest quarter, for PC_ACT. */
  const request = {
    measures: ['une_rt_q|PC_ACT'],
    members: { freq: ['Q'], s_adj: ['SA'], age: ['Y15-74'], sex: ['T'], geo: ['BE'] },
    periods: ['2026KW02'],
  };

  /** The captured answer with that one cell's value replaced. */
  function answerWith(value: number): unknown {
    const doc = structuredClone(probeAnswer('une_rt_q')) as {
      id: string[];
      size: number[];
      dimension: Record<string, { category: { index: Record<string, number> } }>;
      value: Record<string, number>;
    };
    const at: Record<string, string> = { freq: 'Q', s_adj: 'SA', age: 'Y15-74', unit: 'PC_ACT', sex: 'T', geo: 'BE', time: '2026-Q2' };
    let offset = 0;
    for (let i = 0; i < doc.id.length; i++) offset = offset * doc.size[i]! + doc.dimension[doc.id[i]!]!.category.index[at[doc.id[i]!]!]!;
    expect(doc.value[String(offset)]).toBeTypeOf('number');
    doc.value[String(offset)] = value;
    return doc;
  }

  async function registered() {
    const { db, close } = await createTestDb();
    closers.push(close);
    const requested: string[] = [];
    const registering = new StatisticsApiSource(fakeEurostat('une_rt_q', () => probeAnswer('une_rt_q'), requested), {
      structureLayout: { decimals: 'observed' },
      retryBackoffMs: 0,
    });
    const result = await registerSchemaOnly(db, registering, 'eurostat:une_rt_q');
    expect(result).toMatchObject({ ok: true, numericMeasures: ['une_rt_q|PC_ACT', 'une_rt_q|PC_POP', 'une_rt_q|THS_PER'] });
    // One bounded data read, no whole-dataset download.
    expect(requested.filter((u) => u.includes('/statistics/'))).toHaveLength(1);
    const row = (await db.query('select units from cbs_tables where id = $1', ['eurostat:une_rt_q'])).rows[0]!;
    const units = (typeof row.units === 'string' ? JSON.parse(row.units) : row.units) as Record<string, { decimals: number }>;
    return { db, units };
  }

  /** The slice-time source: the registered decimals, and the given answer to the slice request. */
  const sliceSource = (units: Record<string, { decimals: number }>, answer: unknown) =>
    new StatisticsApiSource(fakeEurostat('une_rt_q', () => answer, []), {
      structureLayout: { decimals: (tableId, unit) => units[`${tableId.slice('eurostat:'.length)}|${unit}`]?.decimals },
      retryBackoffMs: 0,
    });

  it('stores the observed decimals, then serves a value with as many or fewer decimals unchanged', async () => {
    const { db, units } = await registered();
    expect(Object.fromEntries(Object.entries(units).map(([k, u]) => [k, u.decimals]))).toEqual({
      'une_rt_q|PC_ACT': 1,
      'une_rt_q|PC_POP': 1,
      'une_rt_q|THS_PER': 0,
    });
    for (const value of [3.9, 4]) {
      const result = await fetchSlice(db, sliceSource(units, answerWith(value)), 'eurostat:une_rt_q', request);
      expect(result, JSON.stringify(result)).toMatchObject({ ok: true, rowsStored: 1 });
      const cell = (
        await db.query(`select value::text as value, decimals from observations where table_id = $1`, ['eurostat:une_rt_q'])
      ).rows[0]!;
      // Never rounded, never padded: the stored value is Eurostat's; the registered decimals only format it.
      expect(cell).toEqual({ value: String(value), decimals: 1 });
    }
  });

  it('a value with MORE decimals than registered quarantines the table and stores nothing', async () => {
    const { db, units } = await registered();
    const result = await fetchSlice(db, sliceSource(units, answerWith(3.95)), 'eurostat:une_rt_q', request);
    expect(result).toMatchObject({ ok: false, stage: 'unit_consistency', summary: expect.stringMatching(/3\.95 carries 2 decimals, registered with 1/) });
    const table = (await db.query('select status from cbs_tables where id = $1', ['eurostat:une_rt_q'])).rows[0]!;
    expect(table.status).toBe('needs_review');
    const stored = await db.query('select count(*)::int as n from observations where table_id = $1', ['eurostat:une_rt_q']);
    expect(stored.rows[0]!.n).toBe(0);
  });
});

describe('checkObservedDecimals (the slice-time rule) and where it applies', () => {
  const units = { 'x|U': { unit: 'u', decimals: 1, title: 't' } };
  const row = (value: number | null, measure = 'x|U'): CbsObservationRow => ({
    measure,
    coordinates: { geo: 'NL', time: '2026JJ00' },
    value,
    valueAttribute: 'None',
    stringValue: null,
  });

  it('passes as many or fewer decimals, a null value and an unregistered measure; refuses more', () => {
    expect(checkObservedDecimals([row(1.5), row(2), row(null), row(1.234, 'y|V')], units)).toEqual({ ok: true });
    expect(checkObservedDecimals([row(1.25), row(0.0000001)], units)).toMatchObject({
      ok: false,
      stage: 'unit_consistency',
      summary: expect.stringMatching(/^2 fetched value/),
    });
    expect(decimalsOf(0.0000001)).toBe(7);
  });

  it('applies to Eurostat (decimals observed) and not to CBS (decimals stated by CBS)', () => {
    expect(SOURCES.eurostat!.decimalsFromObservedValues).toBe(true);
    expect(SOURCES.cbs!.decimalsFromObservedValues).toBeUndefined();
  });
});
