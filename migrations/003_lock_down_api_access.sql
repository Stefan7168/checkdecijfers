-- 003 — lock down the Supabase Data API: this project is accessed exclusively
-- via server-side `pg` over DATABASE_URL (ADR 002/003) — the auto-generated
-- PostgREST Data API (the `anon`/`authenticated` roles) is never used by this
-- app and must never see our tables.
--
-- Fixes a real exposure found 2026-07-03: Supabase's project-level
-- "Automatically expose new tables" setting was on, so every table created by
-- migrations 001-002 was granted full CRUD (SELECT/INSERT/UPDATE/DELETE/...)
-- to both `anon` (unauthenticated) and `authenticated`. In practice this was
-- NOT exploitable: Supabase's own `rls_auto_enable()` safety net had already
-- enabled row level security on each table with zero policies, which blocks
-- all access for non-owner roles regardless of the underlying grants. But
-- relying on "RLS is on and nobody has added a policy yet" as the *only*
-- defense is fragile — a single future `create policy` statement (even an
-- unrelated, well-intentioned one) would make the wide-open grants live.
-- This migration removes the grants themselves (defense in depth) and sets
-- default privileges so tables created by future migrations don't inherit
-- them either. The dashboard toggle itself (Settings -> API -> Data API ->
-- "Automatically expose new tables") is a project-level setting this
-- migration cannot reach — the owner must also turn it off (docs/RUNBOOK.md).
--
-- Also found: Supabase's own `rls_auto_enable()` event-trigger function
-- (the mechanism behind the RLS-auto-enable safety net above — fires on
-- every CREATE TABLE, runs `alter table ... enable row level security`)
-- had EXECUTE granted to PUBLIC, Postgres's default for newly created
-- functions. Revoking it is safe: event triggers fire via the engine, not
-- through a caller's EXECUTE privilege, so this doesn't disable the
-- protection — it just stops it being directly callable over the Data API.
--
-- Guarded by role existence: `anon`/`authenticated` and this function are
-- Supabase-managed and don't exist on the hermetic PGlite test database
-- (ADR 009) — this must stay a safe no-op there, never an error.
do $$
declare
  target_role text;
begin
  foreach target_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = target_role) then
      execute format('revoke all on all tables in schema public from %I', target_role);
      execute format('revoke all on all sequences in schema public from %I', target_role);
      execute format('revoke all on all functions in schema public from %I', target_role);
      execute format(
        'alter default privileges for role %I in schema public revoke all on tables from %I',
        current_user, target_role
      );
      execute format(
        'alter default privileges for role %I in schema public revoke all on sequences from %I',
        current_user, target_role
      );
      execute format(
        'alter default privileges for role %I in schema public revoke all on functions from %I',
        current_user, target_role
      );
    end if;
  end loop;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    execute 'revoke execute on function public.rls_auto_enable() from public';
  end if;
end $$;
