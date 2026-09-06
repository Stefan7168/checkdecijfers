-- 026 — user_datasets + dataset_turns: the "Eigen data" attachments tier
-- (WP202a, ADR 037). A structurally separate trust tier from the CBS answer
-- pipeline — see ADR 037 for the full decision and
-- session-briefs/2026-09-06-chat-with-data-design.md for the executor brief
-- (D3 is this migration's own spec; read it before touching this file).
--
-- These two tables are personal data from the FIRST commit that creates them
-- (ADR 033's own rule) — uploaded files may contain THIRD PARTIES' personal
-- data too (a journalist's spreadsheet of names). Both join the existing
-- single-enforcement-point retention machinery (src/answer/audit/retention.ts)
-- before this feature ever goes live; see migration 027 for the ledger side.
--
-- ⚠ FILE-ONLY until the owner-supervised apply (migrations 016/017/019
-- precedent). Deploy-order-safe: nothing in the shipped code path reads
-- either table, or chat_threads.dataset_id, until ATTACHMENTS_ENABLED is set
-- in the supervised go-live window (the WORKSPACE_ENABLED/ONBOARDING_ENABLED
-- dormancy pattern, ADR 033 D7 / migration 012).
--
-- No GRANT/RLS statements needed here: migration 003's ALTER DEFAULT
-- PRIVILEGES + rls_auto_enable mechanism locks every later table in this
-- schema automatically (same note as migrations 011/012/017/018/019); the
-- supervised apply still live-verifies grants/RLS as usual, and the guarded
-- auth.users FK below (migration 019's exact pattern) is verified there too
-- — CI is structurally blind to it (PGlite has no `auth` schema).
--
-- Plain Postgres only — runs identically on Supabase and PGlite (ADR 009).

-- --------------------------------------------------------------------------
-- user_datasets — one row per upload/link. `cells` (verbatim raw cell text)
-- is the system of record for charting; `profile` is the closed vocabulary
-- (D6) the LLM is ever allowed to see. `file_bytes` is D4's bytea choice —
-- kept only for re-extraction/download/provenance, nulled well before the
-- 2-year row lifetime (90-day cutoff, D13, its own retention-job leg).
create table user_datasets (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  source_kind text not null check (source_kind in ('file_csv', 'file_tsv', 'file_xlsx', 'url_html', 'file_pdf')),
  display_name text not null,
  source_url text,
  mime_sniffed text not null,
  byte_size integer not null check (byte_size >= 0),
  content_sha256 text not null,
  -- Added in review (adversarial review, session 84, money-path lens): a
  -- future PAID ingest kind (PDF/HTML-unstructured) needs an idempotency /
  -- traceability key from day one, or adding one later is a migration on a
  -- live table. content_sha256 above is only a dedupe HINT, never an
  -- enforced uniqueness constraint (two users' identical files must not
  -- collide) — this is deliberately separate from it. NULL for v1's free
  -- CSV/TSV path, which never reserves a ledger debit at all (D12: "free"
  -- means skip the reserve call, not a $0 price row).
  request_id uuid,
  file_bytes bytea,
  cells jsonb not null,
  profile jsonb not null,
  extraction jsonb,
  status text not null default 'ready' check (status in ('ready', 'needs_decision', 'failed', 'redacted')),
  created_at timestamptz not null default now(),
  redacted_at timestamptz
);

-- Guarded FK to auth.users, conditional on the auth schema existing —
-- migration 019's exact pattern (itself migration 005's). Deliberately NO
-- `on delete cascade`: the redact-not-delete posture means a user row is
-- never physically deleted while a dataset references it.
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'auth' and table_name = 'users') then
    execute 'alter table user_datasets add constraint user_datasets_user_id_fkey
             foreign key (user_id) references auth.users(id)';
  end if;
end $$;

create index user_datasets_by_user_created on user_datasets (user_id, created_at desc);
-- Quota accounting (per-user dataset count / byte sum, D12/§4) only ever
-- needs to sum non-redacted rows — a partial index keeps that cheap forever
-- regardless of how many redacted rows accumulate.
create index user_datasets_active_by_user on user_datasets (user_id) where status <> 'redacted';

-- --------------------------------------------------------------------------
-- dataset_turns — one row per dataset-chat response, the R8 analog for this
-- tier (D9). `envelope` is the authoritative, verbatim-stored
-- DatasetTurnEnvelope; `question`/`final_text` are real top-level columns
-- (NOT just fields inside the envelope jsonb) because they need their own
-- explicit redaction leg — see migration's header note and D13's fix.
create table dataset_turns (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  dataset_id bigint not null references user_datasets(id),
  -- No ON DELETE clause on either FK below — the redact-not-delete posture
  -- (migration 005/019 precedent) means neither the dataset nor the thread
  -- row is ever physically deleted while a turn references it.
  thread_id bigint not null references chat_threads(id),
  request_id uuid not null,
  kind text not null check (kind in ('chart', 'clarification', 'refusal')),
  question text not null,
  envelope jsonb not null,
  final_text text not null,
  instruction jsonb,
  chart_emitted boolean not null,
  prompt_versions jsonb not null,
  llm_calls jsonb not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  latency_ms integer not null default 0,
  created_at timestamptz not null default now()
);

do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'auth' and table_name = 'users') then
    execute 'alter table dataset_turns add constraint dataset_turns_user_id_fkey
             foreign key (user_id) references auth.users(id)';
  end if;
end $$;

create index dataset_turns_by_dataset on dataset_turns (dataset_id, created_at);
create index dataset_turns_by_thread on dataset_turns (thread_id, created_at);
-- Code-review finding, session 84 (this migration was FILE-ONLY, never
-- applied anywhere, so fixed here directly rather than via a follow-up
-- migration): UNIQUE, not just an index — defense-in-depth against a
-- duplicate audit row for one logical dataset-chat turn (mirroring
-- credit_transactions_one_dataset_per_request, migration 027's ledger-side
-- idempotency guard). writeTurn's (audit.ts) fail-closed fallback insert
-- path is the one place a retried insert for the same request_id could
-- otherwise slip through with no schema-level guard at all.
create unique index dataset_turns_one_per_request on dataset_turns (request_id);

-- --------------------------------------------------------------------------
-- chat_threads.dataset_id — additive, nullable: NULL means "a CBS thread",
-- exactly as today (D3/D10). A dataset thread is created EAGERLY with the
-- dataset (unlike ADR 033's lazy CBS threads) — the upload itself is the
-- first meaningful event. No ON DELETE clause, same redact-not-delete
-- posture as every other FK in this file.
alter table chat_threads add column dataset_id bigint references user_datasets(id);
create index chat_threads_by_dataset on chat_threads (dataset_id) where dataset_id is not null;
