// #357 step 3 ("Finding", ADR 048 addendum): Eurostat catalogue rows in the table finder, behind
// EUROSTAT_FINDER_ENABLED. Hermetic — the real Eurostat catalogue capture (7,569 datasets) next to the CBS
// catalogue fixture in an in-memory database, no model call, no network.
//   1. Flag off (the default): recall is exactly what it was without any Eurostat row in the mirror.
//   2. The flag is read at call time and only the exact value '1' opens it.
//   3. A frozen or unjudged Eurostat dataset is never current: not in the current quota, never walked.
//   4. The committed recall report (benchmark/eurostat-finder-recall-report.json) is what the code measures.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FixtureSource, loadCatalogFixture } from '../../src/cbs-adapter/fixture-source.ts';
import { candidateWalk, eurostatFinderEnabled, ingestCatalog, recallCandidates } from '../../src/catalog/index.ts';
import type { CatalogCandidate, FindTableOutcome } from '../../src/catalog/types.ts';
import type { Db } from '../../src/db/types.ts';
import { CBS_SOURCE_KEY } from '../../src/sources/registry.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import {
  buildFinderDb,
  loadCases,
  measure,
  REPORT_PATH,
  replicaRecall,
  summarize,
  type CaseResult,
  type GroupSummary,
} from '../../scripts/eurostat-finder-recall.ts';

const TABLEFINDER_SET = fileURLToPath(new URL('../../benchmark/tablefinder-labelled-set.json', import.meta.url));
const cases = loadCases();
const cbsTopics = [
  ...new Set([
    ...(JSON.parse(readFileSync(TABLEFINDER_SET, 'utf8')) as { cases: { topic: string }[] }).cases.map((c) => c.topic),
    ...cases.map((c) => c.topic),
  ]),
];

