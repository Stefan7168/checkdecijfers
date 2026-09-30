// #357 step 3 ("Finding", ADR 048 addendum): how well does the table finder's Stage-1 recall find the right
// Eurostat dataset once Eurostat catalogue rows are let in (EUROSTAT_FINDER_ENABLED)? Hermetic and free: an
// in-memory database holding the committed CBS catalogue fixture and the REAL Eurostat catalogue capture
// (tests/fixtures/eurostat/_catalog.json, 7,569 datasets, judged current / possibly frozen at its own capture
// date), and the labelled set benchmark/eurostat-finder-labelled-set.json.
//
// RECALL STAGE ONLY. Stage 2 (the rerank) is a model call; there are no recorded rerank replies for these
// questions and recording them would be live spend, so this measures whether the right dataset is in the
// shortlist the rerank would see, and at which place — not which one the rerank would pick.
//
// It also measures the text configuration question from the study (§5.4 step 3): the catalogue's full-text
// column is built with the DUTCH configuration for every row, English Eurostat titles included. The
// 'english' and 'simple' variants re-rank ONLY the Eurostat rows with that configuration, computed on the fly
// in this measurement (no migration, nothing stored), CBS rows unchanged, merged by the finder's own quota.
//
//   node scripts/eurostat-finder-recall.ts           print the report
//   node scripts/eurostat-finder-recall.ts --write   also (re)write benchmark/eurostat-finder-recall-report.json
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixtureSource, loadCatalogFixture } from '../src/cbs-adapter/fixture-source.ts';
import { EurostatFixtureSource, loadEurostatCatalogFixture } from '../src/eurostat-adapter/fixture-source.ts';
import { ALIAS_HINTS, expandTopicTerms, ingestCatalog, recallCandidates } from '../src/catalog/index.ts';
import { quotaMerge, RECALL_LIMIT } from '../src/catalog/recall.ts';
import { buildIsCurrentPredicate } from '../src/catalog/current-status.ts';
import type { CatalogCandidate } from '../src/catalog/types.ts';
import type { Db } from '../src/db/types.ts';
import { CBS_SOURCE_KEY, EUROSTAT_SOURCE_KEY } from '../src/sources/registry.ts';
import { createTestDb } from '../tests/helpers/pglite-db.ts';

const CBS_CATALOG_DIR = fileURLToPath(new URL('../tests/fixtures/cbs', import.meta.url));
const EUROSTAT_CATALOG_DIR = fileURLToPath(new URL('../tests/fixtures/eurostat', import.meta.url));
export const SET_PATH = fileURLToPath(new URL('../benchmark/eurostat-finder-labelled-set.json', import.meta.url));
export const REPORT_PATH = fileURLToPath(new URL('../benchmark/eurostat-finder-recall-report.json', import.meta.url));

export interface FinderCase {
  id: string;
  lang: 'nl' | 'en';
  expectSource: 'eurostat' | 'cbs';
  question: string;
  topic: string;
  accept: string[];
}

/** How recall ranks. 'production' is recallCandidates itself; the others are this file's replica. */
export type RecallVariant = 'flag-off' | 'production' | ReplicaConfig;

/** 'dutch' = production's ranking (the replica's self-check); 'english' / 'simple' = the Eurostat rows' text
 * configuration swapped; 'dutch-title-only' = production without the theme breadcrumb (what step 3 adds). */
export type ReplicaConfig = 'dutch' | 'english' | 'simple' | 'dutch-title-only';

export interface CaseResult {
  id: string;
  lang: 'nl' | 'en';
  expectSource: 'eurostat' | 'cbs';
  /** 1-based place of the best-placed accepted id in the shortlist; null = not in it. */
  position: number | null;
  /** The accepted id at that place. */
  hit: string | null;
  shortlistSize: number;
  eurostatInShortlist: number;
}

export interface GroupSummary {
  cases: number;
  top1: number;
  top5: number;
  inShortlist: number;
}

