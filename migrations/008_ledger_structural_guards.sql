-- 008 — two structural guards the WP13 adversarial review found missing
-- (ADR 020). Both close gaps where an invariant was previously enforced
-- only by convention (a single, currently-safe caller) or only by a JS-array
-- test, not by the database itself — the same "structural, never
-- pattern-based" standard this codebase already holds R1/R5 and the
-- append-only trigger to (migration 005).

-- Guard 1: a compensation row must reverse a debit belonging to the SAME
-- user, and that debit must actually be a question_cost row. Not reachable
-- through today's only caller (src/billing/gate.ts always passes the same
-- userId it just debited), but nothing in the schema stopped a future
-- caller (an admin refund tool, a hand-run fix) from crediting the wrong
-- account with no error.
create function credit_transactions_validate_compensation() returns trigger
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
    if debited.reason is distinct from 'question_cost' then
      raise exception 'compensation (related_transaction_id=%) must reverse a question_cost row, found reason=%',
        new.related_transaction_id, debited.reason;
    end if;
  end if;
  return new;
end;
$$;

create trigger credit_transactions_validate_compensation_trigger
  before insert on credit_transactions
  for each row execute function credit_transactions_validate_compensation();

-- Guard 2: the clarification price must never exceed the simple price
-- (src/billing/gate.ts computes simple-price-minus-clarification-price as a
-- compensation refund; a negative refund would either need a non-positive
-- compensation delta, forbidden by migration 005's CHECK, or silently
-- overcharge every clarification). This was previously only asserted by
-- tests/billing/pricing.test.ts against the hardcoded ACTION_CLASS_PRICES JS
-- array — docs/09-pricing.md itself documents a live `update
-- action_class_prices set credits = ...` as the normal, low-ceremony way to
-- change a price, which bypasses that JS-only test entirely. Re-reads both
-- rows fresh on every insert/update (substituting NEW for whichever row is
-- currently being written, since the other row's own SELECT cannot see this
-- statement's uncommitted change), so it holds regardless of which class is
-- edited or in what order — reprice 'clarification' down before (or in the
-- same transaction as) raising 'simple', not after.
create function action_class_prices_validate_clarification_price() returns trigger
language plpgsql
as $$
declare
  simple_price integer;
  clarification_price integer;
begin
  select credits into simple_price from action_class_prices where action_class = 'simple';
  select credits into clarification_price from action_class_prices where action_class = 'clarification';
  if new.action_class = 'simple' then
    simple_price := new.credits;
  end if;
  if new.action_class = 'clarification' then
    clarification_price := new.credits;
  end if;
  if simple_price is not null and clarification_price is not null and clarification_price > simple_price then
    raise exception 'clarification price (%) must never exceed the simple price (%) -- ADR 020 / docs/09-pricing.md',
      clarification_price, simple_price;
  end if;
  return new;
end;
$$;

create trigger action_class_prices_validate_trigger
  before insert or update on action_class_prices
  for each row execute function action_class_prices_validate_clarification_price();
