// Stage-1 recall (WP16 sub-part 1): deterministic Postgres full-text search
// over the cbs_catalog mirror. NO LLM, NO CBS call — pure DB. Produces a
// bounded shortlist of candidate table ids for Stage-2 rerank. Text-type tables
// are excluded (they carry no numbers, so they can never answer a numeric
// question — principle c). Alias hints broaden the query so a renamed/official
// title is still recalled from an everyday term.
//
// WP30c/E1 (ADR 048, Amendment B2/Amendment 3): this is also THE deny gate
// keeping an unannounced source (Eurostat, D3) off the live NL chat path —
// see the explicit, UNCONDITIONAL filter below, right after the SQL fetch.
// Whole-branch-review fix (found after the task-level build, before the PR):
// the filter was originally bypassable via EUROSTAT_EXPLORER_ENABLED — the
// SAME flag the internal explorer route checks. That conflated two things
// that must stay independent: "is the internal explorer tool visible" and
// "can live chat ever answer from a Eurostat row." Flipping the explorer
// flag on (which the RUNBOOK's own owner-supervised follow-up instructs
// doing, to check the explorer against a real registered table) would have
// ALSO lifted the only protection keeping Eurostat out of live chat — a real
// D3(c) violation risk, not hypothetical. The explorer never needs this
// filter lifted: it reaches a table via an EXPLICIT target intent
// (web/lib/eurostat-explorer.ts), which bypasses recallCandidates/discovery
// entirely — confirmed by reading that module, it never calls this function.
// So the filter is unconditional in E1: no flag, no bypass, period. It only
// ever gets revisited in E2's own design round, alongside the ambiguity
// clarification (D5a) and comparability-break refusal (D5b) that are
// supposed to gate Eurostat's first real chat exposure.
//
// #357 step 3 ("Finding", ADR 048 addendum, 2026-10-01): that design round
// has started — THE PLOT's Eurostat route. The gate is now lifted ONLY by its
// own flag, EUROSTAT_FINDER_ENABLED=1 (never EUROSTAT_EXPLORER_ENABLED, for
// the reason above), read at call time through eurostatFinderEnabled(), and
// overridable per call (RecallOptions.includeEurostat) so tests and the
// measurement never touch process.env. Flag off (the default, and
// production): the SQL text and the filter below are the pre-step-3 ones,
// byte for byte; the one changed parameter is the Eurostat entry of the
// current-status list, which no row surviving the filter reads (proven in
// tests/catalog/eurostat-finder.test.ts). Flag on: Eurostat rows (language
// 'en') join the same full-text search and the same current-first quota; a
// frozen or unjudged Eurostat dataset is never "current" (status from
// parseJsonStatCatalog, registry currentCatalogStatuses = ['current']), so it
// competes only for the historic slots and whatever the current class leaves
// empty, exactly like a discontinued CBS table, and candidateWalk never
// walks it. The flag must stay off in
// production until Eurostat can actually answer from a found dataset
// (study §5.4 steps 4-5, the D3(d) public-claim sweep).
import type { Db } from '../db/types.ts';
import type { CatalogCandidate } from './types.ts';
import { ALIAS_HINTS, expandTopicTerms, type AliasHint } from './aliases.ts';
import { buildIsCurrentPredicate } from './current-status.ts';
import { EUROSTAT_SOURCE_KEY, sourceKeyForTableId } from '../sources/registry.ts';

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
  /** Session 153 (the front door): 'all' (default) is the original search —
   * every word of a short topic term must appear. 'any' takes free text (a
   * whole question), keeps its content words and matches ANY of them as a
   * prefix (raw and stemmed), ranked by how well a table matches. Used ONLY
   * for a question the intent parser called out_of_scope, which carries no
   * topic term; every other caller stays on 'all', byte for byte. */
  mode?: 'all' | 'any';
  /** #357 step 3: let Eurostat catalogue rows into the shortlist. Absent: eurostatFinderEnabled(). */
  includeEurostat?: boolean;
}

/** #357 step 3: the Eurostat-finder switch. Exactly '1' ⇒ on; unset or anything else ⇒ off (the
 * EUROSTAT_SIBLINGS_ENABLED / TABLE_LANE_ENABLED convention). Read at call time. */
