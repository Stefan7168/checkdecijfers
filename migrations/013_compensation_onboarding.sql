-- 013 — widen the compensation guard so it can also reverse an
-- 'onboarding_cost' debit (WP16 sub-part 2, ADR 026). The onboarding job
-- refunds the 100-credit fetch charge on any verification failure / fetch
-- error / unanswerable delivery via the SAME compensate() primitive the
-- billing gate uses for question refunds (ADR 026 decision 2: "refund on
-- verification failure is already solved, not new policy" — route failure
-- through the existing mechanism). But migration 008's
-- credit_transactions_validate_compensation trigger only permits a
-- compensation to reverse a 'question_cost' row and raises otherwise, so a
-- compensate() against the onboarding debit would throw before this migration
-- (proven by tests/billing/ledger.test.ts's "verification failure later" case
-- authored in SCAFFOLD, which asserted the throw to surface the gap rather
-- than hide it).
--
-- Drop + re-create the trigger function (Postgres CREATE OR REPLACE FUNCTION
-- would also work, but a drop-and-recreate keeps this migration's shape
-- identical to migration 008's own CREATE and reads as one intentional edit).
-- The user-match half of the guard is UNCHANGED — only the reason allowlist
-- widens from {question_cost} to {question_cost, onboarding_cost}. Both are
-- request-scoped negative-delta debits (migration 012's widened delta-sign
-- and request_id-scope CHECKs already treat them as siblings); a compensation
-- reversing either is exactly the honest refund shape.
--
-- Plain Postgres only — runs identically on Supabase and PGlite (ADR 009).

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
    -- Widened for WP16 sub-part 2: a compensation may reverse EITHER a
    -- question_cost or an onboarding_cost debit (both are request-scoped
    -- negative-delta charges). Any other reason is still an error — a
    -- compensation must reverse a real charge, never a grant/purchase.
    if debited.reason is null or debited.reason not in ('question_cost', 'onboarding_cost') then
      raise exception 'compensation (related_transaction_id=%) must reverse a question_cost or onboarding_cost row, found reason=%',
        new.related_transaction_id, coalesce(debited.reason, '<no such debit>');
    end if;
  end if;
  return new;
end;
$$;

-- --------------------------------------------------------------------------
-- audit_answers.source_tag widening (design §3.7 VERIFY, resolved): the fetch
-- job's delivery re-run writes an audit row tagged 'onboarding_delivery' so
-- reporting/retention can tell an out-of-band delivered answer apart from a
-- live chat turn. Migration 007's inline column CHECK
-- (audit_answers_source_tag_check) only allowed benchmark/validation/user, so
-- an insert of the new tag would violate it — drop + re-add by the
-- auto-generated name (same drop-and-re-add-by-name pattern migration 012 used
-- for the ledger CHECKs; there is no ALTER CHECK in Postgres).
alter table audit_answers drop constraint audit_answers_source_tag_check;
alter table audit_answers add constraint audit_answers_source_tag_check
  check (source_tag in ('benchmark', 'validation', 'user', 'onboarding_delivery'));
