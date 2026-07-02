-- 001 — ingestion-side schema: table registry, observations, labels, batches.
-- Shape per ADR 002 (Postgres system of record, N-dimensional from day one) and
-- docs/05-data-rules.md (validation pipeline, correction-diff log, R11 status).
-- Answer-side tables (audit_answers) arrive with their own work package.
-- Plain Postgres only — runs identically on Supabase and PGlite (CI fixtures).

-- Registry: one row per CBS table in scope (docs/07-phase0-table-set.md).
create table cbs_tables (
  -- exact as-published CBS ID; casing is per-table and load-bearing (quirk #1),
  -- the adapter must never case-normalize
  id text primary key,
  title text not null,
  platform text not null default 'v4' check (platform = 'v4'),
  -- ordered [{ "name": ..., "kind": "Dimension"|"TimeDimension"|"GeoDimension" }],
  -- pinned at registration; the schema-fingerprint check verifies against this
  expected_dimensions jsonb not null,
  -- pinned default ("totaal") coordinate per dimension; content owned by the
  -- registry work package, nullable until then
  default_coordinates jsonb,
  -- per-grain period semantics (stand per 1 januari vs jaargemiddelde);
  -- content owned by the registry work package
  period_semantics jsonb,
  -- ingested slice, null = full table. Shape:
  -- { "dimensionEquals": {dim: code}, "dimensionPrefixes": {dim: [prefix,..]},
  --   "periodFloor": "2019JJ00" }
  slice jsonb,
  -- measure metadata as measured at first sync: { code: {unit, decimals, title} };
  -- the unit-consistency check compares later syncs against this
  units jsonb,
  -- row-plausibility tolerance vs previous sync (docs/05 assumption: default ±20%)
  row_count_tolerance numeric not null default 0.20,
  update_cadence text,
  -- sha256 over canonical {dimensions(name,kind), measure codes}; set at first
  -- successful sync, compared on every later sync (ADR 003 redesign defense)
  schema_fingerprint text,
  version integer not null default 1,
  status text not null default 'active' check (status in ('active', 'needs_review')),
  needs_review_reason text,
  last_sync_at timestamptz,
  -- row count of the last successful sync; input to the plausibility check
  last_row_count integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per sync attempt; the loud, owner-readable record of what happened.
create table ingestion_batches (
  id bigint generated always as identity primary key,
  table_id text not null references cbs_tables(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text not null default 'running'
    check (outcome in ('running', 'succeeded', 'failed')),
  -- which of the five ordered checks (or fetch) failed
  failure_stage text check (failure_stage in
    ('fetch', 'schema_fingerprint', 'row_plausibility', 'period_parsing',
     'dimension_mapping', 'unit_consistency')),
  -- plain-language summary the owner can read (docs/05: loud includes the operator)
  failure_summary text,
  row_count integer,
  rows_inserted integer,
  rows_updated integer,
  rows_unchanged integer,
  -- fetched rows previously present that this sync no longer returned (kept, logged)
  rows_missing integer,
  -- silent-retroactive-correction log: names exactly the changed cells
  -- [{measure, region_code, period_code, dims, old_value, new_value,
  --   old_status, new_status}] — the future scoop-alert / page-invalidation seam
  corrections jsonb,
  -- fingerprint computed this sync (compared against cbs_tables.schema_fingerprint)
  fingerprint text,
  -- true when the operator explicitly re-baselined (reviewed schema/code update)
  rebaselined boolean not null default false
);

-- The translation layer: (table, dimension, code) -> label. Codes stored trimmed
-- (quirk #2: v3 padding); measures are not dimensions and live in cbs_tables.units.
create table dimension_labels (
  table_id text not null references cbs_tables(id),
  dimension text not null,
  code text not null,
  label text not null,
  dimension_group text,
  -- Perioden codes carry CBS status (Definitief/Voorlopig/NaderVoorlopig);
  -- joined onto observations at ingest, feeds invariant R11
  status text,
  sort_index integer,
  primary key (table_id, dimension, code)
);

-- Long/narrow facts. Region and period are typed specializations of the generic
-- dimension mechanism (ADR 002); all other coordinates live in dims jsonb.
create table observations (
  id bigint generated always as identity primary key,
  table_id text not null references cbs_tables(id),
  measure text not null,
  -- '' when the table has no geo dimension (e.g. CPI) — not null keeps the
  -- natural key a plain column list
  region_code text not null default '',
  period_code text not null,          -- original CBS code, e.g. 2024JJ00
  period_grain text not null check (period_grain in ('JJ', 'KW', 'MM')),
  period_year integer not null,
  period_index integer,               -- KW 1-4 / MM 1-12, null for JJ
  -- non-geo, non-period coordinates, e.g. {"Geslacht": "T001038"}
  dims jsonb not null default '{}',
  value numeric,                      -- null only with a CBS reason (value_attribute)
  unit text not null,                 -- per-value unit metadata (invariant R10)
  decimals integer not null default 0,
  -- CBS period status: Definitief / Voorlopig / NaderVoorlopig (invariant R11)
  status text not null,
  -- CBS ValueAttribute; 'None' for plain values, otherwise the null/cell reason
  value_attribute text not null default 'None',
  batch_id bigint not null references ingestion_batches(id)
);

-- Natural key: one cell per (table, measure, full coordinate). Idempotency and
-- the correction diff both hinge on this.
create unique index observations_natural_key
  on observations (table_id, measure, period_code, region_code, dims);

-- Common lookup path for the query work package.
create index observations_by_period
  on observations (table_id, measure, period_year, period_grain);