export function eurostatFinderEnabled(): boolean {
  return process.env.EUROSTAT_FINDER_ENABLED === '1';
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
  const includeEurostat = options.includeEurostat ?? eurostatFinderEnabled();
  if (options.mode === 'any') return recallAnyWords(db, topic, limit, includeEurostat, options.aliasHints ?? ALIAS_HINTS);
  const terms = expandTopicTerms(topic, options.aliasHints ?? ALIAS_HINTS).filter(
    (t) => t.trim().length > 0,
  );
  if (terms.length === 0) return [];

  // OR-combine a plainto_tsquery per term: within a term plainto ANDs its
  // lexemes ("algemene bijstand" → algemene & bijstand); across terms we OR
  // (||) so any single alias expansion can match. Built once in a CTE and
  // reused for both the match filter and ts_rank so ranking sees the same
  // query. The window ranks per status class (current vs the rest — WP30b/A6:
  // "current" per the row's OWN source registry entry, for CBS exactly the
  // old `status = 'Regulier'`, output byte-identical) so the quota merge
  // below can select per class without a second round-trip.
  const orParts = terms.map((_, i) => `plainto_tsquery('dutch', $${i + 1})`).join(' || ');
  const limitParam = `$${terms.length + 1}`;
  const isCurrent = buildIsCurrentPredicate(undefined, terms.length + 2);
  // Flag off: the pre-step-3 clause verbatim. Flag on: Eurostat's English rows too (its id prefix is the
  // registry's own source rule, sourceKeyForTableId; D4 discovery for other languages stays closed).
  const languageClause = includeEurostat
    ? `(language is null or language = 'nl' or (language = 'en' and table_id like '${EUROSTAT_SOURCE_KEY}:%'))`
    : `(language is null or language = 'nl')`;
  const sql = `
    with q as (select (${orParts}) as tsq),
    ranked as (
      select table_id, title, summary, status, dataset_type,
             ts_rank(cbs_catalog.tsv, q.tsq) as rank,
             (${isCurrent.sql}) as is_current,
             row_number() over (
               partition by (${isCurrent.sql})
               order by ts_rank(cbs_catalog.tsv, q.tsq) desc, table_id
             ) as class_pos
        from cbs_catalog, q
       where cbs_catalog.tsv @@ q.tsq
         and (dataset_type is null or dataset_type <> 'Text')
         and ${languageClause}
    )
    select table_id, title, summary, status, dataset_type, rank, is_current
      from ranked
     where class_pos <= ${limitParam}
     order by is_current desc, class_pos
  `;
  const { rows: rawRows } = await db.query(sql, [...terms, limit, ...isCurrent.params]);

  // WP30c/E1 (ADR 048, Amendment B2/Amendment 3): THE deny gate on the live
  // NL chat question's finder/query path. This is an EXPLICIT source/flag
  // check, not the still-unlifted `language = 'nl'` filter above (which
  // would happen to exclude Eurostat rows too today, but is D4 discovery
  // scope, not a source gate, and stays unlifted regardless of this flag —
  // relying on it here would silently break the moment it lifts). Derived
  // via sourceKeyForTableId, the SAME id-prefix rule the registry itself
  // uses (never the DB's own `source` mirror column, so this can never drift
  // from what resolveSourceForTable would say about the same id) — every
  // eurostat:-prefixed candidate is removed from the shortlist BEFORE
  // Stage-2 rerank ever sees it, UNCONDITIONALLY, no flag, no bypass (see
  // this file's header comment for why a flag-gated version was wrong).
  // This is the ONLY thing standing between a hypothetical future eurostat:
  // catalog row and a live chat answer while the source stays unannounced
  // (D3); E1 registers zero real Eurostat tables today (Constraint 0), so
  // this gate is otherwise never exercised in production — proven with a
  // hand-inserted synthetic candidate in tests/catalog/recall.test.ts.
  //
  // #357 step 3: lifted ONLY when includeEurostat (see this file's header).
  const rows = includeEurostat
    ? rawRows
    : rawRows.filter((r) => sourceKeyForTableId(r.table_id as string) !== EUROSTAT_SOURCE_KEY);

  const toCandidate = (r: Record<string, unknown>): CatalogCandidate => ({
    tableId: r.table_id as string,
    title: r.title as string,
    summary: (r.summary as string | null) ?? '',
    status: (r.status as string | null) ?? null,
    datasetType: (r.dataset_type as string | null) ?? null,
    rank: Number(r.rank),
  });
  const regulier = rows.filter((r) => r.is_current === true).map(toCandidate);
  const historic = rows.filter((r) => r.is_current !== true).map(toCandidate);

  return quotaMerge(regulier, historic, limit);
}

