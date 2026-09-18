-- 035 — chart_edits for own-data charts (session 113, chart co-pilot phase 2,
-- ADR 056 decision 4 + ADR 037 addendum). A reader's own-data chart lives on a
-- dataset_turns row, not an audit_answers row, so chart_edits gains a second,
-- mutually exclusive key. ⚠ FILE-ONLY until the owner-supervised apply (034
-- precedent — apply 034 and 035 in one `npm run db:migrate`). Deploy-order-
-- safe: src/chart/edits-store.ts treats an absent column as "no edits yet".
-- Plain Postgres only — identical on Supabase and PGlite (ADR 009).
--
-- Reordered from the brief's literal statement order (same end state):
-- Postgres refuses to DROP NOT NULL on a column that is still part of the
-- primary key ("column ... is in a primary key"), so the old pkey has to go
-- first, then the not-null on audit_answer_id, then the rest as given.
alter table chart_edits drop constraint chart_edits_pkey;
alter table chart_edits alter column audit_answer_id drop not null;
alter table chart_edits add column dataset_turn_id bigint references dataset_turns(id);
alter table chart_edits add constraint chart_edits_one_key
  check ((audit_answer_id is null) <> (dataset_turn_id is null));
alter table chart_edits add column id bigint generated always as identity primary key;
create unique index chart_edits_answer_user on chart_edits (audit_answer_id, user_id) where audit_answer_id is not null;
create unique index chart_edits_turn_user on chart_edits (dataset_turn_id, user_id) where dataset_turn_id is not null;
