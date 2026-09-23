// E2a step-5 fix round 1 (independent top-tier review finding #1): a REAL
// Eurostat table's registered dimension set always includes `freq`
// (research doc excerpts, e.g. une_rt_q's own
// `"id":["freq","s_adj","age","unit","sex","geo","time"]`) — the adapter
// classifies it a plain `Dimension` (src/eurostat-adapter/jsonstat.ts's
// `coordinateDimNames`/dimension-kind mapping) exactly like `s_adj`/`age`/
// `sex`. There is no `TABLE_REGISTRY_DEFAULTS` entry for a Eurostat sibling
// table (that list is CBS-only), so `cbs_tables.default_coordinates` stays
// NULL for it forever — the ONLY place `freq` can get a pinned coordinate is
// the `CanonicalMeasure.dims` in `EUROSTAT_SIBLING_MEASURES_REVIEWED`. Before
// this fix, `freq` was missing there, so `src/query/resolve.ts`'s "dimension(s)
// freq carry no coordinate" refusal would fire for every one of the three
// sibling measures — SILENTLY, in production, right after step 6's flip.
//
// This is the full round trip, not a unit test of one function: a realistic
// JSON-stat fixture (freq + the exact real dimension set from the research
// doc) is registered + synced through the SAME adapter/pipeline a real
// registration uses (StatisticsApiSource + registerTables/syncTable, PGlite),
// then `applyRegistryDefaults` upserts its measure, then — with
// EUROSTAT_SIBLINGS_ENABLED stubbed '1' — `resolveCandidate` for "werkloosheid"
// + Duitsland must return `other_source_available`, and its offered intent
// must actually run through `runQuery` to a real value from the Eurostat
// table, not a refusal.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { resolveCandidate, isResolutionFailure } from '../../src/answer/intent/index.ts';
import type { PeriodSpec, RawCandidate } from '../../src/answer/intent/index.ts';
import { runQuery } from '../../src/query/index.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { registerTables, syncTable } from '../../src/ingestion/pipeline.ts';
import { StatisticsApiSource } from '../../src/eurostat-adapter/statistics-api.ts';
import { applyRegistryDefaults } from '../../src/registry/apply.ts';
import { EUROSTAT_SIBLING_REGISTRATIONS } from '../../src/sources/eurostat-siblings.ts';
import type { Db } from '../../src/db/types.ts';

const UNEMPLOYMENT_KEY = 'unemployment_rate_seasonally_adjusted';
const REVIEWED_SIBLING_KEY = 'eu_unemployment_rate_harmonised';
const TABLE_ID = 'eurostat:une_rt_q';

/** Real dimension set (research doc, une_rt_q), freq INCLUDED — the exact
 * shape a live registration would receive after the server-side-filter fix:
 * one geo (DE), one period, every semantic dimension pinned to a single
 * category, matching EUROSTAT_SIBLING_REGISTRATIONS's own slice. */
const REALISTIC_UNE_RT_Q = {
  version: '2.0',
  class: 'dataset',
  label: 'Unemployment by sex and age - quarterly data',
  id: ['freq', 's_adj', 'age', 'sex', 'unit', 'geo', 'time'],
  size: [1, 1, 1, 1, 1, 1, 1],
  dimension: {
    freq: { category: { index: { Q: 0 }, label: { Q: 'Quarterly' } } },
    s_adj: { category: { index: { SA: 0 }, label: { SA: 'Seasonally adjusted data' } } },
    age: { category: { index: { 'Y15-74': 0 }, label: { 'Y15-74': 'From 15 to 74 years' } } },
    sex: { category: { index: { T: 0 }, label: { T: 'Total' } } },
    unit: { category: { index: { PC_ACT: 0 }, label: { PC_ACT: 'Percentage of population in the labour force' } } },
    geo: { category: { index: { DE: 0 }, label: { DE: 'Germany' } } },
    time: { category: { index: { '2021-Q1': 0 }, label: { '2021-Q1': '2021-Q1' } } },
  },
  value: [5.1],
};

async function fakeDataciteFetch(): Promise<Response> {
  return new Response(JSON.stringify({ data: { attributes: { state: 'findable' } } }), {
    status: 200,
    headers: { 'content-type': 'application/vnd.api+json' },
  });
}

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());

  const uneRtQ = EUROSTAT_SIBLING_REGISTRATIONS.find((r) => r.tableId === TABLE_ID)!;
  const fetchFn = async () =>
    new Response(JSON.stringify(REALISTIC_UNE_RT_Q), { status: 200, headers: { 'content-type': 'application/json' } });
  const source = new StatisticsApiSource(fetchFn as unknown as typeof fetch);
  await registerTables(
    db,
    source,
    [{ id: uneRtQ.tableId, updateCadence: uneRtQ.updateCadence, servesTasks: [], slice: uneRtQ.slice }],
    { fetchImpl: fakeDataciteFetch },
  );
  await syncTable(db, source, uneRtQ.tableId);

  // registry:apply again, now that the table exists — upserts the reviewed
  // sibling measure (eu_unemployment_rate_harmonised), CBS measures unchanged.
  const applied = await applyRegistryDefaults(db);
  if (!applied.canonicalMeasuresUpserted.includes(REVIEWED_SIBLING_KEY)) {
    throw new Error(`test setup: ${REVIEWED_SIBLING_KEY} was not upserted (siblingMeasuresSkipped: ${applied.siblingMeasuresSkipped.join(', ')})`);
  }
}, 300_000);

afterAll(async () => {
  await close();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const LATEST: PeriodSpec = { kind: 'latest' };

function candidate(): RawCandidate {
  return {
    canonicalKey: UNEMPLOYMENT_KEY,
    regions: [{ name: 'Duitsland', kind: 'onbekend' }],
    period: LATEST,
    derivation: 'none',
    confidence: 0.9,
    reading: 'test',
  };
}

describe('E2a step-5 fix round 1: freq round-trips end to end (real fixture -> registry -> resolver -> runQuery)', () => {
  it('with EUROSTAT_SIBLINGS_ENABLED=1: "werkloosheid in Duitsland" resolves via the Eurostat sibling and runQuery returns a REAL value', async () => {
    vi.stubEnv('EUROSTAT_SIBLINGS_ENABLED', '1');

    const failure = await resolveCandidate(db, candidate(), '2021-06-15');
    expect(isResolutionFailure(failure)).toBe(true);
    if (!isResolutionFailure(failure)) throw new Error('unreachable');
    // Before the freq fix, this failed as `invalid_intent` ("dimension(s)
    // freq carry no coordinate") instead — surfaced belowvia runQuery, not
    // here (resolveCandidate's own dry build does not run the real query).
    expect(failure.reason).toBe('other_source_available');
    expect(failure.optionIntents).toHaveLength(1);
    const offeredIntent = failure.optionIntents![0]!;
    expect(offeredIntent.target).toEqual({ kind: 'canonical', key: REVIEWED_SIBLING_KEY });
    expect(offeredIntent.regions).toEqual(['DE']);

    // The actual proof: run the offered intent through the SAME query layer
    // a real answer turn uses. Pre-fix, this is where "freq carry no
    // coordinate" actually surfaced (resolveIntent, not resolveCandidate).
    const result = await runQuery(db, offeredIntent);
    expect(result.ok, !result.ok ? result.refusal.message : '').toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.cells).toHaveLength(1);
    expect(result.cells[0]!.tableId).toBe(TABLE_ID);
    expect(result.cells[0]!.regionCode).toBe('DE');
    expect(result.cells[0]!.value).toBe(5.1);
  });
});
