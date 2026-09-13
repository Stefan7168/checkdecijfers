# Design note — the Pro-owner-email lookup that lets Live embeds activate

**Date:** 2026-09-12. **Context:** ADR [041](../decisions/041-public-embed-pages.md) decision point 10 / revisit trigger
"The Pro-owner-email lookup" / [open-questions #224](../open-questions.md). Today `web/app/embed/[token]/page.tsx`
calls `hasProPlan({ id: record.userId ?? '', email: null })` unconditionally, so `?live=1` can never activate for
anyone: there is no way in this codebase to resolve an embed row's OWNER (`record.userId`, a Supabase auth user id)
to that owner's email at render time, days or weeks after they were last signed in.

## Options considered

1. **A Supabase admin/service-role client.** `supabase.auth.admin.getUserById(id)` via a client built from
   `SUPABASE_SERVICE_ROLE_KEY`. Works, and is Supabase's own documented mechanism for this exact lookup. Rejected
   for now: it is a brand-new privileged secret (RLS-bypassing, can read/write any user's data, any table) sitting
   behind exactly one narrow read; provisioning and rotating it is real operational weight for a demo-tier gate.
   ADR 041 already rejected this once (Alternatives/Consequences) for the same reason.

2. **A mirrored `email` column on a public table, kept in sync by a trigger on `auth.users`.** Avoids a new secret,
   but is a schema change (migration, a trigger on a table this app doesn't own) and creates a SECOND stored copy of
   personal data (an email address) that the GDPR retention/purge machinery (#189, `npm run gdpr:purge`) does not
   know about today — a new place a stale or orphaned email can linger past a user's deletion. Rejected: real
   ongoing cost (schema, trigger maintenance, a second purge target) for a lookup this small.

3. **Read `auth.users.email` through the existing pg pool.** The app already opens exactly one Postgres connection
   type — `DATABASE_URL`, the same Supabase Postgres project, via `src/db/client.ts`'s pooled `pg.Pool` — and
   `auth.users` is an ordinary table inside that same database (Supabase's own GoTrue auth schema, not a separate
   service). One parameterised, read-only `select email from auth.users where id = $1`, fail-closed to `null` on
   ANY error (schema absent, privilege denied, malformed id), needs no new secret, no schema change, and copies no
   personal data anywhere new — the value is read and discarded within the same request, never stored.

## Recommendation

Option 3. It is the cheapest viable mechanism (CLAUDE.md's "default to the cheapest viable mechanism first" rule):
no AI call, no schema/DB change, no added cost, no new secret — a single indexed primary-key read against data the
app's own connection can already see. Options 1 and 2 both add real, ongoing surface (a privileged credential, or a
second copy of personal data plus a purge gap) for a gate that today serves exactly one owner-set demo allowlist
(`PRO_ACCOUNT_EMAILS`), and both can still be adopted later without changing anything else in the embed feature —
`hasProPlan`'s own contract does not change either way.

## Residual risks (mark and confirm)

- **Assumption:** the pooler role backing `DATABASE_URL` (Supabase's session-mode pooler, per `src/db/client.ts`'s
  own header comment) can `SELECT` from `auth.users`. On Supabase this is normally true — the `postgres` role (and
  the pooler roles built from it) has read access to the `auth` schema by default, since GoTrue itself runs as
  Postgres functions/triggers under that same project. This has **not** been verified against the live project by
  this session (no production credentials here) and MUST be verified by the owner before Live is expected to work
  (see the RUNBOOK statement below). Until verified, `lookupUserEmail` fails closed to `null` on a privilege error
  exactly as it does on a missing schema — Live simply stays frozen, exactly as it does today. Nothing breaks
  either way.
- **The read is per `?live=1` request.** The embed route is `dynamic = 'force-dynamic'` (ADR 041 point 12), so this
  is one additional indexed primary-key lookup on every live-embed page view — negligible, the same order of cost
  as the live query re-run itself.
- **The eviction-GC blind spot (#228) is unchanged** by this work — closing the owner-email gap makes Live able to
  activate, which is exactly when #228's dormant risk (a table kept alive only by live-embed traffic can be evicted
  without the evictor ever seeing that demand) stops being moot. Recorded already, not re-solved here.
