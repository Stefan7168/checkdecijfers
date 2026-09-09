-- 028 — user_chart_styles + chart_style_usage (WP218 phases 2 + 6, ADR 039).
-- ⚠ FILE-ONLY until the owner-supervised apply (migrations 016/017/019/026
-- precedent). Deploy-order-safe: every reader/writer in src/chart/user-styles.ts
-- treats an absent table as "no default" / "not possible right now".
-- user_chart_styles is PERSONAL DATA from this commit on (ADR 033's rule): it
-- joins the retention job in the same change (retention-job.ts chartStyles leg,
-- self-service delete, account-level wipe). No GRANT/RLS here: migration 003's
-- rls_auto_enable locks every later table (same note as 011/012/017/018/019/026).
-- Plain Postgres only — identical on Supabase and PGlite (ADR 009).
create table user_chart_styles (
  user_id uuid primary key,
  style jsonb not null,
  brand jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'auth' and table_name = 'users') then
    execute 'alter table user_chart_styles add constraint user_chart_styles_user_id_fkey
             foreign key (user_id) references auth.users(id)';
  end if;
end $$;
create index user_chart_styles_by_updated on user_chart_styles (updated_at);

-- Anonymous usage counter (open-questions #220): event × day × count. No user
-- id, no IP, nothing per person — a tally, not a log.
create table chart_style_usage (
  event text not null check (event ~ '^[a-z_]{1,40}$'),
  day date not null,
  count integer not null default 0 check (count >= 0),
  primary key (event, day)
);
