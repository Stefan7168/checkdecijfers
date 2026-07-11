-- 017 — WP128 (open-questions #128): thumbs up/down feedback on answers.
-- One additive, WRITE-ONLY table: feedback POINTS at an audit_answers row and
-- never modifies it (R8 stays untouched — the audit row remains the frozen
-- record; this table is the signal store the WP26 answer-quality lane reads).
--
-- ⚠ FILE-ONLY until the owner-supervised apply (house rule; applied together
-- with the pending 016 in one `npm run db:migrate` window). Deploy-order-safe:
-- the feedback Server Action fails SOFT while this table is absent — a click
-- shows "Feedback kon niet worden opgeslagen." and nothing else happens.
--
-- No GRANT/RLS statements needed here: migration 003's ALTER DEFAULT
-- PRIVILEGES + rls_auto_enable mechanism locks every later table in this
-- schema automatically (same note as migrations 011/012); the supervised
-- apply still live-verifies grants/RLS as usual.
--
-- The FK deliberately carries no ON DELETE clause: audit rows are never
-- physically deleted (redaction-only, migration 005's ledger FK), and
-- answer_feedback rows themselves are HARD-deleted by the GDPR paths
-- (src/answer/audit/retention.ts — nothing references this table, so delete
-- is safe and matches the owner's "wis de inhoud volledig" principle).
--
-- unique (audit_answer_id, user_id): one feedback per user per answer — the
-- upsert path lets a user CHANGE their verdict (👍→👎, text overwritten,
-- created_at refreshed; last write wins). It also bounds feedback cardinality
-- to the user's own answer count (the review's accepted rate-limit residual).
--
-- Plain Postgres only — runs identically on Supabase and PGlite (ADR 009).

create table answer_feedback (
  id bigint generated always as identity primary key,
  audit_answer_id bigint not null references audit_answers(id),
  user_id text not null,
  verdict text not null check (verdict in ('up', 'down')),
  feedback_text text,
  created_at timestamptz not null default now(),
  constraint answer_feedback_one_per_user_per_answer unique (audit_answer_id, user_id)
);

create index answer_feedback_by_user on answer_feedback (user_id);
