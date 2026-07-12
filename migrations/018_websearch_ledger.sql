-- 018 — web-search augmentation ledger widening (WP129+130, ADR 032): the
-- +10-credit add-on charged when the "Internet" source chip is on (#130) is a
-- SEPARATE ledger debit with its own reason, 'websearch_cost', reserved right
-- before the web API call and refunded via the EXISTING compensate() primitive
-- whenever no web section is delivered. This mirrors WP16's 'onboarding_cost'
-- exactly (migrations 012 + 013): a sibling request-scoped, negative-delta
-- debit, one per (user, request), reversible by a compensation — so
-- src/billing/gate.ts and every existing ledger function stay byte-untouched
-- (the add-on rides ADDITIVE functions, debitWebSearch/reserveWebSearchDebit).
--
-- Constraint names below match migrations 005/006/008/012's auto-generated +
-- explicit names exactly (VERIFIED against a live PGlite pg_catalog query in
-- this migration's own test, tests/db/migration-018.test.ts) — dropping and
-- re-adding by name is required because Postgres has no ALTER CHECK.
--
-- Deploy-order safety: nothing in the shipped code path reads any of this until
-- WEBSEARCH_ENABLED='1' (set only in the supervised go-live window AFTER this
-- migration + `npm run pricing:apply`), the ONBOARDING_ENABLED dormancy
-- pattern. Hermetic tests run every migration file so PGlite has the schema.
--
-- Plain Postgres only — runs identically on Supabase and PGlite (ADR 009).

-- --------------------------------------------------------------------------
-- Ledger widening: a new reason, 'websearch_cost', alongside 'question_cost'
-- and 'onboarding_cost' as a negative-delta, request_id-scoped debit. The three
-- CHECKs migration 012 widened for onboarding_cost widen once more — the auto-
-- generated reason CHECK name (migration 005) and the explicit delta-sign /
-- request_id-scope names, all re-added by 012 under the same names.

alter table credit_transactions drop constraint credit_transactions_reason_check;
alter table credit_transactions add constraint credit_transactions_reason_check
  check (reason in ('signup_grant', 'purchase', 'question_cost', 'compensation', 'onboarding_cost', 'websearch_cost'));

alter table credit_transactions drop constraint credit_transactions_delta_sign;
alter table credit_transactions add constraint credit_transactions_delta_sign check (
  (reason in ('question_cost', 'onboarding_cost', 'websearch_cost') and delta < 0) or
  (reason in ('signup_grant', 'purchase', 'compensation') and delta > 0)
);

alter table credit_transactions drop constraint credit_transactions_request_id_scope;
alter table credit_transactions add constraint credit_transactions_request_id_scope check (
  (reason in ('question_cost', 'onboarding_cost', 'websearch_cost')) = (request_id is not null)
);

-- One web-search debit per (user, request) — the reserveWebSearchDebit
-- idempotency key: a retried Server Action invocation must never charge the 10
-- credits twice for the same chat turn. Mirrors migration 012's
-- credit_transactions_one_onboarding_per_request. This is WHY the add-on must
-- be its OWN debit row: migration 005's credit_transactions_one_compensation_
-- per_debit keys ONE compensation per debit on related_transaction_id, so the
-- base question refund and the web add-on refund can only coexist for a single
-- turn when each reverses a distinct debit row.
create unique index credit_transactions_one_websearch_per_request
  on credit_transactions (user_id, request_id) where reason = 'websearch_cost';

-- Widen the compensation guard (migration 008, widened once by 013) so a
-- compensation may ALSO reverse a 'websearch_cost' debit — the automatic
-- refund path (ADR 032 decision 7) routes through the SAME compensate()
-- primitive the billing gate and the onboarding job already use. The user-match
-- half is UNCHANGED; only the reason allowlist widens from {question_cost,
-- onboarding_cost} to {question_cost, onboarding_cost, websearch_cost}. Both
-- are request-scoped negative-delta debits (the widened delta-sign and
-- request_id-scope CHECKs above already treat all three as siblings); a
-- compensation reversing any of them is exactly the honest refund shape.
-- CREATE OR REPLACE keeps migration 008's trigger binding intact (008 created
-- the trigger + function; 013 replaced the function; this replaces it once
-- more).
create or replace function credit_transactions_validate_compensation() returns trigger
language plpgsql
as $$
declare
  debited record;
begin
  if new.reason = 'compensation' then
    select user_id, reason into debited from credit_transactions where id = new.related_transaction_id;
    if debited.user_id is distinct from new.user_id then
      raise exception 'compensation user_id (%) does not match the debit it reverses (id=%, user_id=%)',
        new.user_id, new.related_transaction_id, debited.user_id;
    end if;
    if debited.reason is null or debited.reason not in ('question_cost', 'onboarding_cost', 'websearch_cost') then
      raise exception 'compensation (related_transaction_id=%) must reverse a question_cost, onboarding_cost or websearch_cost row, found reason=%',
        new.related_transaction_id, coalesce(debited.reason, '<no such debit>');
    end if;
  end if;
  return new;
end;
$$;

-- --------------------------------------------------------------------------
-- action_class_prices CHECK widening (ADR 032 decision 4): the new 'web_addon'
-- class holds the +10-credit add-on price, applied idempotently by
-- src/billing/pricing-apply.ts from src/billing/pricing-defaults.ts (the same
-- code-diff-not-SQL discipline as every other price). Migration 006's inline
-- column CHECK was never given an explicit name, so Postgres auto-named it
-- '<table>_<column>_check'. VERIFIED against PGlite:
-- action_class_prices_action_class_check.
alter table action_class_prices drop constraint action_class_prices_action_class_check;
alter table action_class_prices add constraint action_class_prices_action_class_check
  check (action_class in ('simple', 'analysis', 'heavy', 'clarification', 'web_addon'));
