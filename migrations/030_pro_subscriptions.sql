-- 030 — Pro subscription tier (open-questions #205, ADR 006/020 revision
-- pending — docs/superpowers/specs/2026-09-13-pro-subscription-tier-design.md).
-- Two tables. `pro_subscriptions` is the Stripe-subscription mirror (one row
-- per Pro user, upserted from webhook events). `pro_bucket_ledger` is a
-- SEPARATE, isolated append-only ledger for the monthly credit allowance —
-- deliberately NOT a column/tag on `credit_transactions`: an earlier design
-- tried tagging existing rows, but a split debit (part bucket, part
-- permanent ledger) needs two physical rows sharing one (user_id,
-- request_id) idempotency key, which collides with every existing per-reason
-- unique index on that table (credit_transactions_one_debit_per_request and
-- its onboarding/websearch/dataset siblings). This table is structurally
-- identical in spirit (append-only, delta-sign CHECK, idempotent unique
-- indexes) but fully isolated, so `credit_transactions` needs ZERO schema
-- changes for this feature.

create table pro_subscriptions (
  user_id uuid primary key,
  stripe_customer_id text not null,
  stripe_subscription_id text not null unique,
  status text not null,
  current_period_end timestamptz not null,
  current_period_grant_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Amended before this migration was ever applied anywhere (Task 9 code
  -- review, #205): DISTINCT from `updated_at`, which stays ordinary
  -- "wall-clock time of the last DB write" (every other table in this
  -- codebase relies on that plain meaning, and Task 10's invoice.paid
  -- handler writes this same row too). `last_event_at` instead holds the
  -- Stripe EVENT's own `created` timestamp (unix seconds, top-level on
  -- every Stripe event, separate from any timestamp on the nested object)
  -- — the webhook handler's out-of-order-delivery guard
  -- (src/billing/stripe-webhook.ts's upsertProSubscription) only applies an
  -- incoming customer.subscription.* write when its event is >= the value
  -- stored here, so a stale/delayed event can never clobber newer state.
  -- `default now()` matches this table's other timestamp columns and keeps
  -- every direct test-fixture INSERT (which predates this column) working
  -- unchanged.
  last_event_at timestamptz not null default now()
);

-- Guarded FK to auth.users, conditional on the auth schema existing —
-- migration 026's exact pattern (itself migration 019's/005's). No `on
-- delete cascade`: redact-not-delete posture, same as every other user_id
-- table in this codebase.
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'auth' and table_name = 'users') then
    execute 'alter table pro_subscriptions add constraint pro_subscriptions_user_id_fkey
             foreign key (user_id) references auth.users(id)';
  end if;
end $$;

create table pro_bucket_ledger (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid not null,
  grant_id uuid not null,
  -- positive = granted or refunded back, negative = spent
  delta integer not null,
  reason text not null check (reason in ('grant', 'debit', 'compensation')),
  -- required for 'debit' (the caller's client-generated idempotency key,
  -- same contract as credit_transactions.request_id); null otherwise.
  request_id uuid,
  -- compensation -> the debit it reverses.
  related_entry_id bigint references pro_bucket_ledger(id),
  -- required for 'grant' — the Stripe invoice ID, so a retried invoice.paid
  -- webhook delivery never double-grants.
  stripe_invoice_id text,
  note text not null,

  constraint pro_bucket_ledger_delta_sign check (
    (reason = 'debit' and delta < 0) or
    (reason in ('grant', 'compensation') and delta > 0)
  ),
  constraint pro_bucket_ledger_request_id_scope check (
    (reason = 'debit') = (request_id is not null)
  ),
  constraint pro_bucket_ledger_invoice_scope check (
    (reason = 'grant') = (stripe_invoice_id is not null)
  ),
  constraint pro_bucket_ledger_related_scope check (
    (reason = 'compensation') = (related_entry_id is not null)
  )
);

do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'auth' and table_name = 'users') then
    execute 'alter table pro_bucket_ledger add constraint pro_bucket_ledger_user_id_fkey
             foreign key (user_id) references auth.users(id)';
  end if;
end $$;

create index pro_bucket_ledger_by_user_grant on pro_bucket_ledger (user_id, grant_id);
-- One grant per Stripe invoice — a retried invoice.paid delivery is a no-op.
create unique index pro_bucket_ledger_one_grant_per_invoice
  on pro_bucket_ledger (stripe_invoice_id) where reason = 'grant';
-- One debit per (user, client request) — mirrors
-- credit_transactions_one_debit_per_request exactly, in this table's own
-- namespace (no collision risk with the main ledger's indexes, since this
-- is a different table).
create unique index pro_bucket_ledger_one_debit_per_request
  on pro_bucket_ledger (user_id, request_id) where reason = 'debit';
-- One compensation per debit — mirrors credit_transactions_one_compensation_per_debit.
create unique index pro_bucket_ledger_one_compensation_per_debit
  on pro_bucket_ledger (related_entry_id) where reason = 'compensation';

-- Append-only, enforced structurally — same convention as credit_transactions
-- (migration 005): a financial trail, never mutated after the fact. Function
-- name, trigger name, clause order and the detailed exception message all
-- copy migration 005's exact shape rather than inventing a new one.
create function pro_bucket_ledger_no_mutation() returns trigger
language plpgsql
as $$
begin
  raise exception 'pro_bucket_ledger is append-only: % is not permitted (id=%, reason=%)',
    TG_OP, OLD.id, OLD.reason;
end;
$$;

create trigger pro_bucket_ledger_append_only
  before update or delete on pro_bucket_ledger
  for each row execute function pro_bucket_ledger_no_mutation();
