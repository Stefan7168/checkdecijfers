-- 031 — chart_headlines (session 105, journalist chart-headline feature,
-- docs/superpowers/specs/2026-09-16-chart-journalist-headline-design.md).
-- One row per audit_answers row: the current AI-drafted-then-journalist-
-- edited headline sentence for that chart. NOT re-validated against the
-- data once edited — a deliberate, scoped exception to this product's
-- digit-scan discipline (owner decision, recorded in the spec above).
--
-- ⚠ FILE-ONLY until the owner-supervised apply (migrations 016/017/019/026/
-- 028/030 precedent). Deploy-order-safe: every reader/writer in
-- src/chart/headline-store.ts treats an absent table as "no headline yet" /
-- "not possible right now", never throws from a missing-table condition
-- outside an explicit pre-migration test.
--
-- chart_headlines is PERSONAL DATA from this commit on (mirrors migration
-- 028's user_chart_styles rule): it joins the retention job in the SAME
-- change (retention.ts's redactMatchingRows headlineDelete leg below).
-- No GRANT/RLS here: migration 003's rls_auto_enable locks every later
-- table automatically (same note as 011/012/017/018/019/026/028).
--
-- Plain Postgres only — identical on Supabase and PGlite (ADR 009).

create table chart_headlines (
  audit_answer_id bigint primary key references audit_answers(id),
  headline text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
