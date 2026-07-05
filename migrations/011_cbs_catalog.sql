-- 011 — CBS catalog mirror for on-demand table discovery (WP16 sub-part 1).
-- A LOCAL, bulk-refreshed copy of CBS's dataset catalog metadata so the
-- table-finder can search it WITHOUT a live CBS call per question (principle b /
-- ADR 003: CBS is contacted only in a scheduled bulk refresh, never the request
-- path). This closes ADR 003 revisit trigger #3 ("catalog ambitions outgrow
-- manual table onboarding").
--
-- No GRANT/RLS statements needed here: migration 003's ALTER DEFAULT PRIVILEGES
-- + auto-RLS mechanism locks every later table in this schema automatically
-- (anon/authenticated get nothing). Live-verified on production per the RUNBOOK
-- per-migration grants/RLS check (2026-07-05): 0 grants, RLS on, 0 policies.
--
-- DELIBERATELY SEPARATE from cbs_tables (docs/08-build-plan.md WP16: "Don't
-- conflate or repurpose columns"): cbs_catalog is "known to CBS, not yet
-- ingested"; cbs_tables is "registered + ingested". No FK between them — a
-- discovered catalog row that gets onboarded creates its own cbs_tables row via
-- the existing register/sync pipeline; the two stay decoupled.
--
-- Plain Postgres only — runs identically on Supabase and PGlite (ADR 009). The
-- Dutch full-text config, the generated tsvector column and the GIN index were
-- verified to work on the PGlite test DB before this migration was written.

create table cbs_catalog (
  -- Exact as-published CBS v4 Identifier. Verified to BE the id the v4 data
  -- endpoints require (Properties/85773NED -> 200, Properties/85773 -> 404):
  -- the finder can hand this id straight to the ingestion pipeline, no mapping.
  -- Casing is load-bearing (quirk #1) — never case-normalize.
  table_id text primary key,
  title text not null,
  -- CBS 'Description': the full multi-line blurb (subject, frequency, period
  -- coverage, status). Present in the Datasets listing itself, so bulk refresh
  -- needs no per-table call. May be empty; defaulted to '' so the tsvector
  -- expression stays total.
  summary text not null default '',
  -- CBS 'Status': 'Regulier' | 'Gediscontinueerd' | 'Vervallen'. A ranking /
  -- disclosure signal, NOT a hard filter — a discontinued table is still valid
  -- history (our own 83131NED is 'Gediscontinueerd'). Nullable: tolerate a
  -- catalog row CBS ships without one rather than failing the whole refresh.
  status text,
  -- CBS 'DatasetType': 'Numeric' | 'Mixed' | 'Text'. A Text table carries no
  -- numbers and can never answer a numeric question, so recall excludes it
  -- (principle c). Kept here so the catalog is a faithful mirror; the filter
  -- lives in the recall query, not in what we store.
  dataset_type text,
  -- CBS 'Language' — 'nl' for the CBS catalog. Recall filters to nl.
  language text,
  -- CBS 'Modified' — when CBS last changed the dataset. A recency signal.
  cbs_modified timestamptz,
  -- When OUR bulk refresh last wrote this row (our own freshness, distinct from
  -- cbs_modified). The refresh cadence is an operational choice (open); this
  -- column is what a staleness check would read.
  refreshed_at timestamptz not null default now(),
  -- Stage-1 recall index: Dutch full-text over title + summary, title weighted
  -- above summary (A > B) so a topic in the title outranks a passing mention in
  -- the blurb. Generated + stored so it can never drift from the text.
  -- Explicit 'dutch' regconfig makes to_tsvector immutable (required for a
  -- generated column) and applies the Dutch snowball stemmer.
  tsv tsvector generated always as (
    setweight(to_tsvector('dutch', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('dutch', coalesce(summary, '')), 'B')
  ) stored
);

-- Full-text recall (tsv @@ plainto_tsquery('dutch', :topic), ranked by ts_rank).
create index cbs_catalog_tsv on cbs_catalog using gin (tsv);

-- Recall pre-filters on these (exclude Text tables, keep nl) before ranking.
create index cbs_catalog_recall on cbs_catalog (dataset_type, language);
