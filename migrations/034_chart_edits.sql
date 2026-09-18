-- 034 — chart_edits (session 112, chart co-pilot phase 1, ADR 056 decision 4,
-- owner decision docs/open-questions.md #274): one row per (audit answer,
-- user) holding that reader's serialised command log for the chart — form,
-- zoom, hidden/highlighted series, style, template, notes, title, caption.
-- A command never carries a data value (only keys, codes, enum values and
-- text the reader typed); the answer's numbers are untouched (R1/R6).
--
-- ⚠ FILE-ONLY until the owner-supervised apply (migrations 016/017/019/026/
-- 028/030/031 precedent). Deploy-order-safe: every reader/writer in
-- src/chart/edits-store.ts treats an absent table as "no edits yet" /
-- "cannot save right now", never throws.
--
-- PERSONAL DATA from this commit on (mirrors 031): it joins the retention
-- job in the SAME change (retention.ts hard-delete legs). No GRANT/RLS here:
-- migration 003's rls_auto_enable locks every later table automatically.
--
-- Plain Postgres only — identical on Supabase and PGlite (ADR 009).

create table chart_edits (
  audit_answer_id bigint not null references audit_answers(id),
  user_id text not null,
  log jsonb not null,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (audit_answer_id, user_id)
);
