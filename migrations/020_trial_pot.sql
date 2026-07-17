-- 020 — the #53 anonymous trial pot (ADR 036): 2 free questions for anonymous
-- visitors on the public homepage, funded from a deterministic QUESTIONS
-- counter (owner decision, session 51) — deliberately NOT credit_transactions
-- rows: that ledger's user_id is NOT NULL with an FK to auth.users, and mixing
-- anonymous spend into the money ledger would poison its conservation
-- invariants. The pot is a mutable counter by design; the per-question
-- bookkeeping (trial_questions) is the append-only side that makes every
-- take/refund reconstructible.
--
-- ⚠ FILE-ONLY until the owner-supervised apply (house rule, migrations
-- 016/017/019 precedent). Deploy-order-safe: everything ships dormant behind
-- TRIAL_ENABLED + ANTHROPIC_TRIAL_API_KEY, and the pot row seeds at 0/0 —
-- applying this migration changes nothing user-visible until the supervised
-- go-live seeds a real pot (ADR 036 go-live checklist).
--
-- No GRANT/RLS statements needed: migration 003's ALTER DEFAULT PRIVILEGES +
-- rls_auto_enable mechanism locks every later table automatically (same note
-- as migrations 011/012/017/018/019); the supervised apply live-verifies.
--
-- Plain Postgres only — runs identically on Supabase and PGlite (ADR 009).

-- Singleton pot config (signup_grant_config precedent, migration 005): a
-- plain UPDATE refills it; remaining_questions >= 0 is structural — the take
-- path decrements under an advisory lock and can never go below zero.
-- cap records the owner's intended fill level so a refill is one statement
-- (`update trial_pot_config set remaining_questions = cap`) and monitoring
-- can show "12 of 25 left" honestly.
create table trial_pot_config (
  singleton boolean primary key default true check (singleton),
  remaining_questions integer not null check (remaining_questions >= 0),
  cap integer not null check (cap >= 0)
);
insert into trial_pot_config (remaining_questions, cap) values (0, 0);

-- One row per SERVED trial question — the reconstructible bookkeeping behind
-- the mutable counter. visitor_id is the D1 cookie UUID; ip_hash is
-- HMAC(secret, ip) — never a raw IP (ADR 036 D2). refunded marks the
-- compensation path (pipeline threw before an answer was delivered): the pot
-- got its question back and the row no longer counts against the visitor's
-- limit, but the row itself stays — append-only history, like the ledger's
-- debit+compensation pairs.
create table trial_questions (
  id bigint generated always as identity primary key,
  visitor_id uuid not null,
  ip_hash text not null,
  request_id text not null,
  -- Nullable: set after the audit row exists (R8 write happens inside the
  -- pipeline call, after the pot take). No ON DELETE clause — the
  -- redact-not-delete posture (migration 005 precedent).
  audit_answer_id bigint references audit_answers(id),
  refunded boolean not null default false,
  created_at timestamptz not null default now()
);

-- Idempotency: a client retry with the same (visitor_id, request_id) must
-- never take a second question from the pot (the ledger's ON CONFLICT
-- pattern, migration 005/018 precedent).
create unique index trial_questions_visitor_request on trial_questions (visitor_id, request_id);

-- The two limit checks (ADR 036 D2): per-visitor count and per-ip-hash count
-- over a time window.
create index trial_questions_by_visitor on trial_questions (visitor_id) where not refunded;
create index trial_questions_by_ip_time on trial_questions (ip_hash, created_at) where not refunded;

-- audit_answers.source_tag widening for anonymous trial rows (ADR 036 D4):
-- user_id stays null (the migration-004 "null = anonymous" seam, finally used
-- for real visitors), the tag does the distinguishing. Same drop-and-re-add-
-- by-name pattern as migrations 012/013/018 (there is no ALTER CHECK).
-- The GDPR retention allowlist (src/answer/audit/retention.ts AUDIT_SCOPE)
-- gains this tag IN THE SAME CHANGE — without that conscious add, anonymous
-- rows would be silently retained forever (the allowlist is deliberately not
-- automatic).
alter table audit_answers drop constraint audit_answers_source_tag_check;
alter table audit_answers add constraint audit_answers_source_tag_check
  check (source_tag in ('benchmark', 'validation', 'user', 'onboarding_delivery', 'anonymous_trial'));
