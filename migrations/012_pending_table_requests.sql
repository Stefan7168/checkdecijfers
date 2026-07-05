-- 012 — on-demand CBS table onboarding (WP16 sub-part 2, ADR 026): the
-- status table backing the fetch->verify->store->answer loop. A row here
-- tracks one user's request to onboard a topic that findTable matched
-- confidently but that isn't registered/synced yet (src/ingestion, cbs_tables)
-- — from the 100-credit debit through the background job's claim, register,
-- sync, vocabulary registration and delivery (or refund).
--
-- DELIBERATELY SEPARATE from cbs_tables/cbs_catalog (same reasoning as
-- migration 011's header): this is "a user is waiting on this table", not
-- "this table is known to CBS" or "this table is ingested". No FK to either —
-- the job resolves table_id against both at claim time.
--
-- No GRANT/RLS statements needed here: migration 003's ALTER DEFAULT
-- PRIVILEGES + auto-RLS mechanism locks every later table in this schema
-- automatically (anon/authenticated get nothing) — same comment as migration
-- 011 (itself copied from the mechanism's original migration 003).
--
-- Plain Postgres only — runs identically on Supabase and PGlite (ADR 009).

create table pending_table_requests (
  id bigint generated always as identity primary key,
  -- joins credit_transactions.user_id (uuid). audit_answers.user_id is text
  -- (the history.ts precedent — no auth provider existed when that table was
  -- designed); this table postdates billing, so it follows the ledger's type.
  user_id uuid not null,
  -- the chat turn's requestId (credit_transactions.request_id) — links this
  -- row back to the debit that funds it.
  request_id text not null,
  -- re-run verbatim at delivery (design §0.4): the ONLY re-entry into the
  -- normal audited pipeline this row needs, never a stored intent.
  question_text text not null,
  -- the unmatchedMeasureTerm findTable matched on (design §2) — carried for
  -- diagnostics/plain-language failure summaries, not re-parsed.
  topic_term text not null,
  -- findTable's confident pick. Verbatim CBS casing (catalog quirk #1) — it is
  -- the id the ingestion pipeline hands straight to the adapter.
  table_id text not null,
  finder_confidence numeric not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'delivered', 'failed', 'unanswerable')),
  claimed_at timestamptz,
  attempt_count int not null default 0,
  -- the 100-credit onboarding_cost debit this row spends (§2 money design) —
  -- never null: a pending row cannot exist without its debit already landed
  -- in the same transaction (triggerOnboarding, CORE-1).
  debit_transaction_id bigint not null references credit_transactions(id),
  -- the acknowledgment turn's audit row and the eventual delivery turn's audit
  -- row. No FK: audit_answers.id is bigint (confirmed against migration 004),
  -- so this COULD carry one, but the acknowledgment is written by the web
  -- action after this row's insert (ordering: debit + pending row first, then
  -- the audited refusal is shown) — a FK would force an awkward two-phase
  -- write for no real integrity gain (an orphaned id here is a display-only
  -- concern, never a money or correctness one). Left as plain bigint by
  -- design; revisit if a later session wants the join enforced.
  ack_audit_answer_id bigint,
  delivery_audit_answer_id bigint,
  -- plain language, owner-readable (docs/05 "loud includes the operator") —
  -- also the source for the failed/unanswerable notification email body.
  failure_summary text,
  -- CORE-2's slice-estimation note when the ingested table was sliced down
  -- from the full dataset (design §4) — not money/correctness, diagnostic only.
  slice_note text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- One active (pending/running) request per (user, table) — asking about the
-- same missing topic twice while it's already in flight must not queue a
-- second onboarding or a second debit (design §2 "onboarding_already_pending").
create unique index pending_one_active_per_user_table
  on pending_table_requests (user_id, table_id) where status in ('pending', 'running');

-- The cron job's claim query scans exactly this shape (status='pending' order
-- by created_at) — see design §3 step 2.
create index pending_claimable on pending_table_requests (status, created_at);

-- --------------------------------------------------------------------------
-- Ledger widening (same migration, design §1): a new reason, 'onboarding_cost',
-- alongside 'question_cost' as a negative-delta, request_id-scoped debit.
-- Constraint names below match migration 005/008's auto-generated + explicit
-- names exactly (verified against a live PGlite `pg_catalog.pg_constraint`
-- query during this migration's own test) — dropping and re-adding by name
-- is required because Postgres has no ALTER CHECK.

-- The inline column CHECK in migration 005 (`reason text not null check (...)`)
-- was never given an explicit name, so Postgres auto-named it
-- "<table>_<column>_check". VERIFIED against PGlite: the constraint is named
-- credit_transactions_reason_check.
alter table credit_transactions drop constraint credit_transactions_reason_check;
alter table credit_transactions add constraint credit_transactions_reason_check
  check (reason in ('signup_grant', 'purchase', 'question_cost', 'compensation', 'onboarding_cost'));

alter table credit_transactions drop constraint credit_transactions_delta_sign;
alter table credit_transactions add constraint credit_transactions_delta_sign check (
  (reason in ('question_cost', 'onboarding_cost') and delta < 0) or
  (reason in ('signup_grant', 'purchase', 'compensation') and delta > 0)
);

alter table credit_transactions drop constraint credit_transactions_request_id_scope;
alter table credit_transactions add constraint credit_transactions_request_id_scope check (
  (reason in ('question_cost', 'onboarding_cost')) = (request_id is not null)
);

-- One onboarding debit per (user, request) — the triggerOnboarding
-- idempotency key (design §2/§8.2): a retried Server Action invocation must
-- never charge the 100 credits twice for the same chat turn. Mirrors
-- migration 005's credit_transactions_one_debit_per_request for question_cost.
create unique index credit_transactions_one_onboarding_per_request
  on credit_transactions (user_id, request_id) where reason = 'onboarding_cost';
