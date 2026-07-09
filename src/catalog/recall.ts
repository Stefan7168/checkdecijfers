// Stage-1 recall (WP16 sub-part 1): deterministic Postgres full-text search
// over the cbs_catalog mirror. NO LLM, NO CBS call — pure DB. Produces a
// bounded shortlist of candidate table ids for Stage-2 rerank. Text-type tables
// are excluded (they carry no numbers, so they can never answer a numeric
// question — principle c). Alias hints broaden the query so a renamed/official
// title is still recalled from an everyday term.
import type { Db } from '../db/types.ts';
import type { CatalogCandidate } from './types.ts';
import { ALIAS_HINTS, expandTopicTerms, type AliasHint } from './aliases.ts';

/** Regulier-first shortlist quotas (WP27 amendment A2, owner-approved
 *  2026-07-08). MEASURED driver: on the live 4,858-row mirror the raw top-20
 *  for "bijstand" held 14 discontinued tables and the only v1-deliverable
 *  table (37789ksz, kerncijfers) sat at overall position 51 — Stage 2 can only
 *  choose among what Stage 1 shows, so no rerank improvement could ever reach
 *  it. Current tables now fill the shortlist first (up to
 *  RECALL_REGULIER_SLOTS, by FTS rank); the strongest non-Regulier matches
 *  keep RECALL_HISTORIC_SLOTS so explicitly-historical questions still see
 *  candidates (the rerank prompt's "TENZIJ historisch" rule stays the judge).
 *  Either class fills the other's unused slots — a topic with few current
 *  tables still gets a full shortlist, exactly today's behavior. */
export const RECALL_REGULIER_SLOTS = 20;
export const RECALL_HISTORIC_SLOTS = 4;
/** Total shortlist size handed to Stage-2 rerank. The LLM cost scales with
 *  this (titles+blurbs in the prompt), so keep it modest. */
export const RECALL_LIMIT = RECALL_REGULIER_SLOTS + RECALL_HISTORIC_SLOTS;

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
  // reused for both the match filter and ts_rank so ranking sees the same
  // query. The window ranks per status class (Regulier vs the rest) so the
  // quota merge below can select per class without a second round-trip.
  const orParts = terms.map((_, i) => `plainto_tsquery('dutch', $${i + 1})`).join(' || ');
  const limitParam = `$${terms.length + 1}`;
  const sql = `
    with q as (select (${orParts}) as tsq),
    ranked as (
      select table_id, title, summary, status, dataset_type,
             ts_rank(cbs_catalog.tsv, q.tsq) as rank,
             (coalesce(status, '') = 'Regulier') as is_regulier,
             row_number() over (
               partition by (coalesce(status, '') = 'Regulier')
               order by ts_rank(cbs_catalog.tsv, q.tsq) desc, table_id
             ) as class_pos
        from cbs_catalog, q
       where cbs_catalog.tsv @@ q.tsq
         and (dataset_type is null or dataset_type <> 'Text')
         and (language is null or language = 'nl')
    )
    select table_id, title, summary, status, dataset_type, rank, is_regulier
      from ranked
     where class_pos <= ${limitParam}
     order by is_regulier desc, class_pos
  `;
  const { rows } = await db.query(sql, [...terms, limit]);
  const toCandidate = (r: Record<string, unknown>): CatalogCandidate => ({
    tableId: r.table_id as string,
    title: r.title as string,
    summary: (r.summary as string | null) ?? '',
    status: (r.status as string | null) ?? null,
    datasetType: (r.dataset_type as string | null) ?? null,
    rank: Number(r.rank),
  });
  const regulier = rows.filter((r) => r.is_regulier === true).map(toCandidate);
  const historic = rows.filter((r) => r.is_regulier !== true).map(toCandidate);

  // Quota merge (amendment A2): reserve the historic slots only when the
  // caller's limit has room beyond the Regulier quota (the default 24 does;
  // a small test limit degrades to plain Regulier-first fill). Unused slots
  // on either side go to the other class.
  const reserve = Math.min(
    RECALL_HISTORIC_SLOTS,
    Math.max(0, limit - RECALL_REGULIER_SLOTS),
    historic.length,
  );
  const regulierTake = Math.min(regulier.length, limit - reserve);
  const historicTake = Math.min(historic.length, limit - regulierTake);
  const merged = [...regulier.slice(0, regulierTake), ...historic.slice(0, historicTake)];

  // Final ordering stays pure relevance (rank desc) regardless of status —
  // the quota decides WHO is on the shortlist, not who leads it: disclosure
  // slices and the prompt's numbering should surface the strongest matches
  // first, and the rerank prompt owns the Regulier-vs-historisch judgement.
  return merged.sort((a, b) => b.rank - a.rank || (a.tableId < b.tableId ? -1 : 1));
}