/**
 * Function words a question carries that never name a statistics topic —
 * question words, auxiliaries and filler that Postgres' Dutch stopword list
 * does not drop. NOT a topic list: nothing here is a CBS subject, so the list
 * never steers WHICH table is found, only stops "hoeveel" from prefix-matching
 * every "hoeveelheid" title.
 */
const QUESTION_FUNCTION_WORDS = new Set([
  'hoeveel', 'hoeveelste', 'welk', 'welke', 'waar', 'wanneer', 'hoelang', 'hoeverre', 'hoezeer',
  'waren', 'werden', 'wordt', 'worden', 'werd', 'hebben', 'heeft', 'hadden', 'gaan', 'gaat', 'ging', 'gingen',
  'staat', 'stond', 'stonden', 'komen', 'kwam', 'kwamen', 'zitten', 'zaten', 'jaar', 'jaren', 'maand', 'kwartaal',
  'aantal', 'totaal', 'nederland', 'nederlandse', 'nederlanders', 'gemiddeld', 'gemiddelde', 'ongeveer',
  'vorig', 'vorige', 'afgelopen', 'laatste', 'eerste', 'tussen', 'sinds', 'vanaf', 'meeste', 'minste',
]);

/** Session 153 (#362): Dutch plural spelling, so a plural in a question
 * reaches the singular a CBS title is indexed under ("verkeersongevallen" →
 * "verkeersongeval", "huren" → "huur", "huizen" → "huis"). Spelling rules
 * only — an undoubled final consonant, a lengthened vowel in an open
 * syllable, final z/v → s/f — never a list of topics. Words not ending in
 * "-en", or too short to have a stem of 3+ letters, give nothing. */
export function dutchSingularStems(word: string): string[] {
  const m = /^([a-z\u00e0-\u00ff]{3,})en$/.exec(word);
  if (!m) return [];
  let stem = m[1]!;
  const out = new Set<string>();
  if (/([bcdfghjklmnpqrstvwxz])\1$/.test(stem)) stem = stem.slice(0, -1);
  else if (/[bcdfghjklmnpqrstvwxz][aeou][bcdfghjklmnpqrstvwxz]$/.test(stem)) {
    stem = `${stem.slice(0, -1)}${stem.at(-2)}${stem.at(-1)}`;
  }
  out.add(stem);
  if (stem.endsWith('z')) out.add(`${stem.slice(0, -1)}s`);
  if (stem.endsWith('v')) out.add(`${stem.slice(0, -1)}f`);
  return [...out].filter((s) => s.length >= 3);
}

/** Content words of free text, lower case, letters/digits only (so they are
 * safe inside to_tsquery), at least 4 characters, no numbers, no function
 * words. A Dutch past participle "ge…t"/"ge…d" ("gesloopt", "geregistreerd")
 * also contributes its base ("sloop", "registreer"): CBS titles name the
 * thing ("sloopvoertuigen"), questions the event — a spelling rule, not a word list. */
export function contentWords(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().normalize('NFC').split(/[^a-z0-9\u00e0-\u00ff]+/)) {
    if (raw.length < 4 || /^[0-9]+$/.test(raw) || QUESTION_FUNCTION_WORDS.has(raw)) continue;
    out.add(raw);
    const participle = /^ge([a-z\u00e0-\u00ff]{3,})[td]$/.exec(raw);
    if (participle) out.add(participle[1]!);
    for (const singular of dutchSingularStems(raw)) out.add(singular);
  }
  return [...out];
}

/** Session 153 (#362): a word matching more than this share of the catalogue
 * says little about WHICH table is meant ("nieuwe", "voor", "werk", "leven"
 * each match hundreds to thousands of tables, "bijstand" 76). Measured on the
 * 38 front-door questions (benchmark/frontdoor-labelled-set.json). */
export const COMMON_WORD_MAX_SHARE = 0.06;
/** ...and at least this many tables: in a small catalogue (tests, a fresh
 * mirror) a share says nothing — a topic word matching 1 of 4 rows is not common. */
export const COMMON_WORD_MIN_TABLES = 50;

/** The content words minus the catalogue-common ones — measured from the
 * catalogue itself (document frequency per word, same matching as the
 * search), never a list. When every word is common, the rarest one stays, so
 * a question is never left without a search. */
