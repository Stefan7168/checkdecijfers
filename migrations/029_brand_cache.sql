-- 029 — brand_cache (WP218 phase 3, ADR 039). ⚠ FILE-ONLY until the
-- owner-supervised apply (migrations 016/017/019/026/028 precedent) — rides
-- the same `npm run db:migrate` as 028, applied in the same session. Public
-- brand facts (name/colours/fonts) keyed by domain, fetched from Brandfetch;
-- kept ≤ 30 days (Brandfetch's own terms) — src/chart/brand-cache.ts's
-- reader treats an older row as absent rather than trusting it stale. NOT
-- personal data (no user column, no GDPR retention leg needed — see that
-- module's own header). No GRANT/RLS here: migration 003's rls_auto_enable
-- locks every later table (same note as 011/012/017/018/019/026/028). Plain
-- Postgres only — identical on Supabase and PGlite (ADR 009).
create table brand_cache (
  domain text primary key check (domain ~ '^[a-z0-9.-]{1,253}$'),
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);
