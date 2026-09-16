-- 033 — D7(b): request_urls on ingestion_batches (WP30c phase E1, ADR 048
-- D7). Renumbered from 032 to 033 (session 107, 2026-09-16), the same
-- collision-driven rename as 032_source_doi.sql (formerly 031) — see that
-- file's own header for the full account. Never applied (file-only
-- throughout), so this is a pure rename. ADDITIVE and deploy-order-safe:
-- nullable text[], no default, so every existing batch row (all CBS today)
-- is untouched. Records the exact request URL(s) a batch fetched from the
-- source API, so the proof panel can show "here is exactly what we asked the
-- source for" alongside the DOI (032) and the existing batch metadata — a
-- live side-lookup by ingestion_batches.id at proof-render time
-- (web/lib/answer-proof.ts), never denormalized into the R8-reconstructed
-- answer envelope itself (Amendment 6 / ADR 048).
-- No GRANT/RLS statements needed here: migration 003's ALTER DEFAULT
-- PRIVILEGES + auto-RLS mechanism locks every later table/column in this
-- schema automatically (same note as 011/012/016/017/018/019/026/028/029/030/031/032).
-- Plain Postgres only — runs identically on Supabase and PGlite (ADR 009).
alter table ingestion_batches
  add column request_urls text[];
