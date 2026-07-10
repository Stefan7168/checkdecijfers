-- 015 — WP27 stage B/C: the candidate chain + fit-gate columns on
-- pending_table_requests (ADR 027 D2a, session-brief 2026-07-07-111-design §
-- Stage B/C).
--
-- ⚠ FILE-ONLY UNTIL STAGE D: this migration is committed here so CI/PGlite
-- prove the widened code against it, but it must NOT be applied to production
-- until WP27 stage D's owner-supervised live step (the RUNBOOK entry). The
-- stage-B code is written to run against the PRE-015 schema too (the store
-- probes for candidate_ids before naming it in an INSERT), so either deploy
-- order is safe: rows created before this migration get the '[]' default when
-- it lands (= the legacy no-fit-gate path, ADR 027 D2c), and an old deploy
-- reading post-015 rows simply ignores the new columns.
--
-- All three columns sit OUTSIDE every index and constraint on this table —
-- in particular the pending_one_active_per_user_table partial unique index
-- (the asking-twice dedupe) keys on the UNCHANGED table_id and is untouched
-- by construction (ADR 027 D2a: table_id is NEVER mutated; the fit gate's
-- choice lives in resolved_table_id).
--
-- Plain Postgres only — runs identically on Supabase and PGlite (ADR 009).

alter table pending_table_requests
  -- The finder's candidate chain, confident pick first, then its
  -- allowlist-sanitized alternativeIds, cap 3 (constructed in
  -- src/ingestion/onboarding-finder.ts). '[]' = a legacy row: stage C's job
  -- runs EXACTLY today's path on it (no fit gate, no schema fetch).
  add column candidate_ids jsonb not null default '[]'::jsonb,
  -- Stage C's accepted fit: the candidate the job resolved to ingest.
  -- NULL until the fit gate accepts; the job reads
  -- (resolved_table_id ?? table_id) from there on. table_id itself is never
  -- mutated — it stays the finder's original pick, the dedupe identity.
  add column resolved_table_id text,
  -- Stage C's fit result (measure code + one-line reading) — diagnostics
  -- only; delivery never consumes it (the parser + delivery gate still decide
  -- independently, defense in depth). Added here rather than in a 016 because
  -- the stage-C brief pins it to the SAME migration as the candidate columns
  -- (brief § Stage C), and this file is unapplied until stage D anyway.
  add column fit_note text;
