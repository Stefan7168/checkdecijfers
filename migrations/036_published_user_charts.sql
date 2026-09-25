-- 036 — published_user_charts: a reader's own-data chart made public (ADR 057,
-- session 127). One row = one live publication of one dataset-turn chart by its
-- author. ⚠ FILE-ONLY until the owner-supervised `npm run db:migrate`; every
-- reader (src/attachments/publications.ts) probes for the table first, so the
-- code is deploy-order-safe. Unpublish and every redaction path HARD-DELETE the
-- row (it holds author text — the log's titles/notes and the source line — and
-- nothing any other table needs). Plain Postgres only (ADR 009).
create table published_user_charts (
  id bigint generated always as identity primary key,
  public_id text not null unique check (public_id ~ '^[A-Za-z0-9_-]{22}$'),
  user_id uuid not null,
  dataset_id bigint not null references user_datasets(id),
  dataset_turn_id bigint not null references dataset_turns(id),
  log jsonb not null,
  source_line text check (source_line is null or char_length(source_line) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index published_user_charts_turn_user on published_user_charts (dataset_turn_id, user_id);
create index published_user_charts_by_user on published_user_charts (user_id);

-- Guarded FK to auth.users — migration 026's exact pattern (itself 019's/005's).
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'auth' and table_name = 'users') then
    execute 'alter table published_user_charts add constraint published_user_charts_user_id_fkey
             foreign key (user_id) references auth.users(id)';
  end if;
end $$;
