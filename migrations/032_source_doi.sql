-- 032 — D7(a): DOI on the two table-id-owning tables (WP30c phase E1, ADR 048
-- D7). Renumbered from 031 to 032 (session 107, 2026-09-16): 031 collided
-- with 031_chart_headlines.sql, an unrelated migration that landed on `main`
-- while this branch (built 2026-09-14/15) sat unmerged — caught via a real
-- "duplicate key value violates unique constraint schema_migrations_pkey"
-- test failure during the session-107 merge, not assumed. This migration was
-- never applied (file-only throughout), so renumbering is a pure rename, no
-- data or deployed-schema impact. ADDITIVE and deploy-order-safe: nullable,
-- no default other than NULL, so every existing row (all CBS today) is
-- untouched and no existing reader of cbs_tables/cbs_catalog needs to change.
-- Eurostat datasets carry a real DOI (Digital Object Identifier) per their
-- own catalog; CBS tables have no DOI concept, so this column simply stays
-- NULL for every CBS row forever — there is no CBS-side backfill to do.
-- Populated at catalog/registration time for a Eurostat table once E1's
-- ingestion actually registers one (session 107 verified the adapter against
-- the real API — see ADR 048's As-built addendum — but registering a real
-- table is still the owner-supervised step this migration's own apply is
-- part of).
-- No GRANT/RLS statements needed here: migration 003's ALTER DEFAULT
-- PRIVILEGES + auto-RLS mechanism locks every later table/column in this
-- schema automatically (same note as 011/012/016/017/018/019/026/028/029/030/031).
-- Plain Postgres only — runs identically on Supabase and PGlite (ADR 009).
alter table cbs_tables
  add column doi text;

alter table cbs_catalog
  add column doi text;