export async function buildFinderDb(): Promise<{ db: Db; close(): Promise<void> }> {
  const { db, close } = await createTestDb();
  await ingestCatalog(db, new FixtureSource({}, loadCatalogFixture(CBS_CATALOG_DIR)), CBS_SOURCE_KEY);
  await ingestCatalog(db, new EurostatFixtureSource({}, loadEurostatCatalogFixture(EUROSTAT_CATALOG_DIR)), EUROSTAT_SOURCE_KEY);
  return { db, close };
}

export function loadCases(): FinderCase[] {
  return (JSON.parse(readFileSync(SET_PATH, 'utf8')) as { cases: FinderCase[] }).cases;
}

/**
 * recallCandidates with the Eurostat gate open, re-implemented so the Eurostat rows can be ranked with another
 * text configuration. With `config = 'dutch'` it must equal recallCandidates exactly (checked by
 * tests/catalog/eurostat-finder.test.ts), so any difference in the other variants is the configuration alone.
 */
export async function replicaRecall(db: Db, topic: string, config: ReplicaConfig): Promise<CatalogCandidate[]> {
  const terms = expandTopicTerms(topic, ALIAS_HINTS).filter((t) => t.trim().length > 0);
  if (terms.length === 0) return [];
  const tsq = (cfg: string) => terms.map((_, i) => `plainto_tsquery('${cfg}', $${i + 1})`).join(' || ');
  const isEurostat = `table_id like '${EUROSTAT_SOURCE_KEY}:%'`;
  const cfg = config === 'dutch-title-only' ? 'dutch' : config;
  const vector =
    config === 'dutch'
      ? 'tsv'
      : config === 'dutch-title-only'
        ? `(case when ${isEurostat} then setweight(to_tsvector('dutch', coalesce(title, '')), 'A') else tsv end)`
        : `(case when ${isEurostat} then setweight(to_tsvector('${cfg}', coalesce(title, '')), 'A') || ` +
          `setweight(to_tsvector('${cfg}', coalesce(summary, '')), 'B') else tsv end)`;
  const query = cfg === 'dutch' ? 'q.nl' : `(case when ${isEurostat} then q.other else q.nl end)`;
  const isCurrent = buildIsCurrentPredicate(undefined, terms.length + 2);
  const sql = `
    with q as (select (${tsq('dutch')}) as nl, (${tsq(cfg)}) as other),
    scored as (
      select table_id, title, summary, status, dataset_type,
             ${vector} as v, ${query} as tq, (${isCurrent.sql}) as is_current
        from cbs_catalog, q
       where (dataset_type is null or dataset_type <> 'Text')
         and (language is null or language = 'nl' or (language = 'en' and ${isEurostat}))
    ),
    ranked as (
      select table_id, title, summary, status, dataset_type, is_current, ts_rank(v, tq) as rank,
             row_number() over (partition by is_current order by ts_rank(v, tq) desc, table_id) as class_pos
        from scored
       where v @@ tq
    )
    select table_id, title, summary, status, dataset_type, rank, is_current
      from ranked
     where class_pos <= $${terms.length + 1}
     order by is_current desc, class_pos
  `;
  const { rows } = await db.query(sql, [...terms, RECALL_LIMIT, ...isCurrent.params]);
  const toCandidate = (r: Record<string, unknown>): CatalogCandidate => ({
    tableId: r.table_id as string,
    title: r.title as string,
    summary: (r.summary as string | null) ?? '',
    status: (r.status as string | null) ?? null,
    datasetType: (r.dataset_type as string | null) ?? null,
    rank: Number(r.rank),
  });
  return quotaMerge(
    rows.filter((r) => r.is_current === true).map(toCandidate),
    rows.filter((r) => r.is_current !== true).map(toCandidate),
    RECALL_LIMIT,
  );
}

