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
  batch_id bigint references ingestion_batches(id),
  fetched_at timestamptz not null default now(),
  unique (table_id, filter_key)
);

create index slice_fetches_by_table on slice_fetches (table_id);

-- No explicit GRANT/RLS statements: migration 003's ALTER DEFAULT PRIVILEGES +
-- rls_auto_enable mechanism locks every table in this schema automatically
-- (same pattern as ingestion_batches and dimension_labels in migration 001,
-- and as documented in migration 026).
