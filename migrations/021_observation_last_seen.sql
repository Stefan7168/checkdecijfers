-- #154 (design: docs/session-briefs/2026-07-19-154-design.md): per-cell
-- freshness truth for RETAINED cells. Under the #32 keep-and-count policy a
-- cell CBS stops publishing is kept, but the table-level last_sync_at bumps
-- on every successful sync — so a retained cell showed as freshly
-- reconfirmed forever and the staleness net never fired for it.
--
-- Track the EXCEPTION, not presence (write cost stays proportional to
-- retractions, never a full-table rewrite):
--   NULL (default; the implicit backfill state for every existing row) =
--     "present in this table's most recent successful sync" — the effective
--     synced-at date is cbs_tables.last_sync_at, exactly today's behavior.
--   NON-NULL = "retained cell: CBS stopped returning it; last provably
--     confirmed in this batch" — the effective date is that batch's
--     finished_at.
alter table observations
  add column last_seen_batch_id bigint references ingestion_batches(id);
