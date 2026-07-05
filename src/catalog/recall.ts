// Stage-1 recall (WP16 sub-part 1): deterministic Postgres full-text search
// over the cbs_catalog mirror. NO LLM, NO CBS call — pure DB. Produces a
// bounded shortlist of candidate table ids for Stage-2 rerank. Text-type tables
// are excluded (they carry no numbers, so they can never answer a numeric
// question — principle c). Alias hints broaden the query so a renamed/official
// title is still recalled from an everyday term.
import type { Db } from '../db/types.ts';
import type { CatalogCandidate } from './types.ts';
import { ALIAS_HINTS, expandTopicTerms, type AliasHint } from './aliases.ts';

/** Shortlist size handed to Stage-2 rerank. The brief targets ~10–30; the LLM
 *  cost scales with this (titles+blurbs in the prompt), so keep it modest. */
export const RECALL_LIMIT = 20;

export interface RecallOptions {
  limit?: number;
  aliasHints?: AliasHint[];
}

/**
 * The candidate shortlist for a topic, ranked by Dutch full-text relevance.
 * Empty when nothing matches (the topic isn't in CBS's catalog, or is all
 * stopwords) — the honest "we can't even find a candidate" signal.
 */
export async function recallCandidates(
  db: Db,
  topic: string,
  options: RecallOptions = {},
): Promise<CatalogCandidate[]> {
  const limit = options.limit ?? RECALL_LIMIT;
  const terms = expandTopicTerms(topic, options.aliasHints ?? ALIAS_HINTS).filter(
    (t) => t.trim().length > 0,
  );
  if (terms.length === 0) return [];

  // OR-combine a plainto_tsquery per term: within a term plainto ANDs its
  // lexemes ("algemene bijstand" → algemene & bijstand); across terms we OR
  // (||) so any single alias expansion can match. Built once in a CTE and
  // reused for both the match filter and ts_rank so ranking sees the same query.
  const orParts = terms.map((_, i) => `plainto_tsquery('dutch', $${i + 1})`).join(' || ');
  const limitParam = `$${terms.length + 1}`;
  const sql = `
    with q as (select (${orParts}) as tsq)
    select table_id, title, summary, status, dataset_type,
           ts_rank(cbs_catalog.tsv, q.tsq) as rank
      from cbs_catalog, q
     where cbs_catalog.tsv @@ q.tsq
       and (dataset_type is null or dataset_type <> 'Text')
       and (language is null or language = 'nl')
     order by rank desc, table_id
     limit ${limitParam}
  `;
  const { rows } = await db.query(sql, [...terms, limit]);
  return rows.map((r) => ({
    tableId: r.table_id as string,
    title: r.title as string,
    summary: (r.summary as string | null) ?? '',
    status: (r.status as string | null) ?? null,
    datasetType: (r.dataset_type as string | null) ?? null,
    rank: Number(r.rank),
  }));
}
