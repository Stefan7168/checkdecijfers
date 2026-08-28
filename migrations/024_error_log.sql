-- 024 — error_log: durable, insert-only production error logging (#65 / WP25).
--
-- Why this table exists. A live production error once left ZERO trace: it
-- failed before the billing gate (no audit row, no ledger debit) and Vercel's
-- short log retention had already rotated the stack trace away by the time
-- anyone looked (session 18, 2026-07-04 — #65's origin). This table is the
-- durable place a catch site writes what Vercel forgets.
--
-- Write sites (web layer, via web/lib/error-report.ts → src/db/error-log.ts):
-- the outermost catch blocks of the askQuestion / replyToClarification Server
-- Actions, the Stripe webhook route, the auth callback, and the #114 health
-- route. `source` is deliberately UNCHECKED text: a future catch site must not
-- need a migration to name itself.
--
-- FAIL-OPEN, the reverse of the audit store's fail-closed rule (R8), and
-- deliberately so: R8 withholds answers when the audit write fails because an
-- unrecorded answer must never be shown; error logging NEVER withholds or
-- alters anything — a broken logger must not break the product path, and a
-- failed write here must never mask the original error it was recording
-- (src/db/error-log.ts swallows its own failures after console-logging them).
--
-- NO personal data, structurally. `context` is bounded, structured jsonb and
-- NEVER carries raw question or answer text — this table has none of the GDPR
-- redaction machinery audit_answers has, so it must never need it. What was
-- being processed is referenced by request_id (joins to credit_transactions/
-- audit_answers, both uuid — migrations 005/010), never by content. user_id
-- carries NO foreign key on purpose: a log row must always be writable (an
-- auth-callback failure has no user yet; an FK violation would kill the one
-- write that explains an incident), and joins to auth.users are by value.
--
-- Retention: 90 days (WP25 brief's suggested default, adopted 2026-08-27,
-- session 66 — an ops log, not a user-facing record), enforced by the SAME
-- retention job as the GDPR sweeps (src/answer/audit/retention-job.ts,
-- `npm run gdpr:purge` / the /api/gdpr-purge-cron route): expired rows are
-- DELETED, not redacted — nothing references them (the trial_questions
-- 90-day precedent, ADR 036 D4). Until this migration's supervised live
-- apply, the job reports the leg as skipped: 'table-absent' — expected, not
-- an incident.
--
-- INSERT-only from the app: no code path updates or deletes rows (the
-- retention job's DELETE is the one exception). Access: owner-only via
-- SQL/dashboard; no UI in v1 (WP25 brief).
--
-- ⚠ FILE-ONLY until the owner-supervised apply (house rule, migrations
-- 016/017/019/020 precedent). Deploy-order-safe WITHOUT a flag: every write
-- site is fail-open, so until the supervised `npm run db:migrate` the writes
-- fail silently into console.error — exactly today's behavior.
--
-- No GRANT/RLS statements needed: migration 003's ALTER DEFAULT PRIVILEGES +
-- rls_auto_enable mechanism locks every later table automatically (same note
-- as migrations 011/012/017/018/019/020) — zero anon/authenticated grants;
-- the supervised apply live-verifies grants/RLS as usual.
--
-- Plain Postgres only — runs identically on Supabase and PGlite (ADR 009).

create table error_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  -- Which code path caught it: 'askQuestion' | 'replyToClarification' |
  -- 'stripe-webhook' | 'auth-callback' | 'health' today; unchecked by design.
  source text not null,
  -- The client idempotency key when one exists and parses as a uuid — joins
  -- to credit_transactions.request_id / audit_answers.request_id when the
  -- failure happened mid-flight. A non-uuid value (a crafted client can send
  -- any string) is preserved in `context` instead so the insert can never
  -- fail on a type mismatch (src/db/error-log.ts guards this).
  request_id uuid,
  user_id uuid,
  message text not null,
  stack text,
  -- Bounded, structured extras (src/db/error-log.ts caps the serialized
  -- size). NEVER raw question/answer text — see the header.
  context jsonb
);

-- The retention sweep and the owner's "what broke recently" query both walk
-- time; source filtering can ride the same scan at this table's volume.
create index error_log_by_time on error_log (occurred_at desc);
