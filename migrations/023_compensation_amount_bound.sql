-- 023 — extend credit_transactions_validate_compensation (migrations 008,
-- widened by 013 and 018) to also bound a compensation's credited amount to
-- the debit it reverses (#147, session-47 hunt, closed session 66).
--
-- The trigger already asserts (a) same user and (b) a valid debited reason;
-- it never checked that the credited new.delta does not EXCEED the
-- magnitude of the debit being reversed (-debited.delta, since every debit
-- reason is CHECK-pinned to a negative delta — migrations 005/012/018). So
-- nothing in the schema stopped a future caller (an admin refund tool, a
-- hand-run fix, a feature that re-reads a price instead of the stored debit)
-- from over-crediting a compensation with no error.
--
-- NOT reachable through any caller today — verified by reading every live
-- call site, not assumed:
--   - src/billing/gate.ts compensates either `required` in full (a refusal)
--     or `required - clarifyPrice` (a clarification), both <= the debit's own
--     `required` magnitude.
--   - src/ingestion/onboarding.ts's refundOnboarding reads the STORED debit's
--     own delta (never a fresh price) and refunds exactly that.
--   - web/app/actions.ts's settleWebAddon reuses the SAME in-memory
--     webAddonPrice value for both the reserve and the compensate call.
-- This migration is defense-in-depth, the natural third guard alongside the
-- user-match and reason-allowlist checks migration 008 already made
-- structural "for a future admin refund tool" (that migration's own words).
--
-- CREATE OR REPLACE keeps migration 008's trigger binding intact (008 created
-- the trigger + function; 013 and 018 each replaced the function; this
-- replaces it once more) — same pattern as both those migrations.
--
-- Plain Postgres only — runs identically on Supabase and PGlite (ADR 009).
--
-- ⚠ LIVE APPLY STATUS (session 66): this file is committed but has NOT been
-- run against the live/production database — `npm run db:migrate` against
-- production is an explicitly owner-supervised step (CLAUDE.md) and stays
-- undone. Hermetic PGlite tests (tests/billing/ledger.test.ts) apply and
-- prove it via createTestDb(), which runs every migrations/*.sql file
-- automatically — that is the ONLY place this constraint is live today.

create or replace function credit_transactions_validate_compensation() returns trigger
language plpgsql
as $$
declare
  debited record;
begin
  if new.reason = 'compensation' then
    select user_id, reason, delta into debited from credit_transactions where id = new.related_transaction_id;
    if debited.user_id is distinct from new.user_id then
      raise exception 'compensation user_id (%) does not match the debit it reverses (id=%, user_id=%)',
        new.user_id, new.related_transaction_id, debited.user_id;
    end if;
    if debited.reason is null or debited.reason not in ('question_cost', 'onboarding_cost', 'websearch_cost') then
      raise exception 'compensation (related_transaction_id=%) must reverse a question_cost, onboarding_cost or websearch_cost row, found reason=%',
        new.related_transaction_id, coalesce(debited.reason, '<no such debit>');
    end if;
    -- #147: the credited amount must never exceed the debit's own magnitude.
    -- debited.delta is negative (the delta-sign CHECK pins every debit
    -- reason to delta < 0), so -debited.delta is the positive amount
    -- actually charged; new.delta (CHECK-pinned positive for 'compensation')
    -- may be anything up to and including that ceiling — a partial refund
    -- (e.g. gate.ts's simple-minus-clarification-price case) stays legal,
    -- only an OVER-credit is rejected.
    if new.delta > -debited.delta then
      raise exception 'compensation delta (%) exceeds the debit it reverses (id=%, delta=%) -- a compensation must never credit more than it reverses',
        new.delta, new.related_transaction_id, debited.delta;
    end if;
  end if;
  return new;
end;
$$;
