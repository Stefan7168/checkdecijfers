-- 031 — D7(a): DOI on the two table-id-owning tables (WP30c phase E1, ADR 048
-- D7). ADDITIVE and deploy-order-safe: nullable, no default other than NULL,
-- so every existing row (all CBS today) is untouched and no existing reader
-- of cbs_tables/cbs_catalog needs to change. Eurostat datasets carry a real
-- DOI (Digital Object Identifier) per their own catalog; CBS tables have no
-- DOI concept, so this column simply stays NULL for every CBS row forever —
-- there is no CBS-side backfill to do. Populated at catalog/registration time
-- for a Eurostat table once E1's ingestion actually registers one (this
-- session ships the column, not any Eurostat row — see Constraint 0 in
-- docs/session-briefs/2026-09-14-wp30c-e1-executor-brief.md).
-- No GRANT/RLS statements needed here: migration 003's ALTER DEFAULT
-- PRIVILEGES + auto-RLS mechanism locks every later table/column in this
-- schema automatically (same note as 011/012/016/017/018/019/026/028/029/030).
-- Plain Postgres only — runs identically on Supabase and PGlite (ADR 009).
alter table cbs_tables
  add column doi text;

alter table cbs_catalog
  add column doi text;
