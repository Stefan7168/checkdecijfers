-- 005 — credit ledger (WP13, ADR 006 seam 2 / ADR 020): append-only, never a
-- mutable balance column. Balance = SUM(delta) per user (src/billing/ledger.ts).
-- Business rules this schema makes STRUCTURAL, not just documented (docs/05's
-- "structural, never pattern-based" ethos, e.g. R1/R5):
--   - outright refusals cost 0 credits (full compensation back to 0):
--     enforced one layer up, in src/billing/gate.ts's compensate-on-non-answer
--     logic, not here.
--   - a clarification round costs the flat `clarification` class price from
--     pricing config, NOT 0 (reversed from the original assumption,
--     open-questions #58): free doorvragen let a user fish across unrelated
--     topics for nothing, which still costs real API spend. gate.ts debits
--     the estimated class up front and, if the outcome is a clarification,
--     compensates the difference down to the `clarification` price -- never
--     up, so that price must stay <= the cheapest answer-class price (see
--     migration 006), or a compensation row would need a non-positive delta,
--     which the CHECK constraint below forbids.
--   - credits never expire: no expiry column exists, by omission.
--   - append-only: a BEFORE UPDATE OR DELETE trigger raises, below.
--   - a reason's delta sign is fixed by a CHECK constraint, so a bug can never
--     write e.g. a positive question_cost or a negative signup_grant.
create table credit_transactions (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid not null,
  -- positive = credited, negative = spent
  delta integer not null,
  reason text not null check (reason in ('signup_grant', 'purchase', 'question_cost', 'compensation')),
  -- client-generated idempotency key for question_cost debits (one submit ->
  -- one UUID, threaded askQuestion/replyToClarification -> the billing gate).
  -- Without this, a Server Action re-invoked by a browser retry or a
  -- double-click would debit the same logical question twice.
  request_id uuid,
  -- best-effort link to the audit_answers row this entry pairs with. NEVER
  -- set on the initial question_cost debit (it necessarily precedes the
  -- pipeline call -- the whole point of debit-before-answer is to reserve the
  -- credit before the expensive step runs, so no audit row exists yet at
  -- that point); set on compensation rows once the pipeline's outcome (and
  -- its audit id) is known. This asymmetry is intentional, not an oversight.
  audit_answer_id bigint references audit_answers(id),
  stripe_checkout_session_id text,
  -- compensation -> the debit it reverses.
  related_transaction_id bigint references credit_transactions(id),
  -- short, reason-descriptive text ONLY -- never user content. Question text
  -- lives in exactly one place (audit_answers) per docs/04's GDPR seam (one
  -- retention enforcement point); copying it here would create a second one.
  note text not null,

  constraint credit_transactions_delta_sign check (
    (reason = 'question_cost' and delta < 0) or
    (reason in ('signup_grant', 'purchase', 'compensation') and delta > 0)
  ),
  constraint credit_transactions_request_id_scope check (
    (reason = 'question_cost') = (request_id is not null)
  ),
  constraint credit_transactions_stripe_scope check (
    (reason = 'purchase') = (stripe_checkout_session_id is not null)
  ),
  constraint credit_transactions_related_scope check (
    (reason = 'compensation') = (related_transaction_id is not null)
  )
);

create index credit_transactions_by_user on credit_transactions (user_id);

-- One signup grant per user, ever.
create unique index credit_transactions_one_signup_grant_per_user
  on credit_transactions (user_id) where reason = 'signup_grant';
-- One purchase per Stripe Checkout Session -- a retried webhook delivery
-- must never double-credit (src/billing/stripe-webhook.ts relies on this).
create unique index credit_transactions_one_purchase_per_session
  on credit_transactions (stripe_checkout_session_id) where reason = 'purchase';
-- One compensation per debit -- belt-and-braces against the gate wrapper
-- somehow being re-entered for the same debit (src/billing/gate.ts's own
-- request_id dedup is the primary defense; this is the structural backstop).
create unique index credit_transactions_one_compensation_per_debit
  on credit_transactions (related_transaction_id) where reason = 'compensation';
