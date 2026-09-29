-- 038 — table-lane job requests (breadth step 5, "wire the table lane into chat").
-- ⚠ FILE-ONLY until the owner applies it with `npm run db:migrate`, together
-- with 037 (slice cache). Nothing in the request path reads this table until
-- the TABLE_LANE_ENABLED flag is switched on.
--
-- One row = one reader question the table lane is answering from a CBS table
-- that is not (fully) in our database: the background job claims it, makes sure
-- the needed slice is stored, runs the deterministic query, and writes an
-- audited answer/question/refusal into the reader's thread. The row also
-- carries the question price the reader paid up front, so the job can settle
-- it (keep / partial refund / full refund) in the SAME transaction that ends
-- the row — a row can never be finished and unsettled, or settled twice.
--
-- Column types follow the ledger, not audit_answers: user_id is uuid (joins
-- credit_transactions.user_id, like pending_table_requests, migration 012);
-- chat_threads.id, audit_answers.id and credit_transactions.id are all bigint.
--
-- Money: the debit is an ordinary question_cost debit (no ledger constraint
-- changes) whose ledger request id is DERIVED from request_id
-- (deriveAddonRequestId(request_id, 'table-lane')) — the routing turn's own
-- question_cost debit for the same request id is already in the ledger
-- (debited, then refunded by the gate), and question_cost is unique per
-- (user_id, request_id). The debit can be funded by the Pro monthly bucket
-- (src/billing/ledger.ts splitDebit): the bucket leg lives in pro_bucket_ledger,
-- so debit_transaction_id (the credit_transactions leg) is NULL when the bucket
-- covered the whole price, and the split is recorded here so the settlement can
-- reverse exactly what was taken, bucket first.
--
-- Plain Postgres only — runs identically on Supabase and PGlite (ADR 009).
-- No GRANT/RLS statements: migration 003's default privileges + auto-RLS lock
-- every later table automatically.

create table table_lane_requests (
  id bigserial primary key,
  user_id uuid not null,
  -- the chat turn's client-generated request id; (user_id, request_id) is the
  -- idempotency key, so a retried submit can never queue or charge twice
  request_id text not null,
  thread_id bigint references chat_threads(id) on delete set null,
  lang text not null check (lang in ('nl','en')),
  -- free text of the reader's question: the GDPR retention/erasure code
  -- (src/answer/audit/retention.ts) deletes terminal rows with the audit rows
  question text not null,
  table_id text not null,
  finder_confidence double precision not null,
  -- set for a button reply / follow-up that continues an earlier lane row
  parent_id bigint references table_lane_requests(id) on delete set null,
  -- true for a button/typed REPLY to a lane question (parent = a clarification
  -- row); false for a first question or a follow-up (parent = an answer row).
  -- A clarification has at most ONE reply child (unique index below), so a
  -- retried or second-tab reply can never queue or charge a second child.
  -- Follow-ups are not limited: one answer may legitimately be followed up
  -- more than once (e.g. from two tabs).
  is_reply boolean not null default false,
  -- the free, gate-refunded routing turn (the audited 'onboarding_pending'
  -- refusal) that queued this row; NULL for replies (no routing turn) and
  -- when that turn went unrecorded (fail-closed). The routing turn is not
  -- attached to a thread (the job attaches the lane's own answer), so this
  -- stored link is what the question history uses to hide it (it would
  -- otherwise list the question twice, with the onboarding wait text) and
  -- what per-conversation deletion uses to redact it.
  routing_audit_id bigint references audit_answers(id) on delete set null,
  previous_question text,
  -- accumulated reader answers to breakdown/region questions:
  -- [{ "dimension": "...", "code": "..." }]
  choices jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending','running','done','failed')),
  attempts integer not null default 0,
  -- the question debit this row spends. credit_transactions leg: NULL when the
  -- Pro bucket paid the whole price. Bucket leg + amounts below.
  debit_transaction_id bigint references credit_transactions(id),
  debit_bucket_entry_id bigint references pro_bucket_ledger(id),
  debit_from_bucket integer not null default 0 check (debit_from_bucket >= 0),
  debit_from_ledger integer not null default 0 check (debit_from_ledger >= 0),
  audit_id bigint references audit_answers(id) on delete set null,
  outcome_kind text check (outcome_kind in ('answer','clarification','refusal')),
  failure_summary text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique (user_id, request_id),
  -- a row cannot exist without a debit behind it
  constraint table_lane_requests_has_debit check (
    debit_transaction_id is not null or debit_bucket_entry_id is not null
  )
);

-- the claim query scans only open rows, oldest first
create index table_lane_requests_open on table_lane_requests (status, created_at)
  where status in ('pending','running');

-- at most one reply child per lane question (see is_reply above); the store
-- also checks this under the user's advisory lock and returns the existing
-- child, so this index is the belt, not the mechanism
create unique index table_lane_requests_one_reply on table_lane_requests (parent_id)
  where is_reply and parent_id is not null;

-- the history scan and per-conversation deletion look rows up by their
-- routing turn
create index table_lane_requests_routing_audit on table_lane_requests (routing_audit_id)
  where routing_audit_id is not null;