async function withoutCommonWords(db: Db, words: string[]): Promise<string[]> {
  const { rows } = await db.query(
    `with n as (
       select count(*)::int as total from cbs_catalog
        where (dataset_type is null or dataset_type <> 'Text') and (language is null or language = 'nl')
     )
     select w, count(c.table_id)::int as df, (select total from n) as total
       from unnest($1::text[]) as w
       left join cbs_catalog c
         on c.tsv @@ (to_tsquery('simple', w || ':*') || to_tsquery('dutch', w || ':*'))
        and (c.dataset_type is null or c.dataset_type <> 'Text') and (c.language is null or c.language = 'nl')
      group by w`,
    [words],
  );
  const df = new Map(rows.map((r) => [r.w as string, Number(r.df)]));
  const total = Number(rows[0]?.total ?? 0);
  if (total === 0) return words;
  const limit = Math.max(COMMON_WORD_MAX_SHARE * total, COMMON_WORD_MIN_TABLES);
  const kept = words.filter((w) => (df.get(w) ?? 0) <= limit);
  if (kept.length > 0) return kept;
  return [words.reduce((a, b) => ((df.get(a) ?? 0) <= (df.get(b) ?? 0) ? a : b))];
}

/** recallCandidates' 'any' mode (see RecallOptions.mode). Each content word
 * matches as a prefix twice — raw ("sloop:*" reaches the compound
 * "sloopvoertuig") and Dutch-stemmed — and the alias expansions join as
 * plain phrases. Same filters, same deny gate, same quota merge as 'all'. */
async function recallAnyWords(
  db: Db,
  text: string,
  limit: number,
  includeEurostat: boolean,
  aliasHints: AliasHint[],
): Promise<CatalogCandidate[]> {
  const allWords = contentWords(text);
  if (allWords.length === 0) return [];
  const words = await withoutCommonWords(db, allWords);
  const aliasPhrases = expandTopicTerms(text, aliasHints)
    .slice(1)
    .filter((t) => t.trim().length > 0);
  const aliasParts = aliasPhrases.map((_, i) => ` || plainto_tsquery('dutch', $${i + 2})`).join('');
  const limitParam = `$${aliasPhrases.length + 2}`;
  const isCurrent = buildIsCurrentPredicate(undefined, aliasPhrases.length + 3);
  const languageClause = includeEurostat
    ? `(language is null or language = 'nl' or (language = 'en' and table_id like '${EUROSTAT_SOURCE_KEY}:%'))`
    : `(language is null or language = 'nl')`;
  const sql = `
    with kept as (
      -- Raw prefixes only for words the Dutch dictionary keeps: 'simple' does
      -- not drop stopwords, so "door:*"/"voor:*" would match nearly every row.
      select string_agg(w || ':*', ' | ') as raw_q
        from unnest($1::text[]) as w
       where to_tsvector('dutch', w) <> ''::tsvector
    ),
    q as (
      select (to_tsquery('simple', coalesce(kept.raw_q, ''))
              || to_tsquery('dutch', array_to_string(array(select x || ':*' from unnest($1::text[]) as x), ' | '))${aliasParts}) as tsq
        from kept
    ),
    ranked as (
      select table_id, title, summary, status, dataset_type,
             ts_rank(cbs_catalog.tsv, q.tsq) as rank,
             (${isCurrent.sql}) as is_current,
             row_number() over (
               partition by (${isCurrent.sql})
               order by ts_rank(cbs_catalog.tsv, q.tsq) desc, table_id
             ) as class_pos
        from cbs_catalog, q
       where cbs_catalog.tsv @@ q.tsq
         and (dataset_type is null or dataset_type <> 'Text')
         and ${languageClause}
    )
    select table_id, title, summary, status, dataset_type, rank, is_current
      from ranked
     where class_pos <= ${limitParam}
     order by is_current desc, class_pos
  `;
  const { rows: rawRows } = await db.query(sql, [words, ...aliasPhrases, limit, ...isCurrent.params]);
  const rows = includeEurostat
    ? rawRows
    : rawRows.filter((r) => sourceKeyForTableId(r.table_id as string) !== EUROSTAT_SOURCE_KEY);
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
    limit,
  );
}

/** The shortlist from the two status classes (each already in class order, strongest first). Exported for
 * the #357 step-3 measurement (scripts/eurostat-finder-recall.ts), which ranks with other text configurations
 * and must merge exactly as the finder does. Pure. */
export function quotaMerge(
  regulier: CatalogCandidate[],
  historic: CatalogCandidate[],
  limit: number,
): CatalogCandidate[] {
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
