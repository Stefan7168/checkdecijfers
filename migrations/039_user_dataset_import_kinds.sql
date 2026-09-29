-- 039 — more ways to bring your own data (session 146).
-- Widens user_datasets.source_kind so the new import routes are recorded
-- honestly instead of being filed under a wrong kind:
--   file_ods    OpenDocument spreadsheet upload
--   file_json   JSON table upload
--   paste_text  a table pasted straight into the chat box
--   url_gsheet  a Google Sheet read from a "anyone with the link" share link
-- Additive only: every existing row keeps a value the new check still allows.
-- The constraint name is the one Postgres generated for migration 026's inline
-- check (`<table>_<column>_check`).
alter table user_datasets drop constraint if exists user_datasets_source_kind_check;
alter table user_datasets add constraint user_datasets_source_kind_check
  check (source_kind in ('file_csv', 'file_tsv', 'file_xlsx', 'file_ods', 'file_json',
                         'paste_text', 'url_gsheet', 'url_html', 'file_pdf'));