export async function shortlistFor(db: Db, topic: string, variant: RecallVariant): Promise<CatalogCandidate[]> {
  if (variant === 'flag-off') return recallCandidates(db, topic, { includeEurostat: false });
  if (variant === 'production') return recallCandidates(db, topic, { includeEurostat: true });
  return replicaRecall(db, topic, variant);
}

export async function measure(db: Db, cases: FinderCase[], variant: RecallVariant): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const c of cases) {
    const shortlist = await shortlistFor(db, c.topic, variant);
    const index = shortlist.findIndex((s) => c.accept.includes(s.tableId));
    results.push({
      id: c.id,
      lang: c.lang,
      expectSource: c.expectSource,
      position: index >= 0 ? index + 1 : null,
      hit: index >= 0 ? shortlist[index]!.tableId : null,
      shortlistSize: shortlist.length,
      eurostatInShortlist: shortlist.filter((s) => s.tableId.startsWith(`${EUROSTAT_SOURCE_KEY}:`)).length,
    });
  }
  return results;
}

export function summarize(results: CaseResult[]): Record<string, GroupSummary> {
  const groups: Record<string, CaseResult[]> = {
    'eurostat-nl': results.filter((r) => r.expectSource === 'eurostat' && r.lang === 'nl'),
    'eurostat-en': results.filter((r) => r.expectSource === 'eurostat' && r.lang === 'en'),
    'eurostat-all': results.filter((r) => r.expectSource === 'eurostat'),
    'cbs-nl': results.filter((r) => r.expectSource === 'cbs'),
  };
  const out: Record<string, GroupSummary> = {};
  for (const [name, rs] of Object.entries(groups)) {
    out[name] = {
      cases: rs.length,
      top1: rs.filter((r) => r.position === 1).length,
      top5: rs.filter((r) => r.position !== null && r.position <= 5).length,
      inShortlist: rs.filter((r) => r.position !== null).length,
    };
  }
  return out;
}

export const REPORT_VARIANTS: RecallVariant[] = ['flag-off', 'production', 'dutch-title-only', 'english', 'simple'];

async function main(): Promise<void> {
  const cases = loadCases();
  const { db, close } = await buildFinderDb();
  try {
    const report: Record<string, { summary: Record<string, GroupSummary>; cases: CaseResult[] }> = {};
    for (const variant of REPORT_VARIANTS) {
      const results = await measure(db, cases, variant);
      report[variant] = { summary: summarize(results), cases: results };
      console.log(`\n== ${variant} ==`);
      for (const [name, s] of Object.entries(report[variant]!.summary)) {
        console.log(`${name.padEnd(13)} top-1 ${s.top1}/${s.cases}  top-5 ${s.top5}/${s.cases}  shortlist ${s.inShortlist}/${s.cases}`);
      }
      for (const r of results) {
        console.log(`  ${r.id.padEnd(22)} ${r.position === null ? 'MISS' : `#${r.position}`.padEnd(4)} ${r.hit ?? ''} (${r.eurostatInShortlist}/${r.shortlistSize} Eurostat)`);
      }
    }
    if (process.argv.includes('--write')) {
      writeFileSync(
        REPORT_PATH,
        `${JSON.stringify(
          {
            note:
              'Written by scripts/eurostat-finder-recall.ts --write. Stage-1 recall only (no model call). flag-off = today; ' +
              'production = EUROSTAT_FINDER_ENABLED=1 as built (Dutch text configuration for every row); english / simple = ' +
              'the Eurostat rows ranked with that configuration instead, computed in the measurement only (no migration); ' +
              'dutch-title-only = production without the theme breadcrumb in summary (what step 3 adds). ' +
              'Positions are 1-based places in the shortlist the rerank would see (at most 24).',
            catalogue: 'tests/fixtures/eurostat/_catalog.json (captured 2026-09-16) + tests/fixtures/cbs/_catalog.json',
            report,
          },
          null,
          2,
        )}\n`,
      );
      console.log(`\nwrote ${REPORT_PATH}`);
    }
  } finally {
    await close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