describe('Eurostat in the table finder (#357 step 3)', () => {
  let db: Db;
  let close: () => Promise<void>;
  let cbsOnly: Db;
  let closeCbsOnly: () => Promise<void>;
  const savedFlag = process.env.EUROSTAT_FINDER_ENABLED;

  beforeAll(async () => {
    ({ db, close } = await buildFinderDb());
    ({ db: cbsOnly, close: closeCbsOnly } = await createTestDb());
    await ingestCatalog(cbsOnly, new FixtureSource({}, loadCatalogFixture(fileURLToPath(new URL('../fixtures/cbs', import.meta.url)))), CBS_SOURCE_KEY);
  }, 120_000);
  afterAll(async () => {
    await close();
    await closeCbsOnly();
  });
  afterEach(() => {
    if (savedFlag === undefined) delete process.env.EUROSTAT_FINDER_ENABLED;
    else process.env.EUROSTAT_FINDER_ENABLED = savedFlag;
  });

  it('the Eurostat catalogue is in the mirror, with breadcrumbs and judged statuses', async () => {
    const { rows } = await db.query(
      `select count(*)::int as n,
              count(*) filter (where summary <> '')::int as with_crumb,
              count(*) filter (where status = 'current')::int as current
         from cbs_catalog where source = 'eurostat'`,
    );
    const r = rows[0] as { n: number; with_crumb: number; current: number };
    expect(r.n).toBe(7569);
    expect(r.with_crumb).toBe(7569);
    expect(r.current).toBe(3772);
  });

  it('flag off (default): every shortlist equals the one from a mirror with no Eurostat row at all', async () => {
    delete process.env.EUROSTAT_FINDER_ENABLED;
    for (const topic of cbsTopics) {
      const withEurostatRows = await recallCandidates(db, topic);
      expect(withEurostatRows, topic).toEqual(await recallCandidates(cbsOnly, topic));
      expect(withEurostatRows.some((c) => c.tableId.startsWith('eurostat:')), topic).toBe(false);
    }
  });

  it('the flag is read at call time; only the exact value 1 opens it', async () => {
    for (const value of ['0', 'true', 'yes', ' 1', '']) {
      process.env.EUROSTAT_FINDER_ENABLED = value;
      expect(eurostatFinderEnabled(), JSON.stringify(value)).toBe(false);
    }
    process.env.EUROSTAT_FINDER_ENABLED = '0';
    expect((await recallCandidates(db, 'GDP')).some((c) => c.tableId.startsWith('eurostat:'))).toBe(false);
    process.env.EUROSTAT_FINDER_ENABLED = '1';
    expect(eurostatFinderEnabled()).toBe(true);
    expect((await recallCandidates(db, 'GDP')).some((c) => c.tableId.startsWith('eurostat:'))).toBe(true);
    // An explicit per-call choice wins over the environment.
    expect((await recallCandidates(db, 'GDP', { includeEurostat: false })).length).toBe(0);
  });

  it('flag on: a frozen dataset is never current — prc_hicp_manr competes only for the historic slots', async () => {
    const shortlist = await recallCandidates(db, 'HICP monthly', { includeEurostat: true });
    const frozen = shortlist.find((c) => c.tableId === 'eurostat:prc_hicp_manr');
    expect(frozen?.status).toBe('possibly_frozen');
    expect(shortlist.find((c) => c.tableId === 'eurostat:prc_hicp_minr')?.status).toBe('current');
    const { rows } = await db.query(
      `select table_id, status from cbs_catalog where table_id in ('eurostat:prc_hicp_manr', 'eurostat:nrg_pc_204_h')`,
    );
    // nrg_pc_204_h ends 2007-S2: a semester end cannot be judged, so it stays null — not current either.
    expect(Object.fromEntries((rows as { table_id: string; status: string | null }[]).map((r) => [r.table_id, r.status]))).toEqual({
      'eurostat:prc_hicp_manr': 'possibly_frozen',
      'eurostat:nrg_pc_204_h': null,
    });
    // The quota: non-current rows get the 4 historic slots plus only what the current class leaves empty
    // (here 3 current matches, so 8 frozen HICP series fill the rest — shown as possibly_frozen, never current).
    const current = shortlist.filter((c) => c.status === 'current').length;
    expect(shortlist.length - current).toBeLessThanOrEqual(Math.max(4, 24 - current));
    expect(shortlist.filter((c) => c.status !== 'current').every((c) => c.status === 'possibly_frozen' || c.status === null)).toBe(true);
  });

  it('flag on: the deliverability walk never extends to a frozen or unjudged Eurostat dataset', () => {
    const candidate = (tableId: string, status: string | null): CatalogCandidate => ({
      tableId, title: tableId, summary: '', status, datasetType: 'dataset', rank: 0.5,
    });
    const outcome: Extract<FindTableOutcome, { kind: 'confident' }> = {
      kind: 'confident',
      pick: candidate('eurostat:prc_hicp_ainr', 'current'),
      confidence: 0.9,
      reading: '',
      alternativeIds: [],
      candidates: [
        candidate('eurostat:prc_hicp_ainr', 'current'),
        candidate('eurostat:prc_hicp_manr', 'possibly_frozen'),
        candidate('eurostat:nrg_pc_204_h', null),
        candidate('eurostat:prc_hicp_minr', 'current'),
      ],
    };
    expect(candidateWalk(outcome)).toEqual(['eurostat:prc_hicp_ainr', 'eurostat:prc_hicp_minr']);
  });

  it('the measurement replica ranks exactly like the finder (so the configuration variants measure only the configuration)', async () => {
    for (const c of cases) {
      expect(await replicaRecall(db, c.topic, 'dutch'), c.id).toEqual(await recallCandidates(db, c.topic, { includeEurostat: true }));
    }
  });

  it('the committed recall report is what the code measures (flag off and flag on)', async () => {
    const report = JSON.parse(readFileSync(REPORT_PATH, 'utf8')) as {
      report: Record<string, { summary: Record<string, GroupSummary>; cases: CaseResult[] }>;
    };
    for (const variant of ['flag-off', 'production'] as const) {
      const results = await measure(db, cases, variant);
      expect(results, variant).toEqual(report.report[variant]!.cases);
      expect(summarize(results), variant).toEqual(report.report[variant]!.summary);
    }
    // The CBS cases keep their place when the flag is on.
    const cbsPlaces = (variant: string) =>
      report.report[variant]!.cases.filter((r) => r.expectSource === 'cbs').map((r) => [r.id, r.position]);
    expect(cbsPlaces('production')).toEqual(cbsPlaces('flag-off'));
  });
});
