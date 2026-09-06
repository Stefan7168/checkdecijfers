-- 027 — dataset-attachments ledger widening (WP202a, ADR 037): dataset-chat
-- turns are charged via a SEPARATE ledger debit, reason 'dataset_cost',
-- reserved right before the LLM call in askDataset and settled by the
-- EXISTING compensate() primitive on a clarification/refusal/throw. This is
-- migration 018's exact shape (websearch_cost) with one extra decision
-- (D12, fixed in review): free CSV/TSV ingest is NOT a $0 price row — the
-- ledger's own CHECK (credits > 0) cannot represent that — it is
-- chargeAndRunDataset skipping the reserve call entirely for those source
-- kinds in code. src/billing/gate.ts and every existing ledger function stay
-- byte-untouched; the add-on rides ADDITIVE functions
-- (debitDataset/reserveDatasetDebit), same as WP16's onboarding_cost
-- (migrations 012+013) and WP129+130's websearch_cost (migration 018).
--
-- IMPORTANT — a review finding this migration must NOT repeat (D12, "Fixed
-- in review"): compensate()'s auditAnswerId parameter is a REAL foreign key
-- (credit_transactions.audit_answer_id references audit_answers(id),
-- migration 005). Dataset turns are NOT audit_answers rows (they live in
-- dataset_turns, migration 026) — every compensate() call reversing a
-- dataset_cost debit MUST pass auditAnswerId: null. Traceability back to
-- what was reversed goes through request_id/dataset_turns, never through
-- that column. This is an application-code discipline (src/billing/
-- dataset-gate.ts), not something this migration can enforce in SQL, but it
-- is recorded here because this migration is what makes the mistake
-- possible in the first place.
--
-- Constraint names below match migrations 005/006/008/012/018's exact names
-- (VERIFIED against a live PGlite pg_catalog query in this migration's own
-- test, tests/db/migration-027.test.ts, the migration-018 precedent) —
-- dropping and re-adding by name is required because Postgres has no ALTER
-- CHECK.
--
-- Deploy-order safety: nothing in the shipped code path reads any of this
-- until ATTACHMENTS_ENABLED is set in the supervised go-live window (the
-- ONBOARDING_ENABLED/WEBSEARCH_ENABLED dormancy pattern). Hermetic tests run
-- every migration file so PGlite has the schema.
--
-- Plain Postgres only — runs identically on Supabase and PGlite (ADR 009).

-- --------------------------------------------------------------------------
-- Ledger widening: a new reason, 'dataset_cost', alongside 'question_cost',
-- 'onboarding_cost' and 'websearch_cost' as a negative-delta,
-- request_id-scoped debit.

alter table credit_transactions drop constraint credit_transactions_reason_check;
alter table credit_transactions add constraint credit_transactions_reason_check
  check (reason in ('signup_grant', 'purchase', 'question_cost', 'compensation', 'onboarding_cost', 'websearch_cost', 'dataset_cost'));

alter table credit_transactions drop constraint credit_transactions_delta_sign;
alter table credit_transactions add constraint credit_transactions_delta_sign check (
  (reason in ('question_cost', 'onboarding_cost', 'websearch_cost', 'dataset_cost') and delta < 0) or
  (reason in ('signup_grant', 'purchase', 'compensation') and delta > 0)
);

alter table credit_transactions drop constraint credit_transactions_request_id_scope;
alter table credit_transactions add constraint credit_transactions_request_id_scope check (
  (reason in ('question_cost', 'onboarding_cost', 'websearch_cost', 'dataset_cost')) = (request_id is not null)
);

-- One dataset-turn debit per (user, request) — the reserveDatasetDebit
-- idempotency key, mirroring migration 012's
-- credit_transactions_one_onboarding_per_request and migration 018's
-- credit_transactions_one_websearch_per_request. NOTE: this covers
-- dataset-chat TURNS only, not ingest — v1's free CSV/TSV ingest never
-- reserves a debit at all (no row to be idempotent about), and a future
-- paid ingest kind gets its own guard when it's built (D12).
create unique index credit_transactions_one_dataset_per_request
  on credit_transactions (user_id, request_id) where reason = 'dataset_cost';

-- Widen the compensation guard (migration 008, widened by 013, 018, and
-- 023's #147 amount-bound guard) so a compensation may ALSO reverse a
-- 'dataset_cost' debit — the automatic refund path (a dataset-chat
-- clarification/refusal/throw) routes through the SAME compensate()
-- primitive every other refund uses. The user-match half AND the #147
-- over-credit bound are carried forward UNCHANGED; only the reason
-- allowlist widens once more.
--
-- ⚠ This is the exact mistake the design review found easy to make (D12,
-- "Fixed in review"): CREATE OR REPLACE FUNCTION replaces the WHOLE
-- function body, not just the allowlist line. Copying migration 018's body
-- (the last widening BEFORE 023's amount-bound guard existed) instead of
-- 023's would silently DELETE the #147 over-credit check the moment this
-- migration applied — proven by re-running tests/billing/ledger.test.ts's
-- #147 suite against this exact mistake during this migration's own
-- development (all three amount-bound tests failed the moment the older
-- body was used, caught before commit). The body below is 023's, verbatim,
-- with only the reason allowlist (both places it appears) widened.
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
    if debited.reason is null or debited.reason not in ('question_cost', 'onboarding_cost', 'websearch_cost', 'dataset_cost') then
      raise exception 'compensation (related_transaction_id=%) must reverse a question_cost, onboarding_cost, websearch_cost or dataset_cost row, found reason=%',
        new.related_transaction_id, coalesce(debited.reason, '<no such debit>');
    end if;
    -- #147 (migration 023), carried forward unchanged: the credited amount
    -- must never exceed the debit's own magnitude.
    if new.delta > -debited.delta then
      raise exception 'compensation delta (%) exceeds the debit it reverses (id=%, delta=%) -- a compensation must never credit more than it reverses',
        new.delta, new.related_transaction_id, debited.delta;
    end if;
  end if;
  return new;
end;
$$;

-- --------------------------------------------------------------------------
-- action_class_prices CHECK widening: 'dataset_ingest' (a future paid ingest
-- kind only — v1's free CSV/TSV path never looks this row up) and
-- 'dataset_turn' (every dataset-chat turn). Applied idempotently by
-- src/billing/pricing-apply.ts from src/billing/pricing-defaults.ts, the
-- same code-diff-not-SQL discipline as every other price (ADR 006: prices
-- are config). Migration 018's exact constraint name (itself migration
-- 006's auto-generated name).
alter table action_class_prices drop constraint action_class_prices_action_class_check;
alter table action_class_prices add constraint action_class_prices_action_class_check
  check (action_class in ('simple', 'analysis', 'heavy', 'clarification', 'web_addon', 'dataset_ingest', 'dataset_turn'));
