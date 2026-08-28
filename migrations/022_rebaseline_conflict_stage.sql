-- 022: allow failure_stage 'rebaseline_conflict' (#34(c)(ii), session 66).
--
-- The rebaseline path now aborts loudly — instead of silently overwriting —
-- when a concurrent rebaseline committed a newer registry baseline between
-- this sync's pre-lock validation reads and its advisory-lock acquisition.
-- That abort is recorded on the batch as failure_stage 'rebaseline_conflict',
-- which 001's CHECK constraint (pinned to 'fetch' + the five ordered checks)
-- would reject; extend the allowed set.
--
-- Constraint name is the Postgres default for a column CHECK constraint,
-- created identically everywhere by 001_ingestion_schema.sql (verified on
-- PGlite; the apply is transactional, so a name mismatch on live would fail
-- loudly and change nothing).
alter table ingestion_batches
  drop constraint ingestion_batches_failure_stage_check;
alter table ingestion_batches
  add constraint ingestion_batches_failure_stage_check
  check (failure_stage in
    ('fetch', 'schema_fingerprint', 'row_plausibility', 'period_parsing',
     'dimension_mapping', 'unit_consistency', 'rebaseline_conflict'));
