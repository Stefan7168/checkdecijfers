-- 019 — chat_threads: persisted conversation threads for the chat workspace
-- (WP135, ADR 033 D1). A thread is a stable identity that groups a user's
-- audit_answers rows into one resumable conversation. It stores WHEN a
-- conversation happened, NEVER WHAT was asked: no text columns, by design —
-- thread titles are DERIVED at read time from the first non-redacted audit
-- row's question (src/threads/index.ts listThreads), so redacting the audit
-- rows automatically empties the sidebar with zero new GDPR machinery (ADR
-- 033 D2 / #14/#120). A thread therefore needs no place in the retention
-- purge: it holds no personal data of its own.
--
-- ⚠ FILE-ONLY until the owner-supervised apply (house rule, migrations 016/017
-- precedent). Deploy-order-safe: the workspace ships behind WORKSPACE_ENABLED
-- and no request-path code reads chat_threads or audit_answers.thread_id until
-- that flag is on in the supervised go-live (ADR 033 D7). Old rows, benchmark/
-- validation rows and onboarding-delivery rows keep thread_id NULL.
--
-- No GRANT/RLS statements needed here: migration 003's ALTER DEFAULT PRIVILEGES
-- + rls_auto_enable mechanism locks every later table in this schema
-- automatically (same note as migrations 011/012/017/018); the supervised
-- apply still live-verifies grants/RLS as usual.
--
-- Plain Postgres only — runs identically on Supabase and PGlite (ADR 009).

-- chat_threads stores WHEN, never WHAT: no text columns, by design (ADR 033 D1).
create table chat_threads (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

-- Guarded FK to auth.users, conditional on the auth schema existing — migration
-- 005's exact pattern, retargeted (the credit_transactions ledger FK). The
-- hermetic PGlite test database (ADR 009) has no `auth` schema, so this always
-- no-ops in CI; the constraint is verified on production in the supervised
-- go-live step (see the WP135 brief's PR-review checklist line — CI is
-- structurally blind to a missing FK here). Deliberately NO `on delete cascade`:
-- the redact-not-delete posture (migration 005 precedent) means a user row is
-- never physically deleted while its threads reference it.
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'auth' and table_name = 'users') then
    execute 'alter table chat_threads add constraint chat_threads_user_id_fkey
             foreign key (user_id) references auth.users(id)';
  end if;
end $$;

-- The sidebar read path: a user's threads, most-recent-activity first (ADR 033
-- consequences note — carries the read-time title-derivation join to real usage).
create index chat_threads_by_user_activity on chat_threads (user_id, last_activity_at desc);

-- The thread link on audit rows: nullable bigint FK, no ON DELETE clause (the
-- redact-not-delete posture — migration 005 precedent). A row written without a
-- threadId (benchmark/validation/onboarding-delivery, and every pre-WP135 row)
-- stays NULL.
alter table audit_answers add column thread_id bigint references chat_threads(id);
create index audit_answers_by_thread on audit_answers (thread_id) where thread_id is not null;
