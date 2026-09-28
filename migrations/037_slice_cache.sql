-- 037 — slice cache (breadth step 2, spec 2026-09-28-breadth-any-cbs-table-design.md D4).
-- ⚠ FILE-ONLY until the owner-supervised `npm run db:migrate`. Nothing in the
-- request path reads these objects until breadth step 5 wires them.
-- Plain Postgres only (ADR 009).

alter table cbs_tables
  add column ingest_mode text not null default 'full'
    check (ingest_mode in ('full', 'slice_cache')),
  -- slice-cache tables only: CBS 'Modified' of the schema + code lists we hold
  add column schema_cbs_modified timestamptz;

create table slice_fetches (
  id bigint generated always as identity primary key,
  table_id text not null references cbs_tables(id) on delete cascade,
  -- canonical JSON of the requested filter (sorted keys and code lists); the
  -- idempotency key for "this exact slice was fetched"
  filter_key text not null,
  filter jsonb not null,
  -- CBS 'Modified' of the table at fetch time: a newer CBS value makes the
  -- slice stale (ensureSlice refetches)
  cbs_modified timestamptz,
  row_count integer not null,
  -- on delete cascade: a slice claim without its batch has no provenance, and
  -- eviction (src/ingestion/eviction.ts) deletes ingestion_batches before
  -- cbs_tables — without the cascade that delete would hit this FK.
  batch_id bigint references ingestion_batches(id) on delete cascade,
  fetched_at timestamptz not null default now(),
  -- when CBS last CONFIRMED this slice: set on every successful fetch (insert
  -- and refetch) and moved forward by an ensureSlice cache hit (CBS Modified
  -- unchanged = these cells re-confirmed now). The query layer dates each
  -- served cell of a slice-cache table by the LATEST checked_at among the
  -- fetches covering it — cbs_tables.last_sync_at stays NULL for these tables,
  -- since one slice's fetch must never re-date another slice's cells (R4).
  checked_at timestamptz not null default now(),
  unique (table_id, filter_key)
);

create index slice_fetches_by_table on slice_fetches (table_id);

-- No explicit GRANT/RLS statements: migration 003's ALTER DEFAULT PRIVILEGES +
-- rls_auto_enable mechanism locks every table in this schema automatically
-- (same pattern as ingestion_batches and dimension_labels in migration 001,
-- and as documented in migration 026).

-- syncTable refuses a slice-cache table (a whole-table sync would bulk-ingest
-- a table registered precisely because it is too large or wide for that) and
-- records the refusal on its batch as failure_stage 'ingest_mode'. Extends the
-- allowed set exactly as 022 last defined it (copied from 022, the latest
-- redefinition of this constraint).
alter table ingestion_batches
  drop constraint ingestion_batches_failure_stage_check;
alter table ingestion_batches
  add constraint ingestion_batches_failure_stage_check
  check (failure_stage in
    ('fetch', 'schema_fingerprint', 'row_plausibility', 'period_parsing',
     'dimension_mapping', 'unit_consistency', 'rebaseline_conflict', 'ingest_mode'));