-- One debit per (user, client request) -- the actual fix for the double-debit-
-- on-retry risk: a repeated request_id is detected by src/billing/gate.ts
-- BEFORE it ever calls the answer pipeline a second time.
create unique index credit_transactions_one_debit_per_request
  on credit_transactions (user_id, request_id) where reason = 'question_cost';

-- Append-only, enforced structurally (not just "we don't call UPDATE/DELETE
-- in application code"): this is a financial trail, and the project's own
-- ethos elsewhere (R1/R5 in docs/05) is to make invariants structural.
create function credit_transactions_no_mutation() returns trigger
language plpgsql
as $$
begin
  raise exception 'credit_transactions is append-only: % is not permitted (id=%, reason=%)',
    TG_OP, OLD.id, OLD.reason;
end;
$$;

create trigger credit_transactions_append_only
  before update or delete on credit_transactions
  for each row execute function credit_transactions_no_mutation();

-- FK to Supabase's auth.users(id), added only when that schema exists: the
-- hermetic PGlite test database (ADR 009) has no `auth` schema at all, so an
-- unconditional FK would fail to even create the table there. Guarded the
-- same way migration 003 guards other Supabase-managed objects. Deliberately
-- NO `on delete cascade`: cascading a user's deletion into this ledger would
-- silently contradict "the ledger lives forever" (the whole point of an
-- append-only audit trail) the moment an account-deletion feature exists.
-- Default (no action) means a user row can't be deleted while ledger rows
-- reference it -- the real tension between GDPR erasure and an immutable
-- financial trail is left open on purpose (open-questions, this WP) rather
-- than silently resolved by picking cascade.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'auth' and table_name = 'users') then
    execute 'alter table credit_transactions add constraint credit_transactions_user_id_fkey foreign key (user_id) references auth.users(id)';
  end if;
end $$;

-- Singleton config row for the signup-grant amount. Lives in SQL (not
-- src/billing/pricing-defaults.ts like the rest of pricing config) because
-- grant_signup_credits() below runs INSIDE Postgres, triggered by an
-- auth.users insert -- it has no way to consult application code. Still kept
-- easy to change (ADR 006's "prices must be easy to change"): a plain UPDATE,
-- and src/billing/pricing-apply.ts also upserts this row from
-- SIGNUP_GRANT_CREDITS so one code constant stays the source of truth for
-- anyone tuning it later.
create table signup_grant_config (
  singleton boolean primary key default true check (singleton),
  credits integer not null
);
-- 100 credits = 5 free 'simple' questions at the launch pricing scale
-- (simple = 20 credits, migration 006 / open-questions #4) -- the same real
-- value as the original 5-credit grant before the whole scale widened x20.
insert into signup_grant_config (credits) values (100);

-- security definer + search_path pinning per Supabase's documented pattern for
-- functions that write on a new user's behalf (SQL injection defense: every
-- reference below is schema-qualified since search_path is empty). Idempotent
-- by construction (on conflict do nothing against the partial unique index
-- above) -- Supabase's own guidance warns a *throwing* auth trigger can block
-- real signups, so this must never raise on a duplicate call.
create function public.grant_signup_credits(p_user_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.credit_transactions (user_id, delta, reason, note)
  select p_user_id, credits, 'signup_grant', 'one-time signup grant'
  from public.signup_grant_config
  on conflict (user_id) where reason = 'signup_grant' do nothing;
end;
$$;

-- Thin trigger function (kept separate from grant_signup_credits so the
-- grant logic is hermetically callable directly in tests, with no auth.users
-- row required).
create function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.grant_signup_credits(new.id);
  return new;
end;
$$;

-- Guarded exactly like the FK above -- live-only, a safe no-op on PGlite.
-- Verified manually once a real signup happens (RUNBOOK, live-wiring pass).
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'auth' and table_name = 'users') then
    execute 'create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user()';
  end if;
end $$;
