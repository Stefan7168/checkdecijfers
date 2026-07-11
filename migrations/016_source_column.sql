-- WP30a (ADR 030 D4): source identity on the two table-id-owning tables.
-- ADDITIVE and deploy-order-safe: WP30a code never reads these columns
-- (identity comes from the code-level source registry); they exist so the
-- global id space is collision-proof BEFORE any second source can register —
-- new sources use '<sourcekey>:<native-id>' ids, CBS keeps its bare legacy
-- ids, and the CHECK makes that convention a database fact, not a habit.
-- No FK, index, join, audit row or ledger reference changes (all additive).
alter table cbs_tables
  add column source text not null default 'cbs';
alter table cbs_tables
  add constraint cbs_tables_source_id_shape
  check (source = 'cbs' or id like source || ':%');

alter table cbs_catalog
  add column source text not null default 'cbs';
alter table cbs_catalog
  add constraint cbs_catalog_source_id_shape
  check (source = 'cbs' or table_id like source || ':%');

-- The one pre-existing source-ish column actively forbade a second value
-- (platform = 'v4'); widen it to "non-empty" — the meaningful constraint is
-- per-adapter, enforced by the WP30b conformance harness, not by SQL.
alter table cbs_tables
  drop constraint if exists cbs_tables_platform_check;
alter table cbs_tables
  add constraint cbs_tables_platform_check check (length(platform) > 0);
