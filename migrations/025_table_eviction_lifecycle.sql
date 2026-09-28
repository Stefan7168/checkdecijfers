-- 025 — on-demand table lifecycle metadata (#110 b/c, WP16 sub-part 2 follow-on).
-- On-demand-onboarded tables are a TTL cache ABOVE the permanent seed-table
-- mirror (open-questions #110); these two columns are what the eviction GC
-- (src/ingestion/eviction.ts, scripts/table-eviction.ts) reads.
--
-- pinned — the eviction exemption (#110 c). TRUE for the curated seed set (the
-- permanent catalog mirror), FALSE for on-demand-onboarded tables (WP16). The
-- flag is EXPLICIT rather than derived: inferring "on-demand" by joining
-- pending_table_requests breaks the moment GDPR redaction clears a terminal
-- row's table identity to the 'REDACTED' sentinel (#151), so provenance must
-- live on the table row itself. Going forward the registration paths set it
-- (`ingest register` pins, the onboarding job registers unpinned — see
-- registerTables' pinned option in src/ingestion/pipeline.ts).
alter table cbs_tables
  add column pinned boolean not null default false;

-- last_queried_at — when an answer/follow-up/chart read last used this table
-- (#110 b). Bumped by the query executor (src/query/run.ts), DEBOUNCED to at
-- most one write per table per day, so a popular table costs ~1 row write/day,
-- not one per answer. NULL = never queried since tracking began; the eviction
-- anchor is coalesce(last_queried_at, created_at) (src/ingestion/eviction.ts),
-- so a never-queried row falls back to its registration moment.
alter table cbs_tables
  add column last_queried_at timestamptz;

-- Pin the curated seed set as registered before this migration. #110 says
-- "pin the 8 seed tables"; that row predates the coverage sprint (session 50)
-- — the principle is "the curated permanent set is eviction-exempt", which is
-- ALL of SEED_TABLES (src/ingestion/registry-seed.ts: 8 Phase 0 + 9 coverage
-- tables). This list is a snapshot for databases that registered seeds before
-- the migration existed; fresh registrations get pinned by the code path, and
-- a drift test (tests/ingestion/eviction.test.ts) pins this list against
-- SEED_TABLES. Casing is exact-as-published and load-bearing (catalog quirk
-- #1: 03759ned and 80590ned are genuinely lowercase).
update cbs_tables set pinned = true where id in (
  '03759ned', '86141NED', '85224NED', '82235NED', '85773NED', '82242NED',
  '83932NED', '82610NED',
  '83693NED', '85770NED', '85880NED', '85828NED', '85937NED', '85429NED',
  '85792NED', '80590ned', '83625NED'
);

-- TTL-clock initialization for every PRE-EXISTING row: query history before
-- this migration was never tracked, so "when was this table last queried" is
-- UNKNOWABLE for them. Treat every existing table as "in use as of the
-- migration" rather than guessing staleness from data we do not have —
-- principle (c) applied to lifecycle: a destructive sweep must never act on a
-- guess. Concretely: every pre-existing on-demand table gets a fresh 30-day
-- clock from the moment this migration applies. Rows registered AFTER this
-- migration start at NULL and anchor on created_at until first queried.
update cbs_tables set last_queried_at = now();
